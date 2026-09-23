/**
 * Smoke do WebSocket (auditoria 2026-09-22) com servidor real + express-session:
 * - estranho sem login não recebe nada
 * - userId declarado pelo cliente é ignorado (vale a sessão do cookie)
 * - evento de um usuário não chega no outro
 * - gateway por path exige a própria autenticação
 * Usage: node scripts/smoke-ws.js
 */
const http = require('http');
const assert = require('assert');
const express = require('express');
const session = require('express-session');
const WebSocket = require('ws');

// Sem banco: tenant.js importa lib/db — stub pro require não conectar
const Module = require('module');
const orig = Module.prototype.require;
Module.prototype.require = function (id) {
  if (/(^|\/)db$/.test(String(id).replace(/\\/g, '/'))) return { get: async () => null, run: async () => ({}) };
  return orig.apply(this, arguments);
};
const WebSocketServer = require('../lib/websocket');

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const app = express();
  const server = http.createServer(app);
  const wsServer = new WebSocketServer(server);
  const mw = session({ secret: 'teste', resave: false, saveUninitialized: false });
  app.use(mw);
  wsServer.setSessionMiddleware(mw);
  app.get('/login/:uid', (req, res) => {
    req.session.userId = req.params.uid;
    res.json({ ok: true });
  });
  wsServer.addGateway({
    path: '/device',
    authenticate: async (req) => (req.headers.authorization === 'Bearer certo' ? { deviceId: 'd1' } : null),
    onConnection: (ws) => ws.send(JSON.stringify({ type: 'hello' }))
  });

  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `127.0.0.1:${server.address().port}`;

  const login = (uid) =>
    new Promise((resolve) => {
      http.get(`http://${base}/login/${uid}`, (res) => {
        res.resume();
        resolve(String(res.headers['set-cookie'][0]).split(';')[0]);
      });
    });

  const connect = (cookie, claimUserId) =>
    new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://${base}/`, cookie ? { headers: { cookie } } : {});
      ws.got = [];
      ws.on('message', (d) => ws.got.push(JSON.parse(d)));
      ws.on('open', () => {
        ws.send(JSON.stringify({ tipo: 'auth', sessionId: Math.random().toString(36).slice(2), dados: { userId: claimUserId } }));
        resolve(ws);
      });
      ws.on('error', reject);
    });

  try {
    const cookieA = await login('userA');
    const cookieB = await login('userB');
    const a = await connect(cookieA, 'userA');
    const b = await connect(cookieB, 'userB');
    const estranho = await connect(null, 'userA'); // sem cookie, alegando ser A
    const mentiroso = await connect(cookieB, 'userA'); // logado como B, alegando ser A
    await wait(100);

    assert(estranho.got.some((m) => m.tipo === 'auth-required'), 'estranho recebe auth-required');
    wsServer.broadcastToUser('userA', { tipo: 'financeiro-novo', dados: { valor: 1000 } });
    wsServer.broadcast({ tipo: 'ranking-dia' });
    await wait(100);

    const tipos = (ws) => ws.got.map((m) => m.tipo);
    assert(tipos(a).includes('financeiro-novo'), 'dono recebe');
    assert(!tipos(b).includes('financeiro-novo'), 'outro usuário não recebe');
    assert(!tipos(mentiroso).includes('financeiro-novo'), 'userId declarado é ignorado');
    assert(!tipos(estranho).includes('financeiro-novo'), 'estranho não recebe dado');
    assert(!tipos(estranho).includes('ranking-dia'), 'estranho não recebe nem broadcast');

    // Eco entre abas só do mesmo usuário
    b.send(JSON.stringify({ tipo: 'tarefa-atualizada', dados: { id: 1 } }));
    await wait(100);
    assert(!tipos(a).includes('tarefa-atualizada'), 'eco de B não chega em A');
    assert(tipos(mentiroso).includes('tarefa-atualizada'), 'eco chega na outra aba de B');

    // Gateway: token errado = 401; certo = conecta
    const semToken = await new Promise((resolve) => {
      const ws = new WebSocket(`ws://${base}/device`, { headers: { authorization: 'Bearer errado' } });
      ws.on('unexpected-response', (_req, res) => resolve(res.statusCode));
      ws.on('open', () => resolve('abriu'));
      ws.on('error', () => {});
    });
    assert.strictEqual(semToken, 401, 'gateway sem token válido = 401');
    const comToken = await new Promise((resolve) => {
      const ws = new WebSocket(`ws://${base}/device`, { headers: { authorization: 'Bearer certo' } });
      ws.on('message', (d) => {
        resolve(JSON.parse(d).type);
        ws.close();
      });
      ws.on('error', () => resolve('erro'));
    });
    assert.strictEqual(comToken, 'hello', 'gateway com token conecta');

    for (const ws of [a, b, estranho, mentiroso]) ws.close();
    server.close();
    console.log('smoke-ws OK');
    process.exit(0);
  } catch (e) {
    console.error('smoke-ws FAILED:', e.message);
    server.close();
    process.exit(1);
  }
})();
