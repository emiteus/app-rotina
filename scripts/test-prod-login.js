#!/usr/bin/env node
/** Testa login + APIs no deploy. Uso: node scripts/test-prod-login.js teus SENHA */
const http = require('http');
const https = require('https');

const base = process.argv[4] || 'https://app-rotina-production-f84e.up.railway.app';
const login = process.argv[2] || 'teus';
const senha = process.argv[3];
let cookies = '';

function req(method, path, body) {
  const url = new URL(path, base);
  const lib = url.protocol === 'https:' ? https : http;
  const payload = body ? JSON.stringify(body) : null;
  return new Promise((resolve, reject) => {
    const headers = payload
      ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
      : {};
    if (cookies) headers.Cookie = cookies;
    const r = lib.request(url, { method, headers }, (res) => {
      const sc = res.headers['set-cookie'];
      if (sc) {
        const jar = {};
        cookies.split(';').filter(Boolean).forEach((p) => {
          const i = p.trim().indexOf('=');
          if (i > 0) jar[p.trim().slice(0, i)] = p.trim().slice(i + 1);
        });
        (Array.isArray(sc) ? sc : [sc]).forEach((c) => {
          const part = c.split(';')[0];
          const i = part.indexOf('=');
          if (i > 0) jar[part.slice(0, i)] = part.slice(i + 1);
        });
        cookies = Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ');
      }
      let raw = '';
      res.on('data', (c) => { raw += c; });
      res.on('end', () => {
        let json = {};
        try { json = raw ? JSON.parse(raw) : {}; } catch (e) { json = { _raw: raw.slice(0, 200) }; }
        resolve({ status: res.statusCode, json });
      });
    });
    r.on('error', reject);
    if (payload) r.write(payload);
    r.end();
  });
}

(async () => {
  if (!senha) {
    console.error('Uso: node scripts/test-prod-login.js teus SENHA');
    process.exit(1);
  }
  console.log('Base:', base);
  const lg = await req('POST', '/api/auth/login', { login, senha });
  console.log('login', lg.status, lg.json);
  if (lg.status !== 200) process.exit(1);

  const me = await req('GET', '/api/auth/me');
  console.log('me', me.status, JSON.stringify(me.json, null, 2));

  const fin = await req('GET', '/api/financeiro?dias=30');
  console.log('financeiro', fin.status, 'transacoes', fin.json.transacoes?.length, 'saldo', fin.json.saldo);

  const tasks = await req('GET', '/api/tasks');
  console.log('tasks', tasks.status, 'count', Array.isArray(tasks.json) ? tasks.json.length : tasks.json);

  const rank = await req('GET', '/api/ranking/dia');
  console.log('ranking', rank.status, rank.json.jogadores?.length);
})().catch((e) => { console.error(e); process.exit(1); });
