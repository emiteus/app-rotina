/**
 * A migração multiusuário roda a cada boot. A consolidação de contas só pode juntar a conta legada
 * "mateus" na do dono — nunca a de outra pessoa, mesmo que ela tenha mais dados (01/10/2026).
 * Só roda com TEST_DATABASE_URL explícita (banco descartável) — nunca usa o DATABASE_URL do .env.
 * Rodar: TEST_DATABASE_URL=postgres://teste@localhost:54329/postgres node --test tests/multiuser-consolidar.test.js
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

const { bancoNovo } = require('./_banco-teste');

const pular = !process.env.TEST_DATABASE_URL && 'sem TEST_DATABASE_URL (banco descartável)';

let banco;
let db;
const DONO = 'teste-mu:dono';
const OUTRO = 'teste-mu:outro';
const LEGADO = 'teste-mu:legado';

before(async () => {
  if (pular) return;
  banco = await bancoNovo('multiuser');
  process.env.DATABASE_URL = banco.url;
  process.env.OWNER_LOGIN = 'teste-mu-dono';
  db = require('../lib/db');
  await db.initDB();
  await db.initDB();
  // O initDB cria um dono padrão (login teste-mu-dono, dados vazios): fica só o deste teste
  await db.run(`DELETE FROM usuarios WHERE login IN ('teste-mu-dono', 'teste-mu-outro', 'mateus')`);
  await db.run(`INSERT INTO usuarios (id, login, nome, senha_hash) VALUES ($1, 'teste-mu-dono', 'Dono', 'x'), ($2, 'teste-mu-outro', 'Outro', 'x')`, [DONO, OUTRO]);
  const task = (id, uid) => db.run(`INSERT INTO tasks (id, titulo, user_id) VALUES ($1, $1, $2)`, [id, uid]);
  await task('teste-mu:d1', DONO);
  for (let i = 0; i < 5; i += 1) await task(`teste-mu:o${i}`, OUTRO);
});

after(async () => {
  if (db) await db.pool.end();
  if (banco) await banco.apagar();
});

const dono = async (taskId) => (await db.get(`SELECT user_id FROM tasks WHERE id = $1`, [taskId])).user_id;

test('outra pessoa com mais dados que o dono continua com a conta e os dados', { skip: pular }, async () => {
  const { migrarMultiUsuario } = require('../lib/migrate-multiuser');
  await migrarMultiUsuario();
  await migrarMultiUsuario(); // roda a cada boot
  assert.ok(await db.get(`SELECT 1 FROM usuarios WHERE id = $1`, [OUTRO]), 'conta do outro não pode sumir');
  assert.equal(await dono('teste-mu:o0'), OUTRO);
  assert.equal(await dono('teste-mu:d1'), DONO);
});

test('conta legada "mateus" com mais dados ainda é juntada na do dono', { skip: pular }, async () => {
  await db.run(`INSERT INTO usuarios (id, login, nome, senha_hash) VALUES ($1, 'mateus', 'Legado', 'x')`, [LEGADO]);
  for (let i = 0; i < 3; i += 1) await db.run(`INSERT INTO tasks (id, titulo, user_id) VALUES ($1, $1, $2)`, [`teste-mu:l${i}`, LEGADO]);
  const { migrarMultiUsuario } = require('../lib/migrate-multiuser');
  await migrarMultiUsuario();
  assert.equal(await dono('teste-mu:l0'), DONO);
  assert.equal(await db.get(`SELECT 1 FROM usuarios WHERE id = $1`, [LEGADO]), undefined);
  assert.equal(await dono('teste-mu:o0'), OUTRO, 'o outro segue intacto');
});
