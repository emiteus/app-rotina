/**
 * Smoke tests das APIs principais.
 * Rodar: npm test  (NODE_ENV=test, SKIP_AUTH=true)
 */
require('dotenv').config();
process.env.NODE_ENV = 'test';
process.env.SKIP_AUTH = 'true';
process.env.CRONS_ENABLED = 'false';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const { app, httpServer } = require('../server');

let baseUrl = '';

function req(method, path, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, baseUrl);
    const payload = body ? JSON.stringify(body) : null;
    const r = http.request(url, {
      method,
      headers: payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}
    }, (res) => {
      let raw = '';
      res.on('data', (c) => { raw += c; });
      res.on('end', () => {
        let json = {};
        try { json = raw ? JSON.parse(raw) : {}; } catch (e) { json = { _raw: raw }; }
        resolve({ status: res.statusCode, json });
      });
    });
    r.on('error', reject);
    if (payload) r.write(payload);
    r.end();
  });
}

before(async () => {
  const { initDB } = require('../lib/db');
  const { ensureDevUser } = require('../lib/tenant');
  await initDB();
  await ensureDevUser();
  await new Promise((resolve) => {
    httpServer.listen(0, '127.0.0.1', resolve);
  });
  const { port } = httpServer.address();
  baseUrl = `http://127.0.0.1:${port}`;
});

after(() => {
  httpServer.close();
});

test('GET /api/receitas retorna estrutura do mês', async () => {
  const ym = new Date().toISOString().slice(0, 7);
  const { status, json } = await req('GET', `/api/receitas?ym=${ym}`);
  assert.equal(status, 200);
  assert.ok(Array.isArray(json.receitas));
  assert.ok(json.resumo);
});

test('GET /api/despesas retorna estrutura do mês', async () => {
  const ym = new Date().toISOString().slice(0, 7);
  const { status, json } = await req('GET', `/api/despesas?ym=${ym}`);
  assert.equal(status, 200);
  assert.ok(Array.isArray(json.despesas));
  assert.ok(json.resumo);
});

test('GET /api/ia/status responde', async () => {
  const { status, json } = await req('GET', '/api/ia/status');
  assert.equal(status, 200);
  assert.equal(json.ok, true);
  assert.ok('disponivel' in json);
});

test('GET /api/ranking/dia responde', async () => {
  const { status, json } = await req('GET', '/api/ranking/dia');
  assert.equal(status, 200);
  assert.ok(Array.isArray(json.jogadores));
  assert.ok(json.data);
});

test('GET /api/auth/cadastro responde', async () => {
  const { status, json } = await req('GET', '/api/auth/cadastro');
  assert.equal(status, 200);
  assert.ok('aberto' in json);
  assert.ok('vagas' in json);
});
