/**
 * Geração da tarefa do dia a partir das recorrentes (lib/recorrentes.js), contra um Postgres de verdade.
 * Só roda com TEST_DATABASE_URL explícita (banco descartável) — nunca usa o DATABASE_URL do .env.
 * Rodar: TEST_DATABASE_URL=postgres://teste@localhost:54329/postgres node --test tests/recorrentes.test.js
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

const { bancoNovo } = require('./_banco-teste');

const pular = !process.env.TEST_DATABASE_URL && 'sem TEST_DATABASE_URL (banco descartável)';

const U = 'teste-recorrentes';
let banco;
let db;
let rec;

before(async () => {
  if (pular) return;
  banco = await bancoNovo('recorrentes');
  process.env.DATABASE_URL = banco.url;
  db = require('../lib/db');
  // Banco vazio: a migração multiusuário roda antes dos CREATE TABLE e só pega na 2ª chamada (defeito antigo do initDB)
  await db.initDB();
  await db.initDB();
  await db.run(`INSERT INTO usuarios (id, login, nome, senha_hash) VALUES ($1, $1, 'Teste', 'x')`, [U]);
  rec = require('../lib/recorrentes');
});

after(async () => {
  if (db) await db.pool.end();
  if (banco) await banco.apagar();
});

const nova = async (titulo, extra = {}) => {
  const id = `teste-rec:${titulo}`;
  const r = { id, titulo, prioridade: 'media', categoria: 'geral', frequencia: 'diario', dias_semana: '0,1,2,3,4,5,6', ativa: true, ...extra };
  await db.run(
    `INSERT INTO tarefas_recorrentes (id, titulo, prioridade, categoria, frequencia, dias_semana, ativa, user_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [r.id, r.titulo, r.prioridade, r.categoria, r.frequencia, r.dias_semana, r.ativa, U]
  );
  return db.get(`SELECT * FROM tarefas_recorrentes WHERE id = $1`, [id]);
};
const tarefas = async (dia) =>
  (await db.all(`SELECT titulo FROM tasks WHERE user_id = $1 AND data_reset::date = $2::date ORDER BY titulo`, [U, dia])).map((t) => t.titulo);

test('cria a de hoje só pra quem vale no dia, e uma vez só', { skip: pular }, async () => {
  const hoje = '2026-10-01'; // quarta (3)
  await nova('Ler 1 página');
  await nova('Academia', { dias_semana: '1,2,3,4,5' });
  await nova('Jogar o lixo', { dias_semana: '0,4' });
  await nova('Sono', { ativa: false });
  const criadas = await rec.gerarRecorrentesDoDia({ userId: U, hoje, dow: 3 });
  assert.deepEqual(criadas.map((t) => t.titulo).sort(), ['Academia', 'Ler 1 página']);
  assert.deepEqual(await tarefas(hoje), ['Academia', 'Ler 1 página']);
  // De novo no mesmo dia (cron + boot + gerar-hoje): nada novo
  assert.equal((await rec.gerarRecorrentesDoDia({ userId: U, hoje, dow: 3 })).length, 0);
  assert.deepEqual(await tarefas(hoje), ['Academia', 'Ler 1 página']);
  // Dia seguinte gera de novo
  assert.equal((await rec.gerarRecorrentesDoDia({ userId: U, hoje: '2026-10-02', dow: 4 })).length, 3);
});

test('recorrente criada depois das 00:05 já gera a de hoje', { skip: pular }, async () => {
  const r = await nova('Duolingo');
  const t = await rec.gerarTarefaDoDia(r, { hoje: '2026-10-01', dow: 3 });
  assert.equal(t.titulo, 'Duolingo');
  assert.equal(String(t.data_reset).length > 0, true);
});

test('cron e cadastro ao mesmo tempo não duplicam', { skip: pular }, async () => {
  const r = await nova('Varrer o quarto');
  const res = await Promise.all(Array.from({ length: 6 }, () => rec.gerarTarefaDoDia(r, { hoje: '2026-10-03', dow: 5 })));
  assert.equal(res.filter(Boolean).length, 1);
  assert.deepEqual((await tarefas('2026-10-03')).filter((x) => x === 'Varrer o quarto'), ['Varrer o quarto']);
});

test('semanal sem dias definidos vale na segunda', { skip: pular }, () => {
  assert.deepEqual(rec.diasDa({ frequencia: 'semanal' }), ['1']);
  assert.deepEqual(rec.diasDa({ frequencia: 'diario' }), ['0', '1', '2', '3', '4', '5', '6']);
  assert.equal(rec.valeNoDia({ ativa: true, user_id: U, dias_semana: '0,4' }, 4), true);
  assert.equal(rec.valeNoDia({ ativa: false, user_id: U }, 4), false);
});
