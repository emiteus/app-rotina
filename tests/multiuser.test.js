/**
 * Testes multi-usuário: login A/B, isolamento de tasks, ranking.
 * Rodar: node --test tests/multiuser.test.js
 */
require('dotenv').config();
process.env.NODE_ENV = 'test';
process.env.SKIP_AUTH = 'false';
process.env.CRONS_ENABLED = 'false';
process.env.MAX_USERS = '50';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const { v4: uuid } = require('uuid');
const { hashSenha } = require('../lib/password');

let baseUrl = '';
let httpServer = null;
let cookiesA = '';
let cookiesB = '';

const LOGIN_A = `test_a_${Date.now()}`;
const LOGIN_B = `test_b_${Date.now()}`;
const SENHA = 'test123';
let userIdA = '';
let userIdB = '';

function mergeCookies(existing, setCookie) {
  if (!setCookie) return existing;
  const arr = Array.isArray(setCookie) ? setCookie : [setCookie];
  const jar = {};
  (existing || '').split(';').map(s => s.trim()).filter(Boolean).forEach(p => {
    const i = p.indexOf('=');
    if (i > 0) jar[p.slice(0, i)] = p.slice(i + 1);
  });
  arr.forEach(c => {
    const part = c.split(';')[0];
    const i = part.indexOf('=');
    if (i > 0) jar[part.slice(0, i)] = part.slice(i + 1);
  });
  return Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ');
}

function req(method, path, body, cookie = '') {
  return new Promise((resolve, reject) => {
    const url = new URL(path, baseUrl);
    const payload = body ? JSON.stringify(body) : null;
    const headers = payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {};
    if (cookie) headers.Cookie = cookie;
    const r = http.request(url, { method, headers }, (res) => {
      let raw = '';
      res.on('data', (c) => { raw += c; });
      res.on('end', () => {
        let json = {};
        try { json = raw ? JSON.parse(raw) : {}; } catch (e) { json = { _raw: raw }; }
        resolve({ status: res.statusCode, json, headers: res.headers });
      });
    });
    r.on('error', reject);
    if (payload) r.write(payload);
    r.end();
  });
}

before(async () => {
  const { initDB, run } = require('../lib/db');
  await initDB();
  userIdA = uuid();
  userIdB = uuid();
  await run(
    `INSERT INTO usuarios (id, login, nome, senha_hash, cor, ativo) VALUES ($1,$2,$3,$4,$5,true)`,
    [userIdA, LOGIN_A, 'Test A', hashSenha(SENHA), '#f97316']
  );
  await run(
    `INSERT INTO usuarios (id, login, nome, senha_hash, cor, ativo) VALUES ($1,$2,$3,$4,$5,true)`,
    [userIdB, LOGIN_B, 'Test B', hashSenha(SENHA), '#3b82f6']
  );

  const serverMod = require('../server');
  httpServer = serverMod.httpServer;
  await new Promise((resolve) => {
    if (httpServer.listening) return resolve();
    httpServer.listen(0, '127.0.0.1', resolve);
  });
  const { port } = httpServer.address();
  baseUrl = `http://127.0.0.1:${port}`;

  const loginA = await req('POST', '/api/auth/login', { login: LOGIN_A, senha: SENHA });
  assert.equal(loginA.status, 200);
  cookiesA = mergeCookies('', loginA.headers['set-cookie']);

  const loginB = await req('POST', '/api/auth/login', { login: LOGIN_B, senha: SENHA });
  assert.equal(loginB.status, 200);
  cookiesB = mergeCookies('', loginB.headers['set-cookie']);
});

after(() => {
  if (httpServer) httpServer.close();
});

test('User A não vê tasks de User B', async () => {
  const taskB = uuid();
  const { run } = require('../lib/db');
  const hoje = new Date().toISOString().slice(0, 10);
  await run(
    `INSERT INTO tasks (id, titulo, descricao, prioridade, categoria, data_reset, user_id)
     VALUES ($1,$2,'','media','geral',$3::timestamp,$4)`,
    [taskB, 'Task secreta B', `${hoje} 12:00:00`, userIdB]
  );

  const listA = await req('GET', '/api/tasks', null, cookiesA);
  assert.equal(listA.status, 200);
  const tasksA = Array.isArray(listA.json) ? listA.json : (listA.json.tarefas || []);
  assert.ok(!tasksA.some(t => t.id === taskB), 'A não deve ver task de B');

  const listB = await req('GET', '/api/tasks', null, cookiesB);
  assert.equal(listB.status, 200);
  const tasksB = Array.isArray(listB.json) ? listB.json : (listB.json.tarefas || []);
  assert.ok(tasksB.some(t => t.id === taskB), 'B deve ver sua task');
});

test('GET /api/ranking/dia retorna 2 jogadores', async () => {
  const { run } = require('../lib/db');
  const hoje = new Date().toISOString().slice(0, 10);
  const tA = uuid();
  const tB = uuid();
  await run(
    `INSERT INTO tasks (id, titulo, descricao, prioridade, categoria, data_reset, concluida, user_id)
     VALUES ($1,'Rank A','','media','geral',$2::timestamp,true,$3)`,
    [tA, `${hoje} 12:00:00`, userIdA]
  );
  await run(
    `INSERT INTO tasks (id, titulo, descricao, prioridade, categoria, data_reset, concluida, user_id)
     VALUES ($1,'Rank B','','media','geral',$2::timestamp,false,$3)`,
    [tB, `${hoje} 12:00:00`, userIdB]
  );

  const rank = await req('GET', '/api/ranking/dia', null, cookiesA);
  assert.equal(rank.status, 200);
  assert.ok(Array.isArray(rank.json.jogadores));
  assert.ok(rank.json.jogadores.length >= 2);
  const eu = rank.json.jogadores.find(j => j.eu);
  assert.ok(eu);
  assert.equal(eu.id, userIdA);
});

test('Login recusa credenciais inválidas', async () => {
  const r = await req('POST', '/api/auth/login', { login: LOGIN_A, senha: 'errada' });
  assert.equal(r.status, 401);
});

test('POST /api/auth/register cria conta com login escolhido', async () => {
  const st = await req('GET', '/api/auth/cadastro');
  assert.equal(st.status, 200);
  assert.ok('aberto' in st.json);
  if (!st.json.aberto) return;

  const login = `novo_${Date.now()}`;
  const r = await req('POST', '/api/auth/register', {
    login,
    senha: 'minhasenha123',
    nome: 'Amigo Teste'
  });
  assert.equal(r.status, 200);
  assert.equal(r.json.user.login, login);

  const dup = await req('POST', '/api/auth/register', { login, senha: 'outra123' });
  assert.equal(dup.status, 409);
});
