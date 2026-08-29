const { v4: uuid } = require('uuid');
const { pool, get, run } = require('./db');
const { hashSenha } = require('./password');

const TABELAS_USER_ID = [
  'tasks', 'task_historico', 'tarefas_recorrentes',
  'financeiro', 'despesas_mes', 'receitas_mes',
  'openfinance_items', 'metas', 'metas_depositos',
  'mei_das', 'alarmes', 'eventos', 'assist_conversas',
  'apostas_pagamentos', 'categoria_regras', 'push_subscriptions'
];

async function migrarMultiUsuario() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS usuarios (
      id TEXT PRIMARY KEY,
      login TEXT UNIQUE NOT NULL,
      nome TEXT NOT NULL,
      senha_hash TEXT NOT NULL,
      cor TEXT DEFAULT '#f97316',
      ativo BOOLEAN DEFAULT true,
      criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  for (const t of TABELAS_USER_ID) {
    await pool.query(`ALTER TABLE ${t} ADD COLUMN IF NOT EXISTS user_id TEXT`).catch(() => {});
  }
  await pool.query(`ALTER TABLE categorias ADD COLUMN IF NOT EXISTS user_id TEXT`).catch(() => {});
  await pool.query(`ALTER TABLE app_estado ADD COLUMN IF NOT EXISTS user_id TEXT`).catch(() => {});

  // task_historico: unique por usuário+dia
  await pool.query(`ALTER TABLE task_historico DROP CONSTRAINT IF EXISTS task_historico_data_key`).catch(() => {});
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_task_historico_user_data
    ON task_historico (user_id, data) WHERE user_id IS NOT NULL
  `).catch(() => {});

  await pool.query(`CREATE INDEX IF NOT EXISTS idx_tasks_user_reset ON tasks (user_id, data_reset)`).catch(() => {});
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_financeiro_user ON financeiro (user_id)`).catch(() => {});

  const flag = await get(`SELECT valor FROM app_estado WHERE chave = 'multiuser_migrated' AND user_id IS NULL`);
  if (flag && flag.valor === '1') return;

  let ownerId = process.env.OWNER_USER_ID;
  let owner = ownerId
    ? await get(`SELECT id FROM usuarios WHERE id = $1`, [ownerId])
    : await get(`SELECT id FROM usuarios WHERE login = 'mateus'`);

  if (!owner) {
    ownerId = ownerId || uuid();
    const login = process.env.OWNER_LOGIN || 'mateus';
    const nome = process.env.OWNER_NOME || 'Mateus';
    const senha = process.env.APP_PASSWORD || process.env.OWNER_SENHA || 'senha123';
    await run(
      `INSERT INTO usuarios (id, login, nome, senha_hash, cor, ativo)
       VALUES ($1,$2,$3,$4,$5,true)
       ON CONFLICT (login) DO UPDATE SET nome = EXCLUDED.nome`,
      [ownerId, login, nome, hashSenha(senha), '#f97316']
    );
    owner = await get(`SELECT id FROM usuarios WHERE login = $1`, [login]);
    ownerId = owner.id;
  } else {
    ownerId = owner.id;
  }

  for (const t of TABELAS_USER_ID) {
    await run(`UPDATE ${t} SET user_id = $1 WHERE user_id IS NULL`, [ownerId]);
  }
  await run(`UPDATE categorias SET user_id = $1 WHERE criado_por_usuario = true AND user_id IS NULL`, [ownerId]);
  await run(`UPDATE app_estado SET user_id = $1 WHERE user_id IS NULL`, [ownerId]);

  await run(
    `INSERT INTO app_estado (chave, valor, user_id) VALUES ('multiuser_migrated', '1', NULL)
     ON CONFLICT (chave) DO UPDATE SET valor = '1'`,
    []
  ).catch(async () => {
    await run(
      `INSERT INTO app_estado (chave, valor) VALUES ('multiuser_migrated', '1')
       ON CONFLICT (chave) DO UPDATE SET valor = '1'`
    );
  });

  console.log('[multiuser] migração concluída, owner:', ownerId);
  return ownerId;
}

module.exports = { migrarMultiUsuario, TABELAS_USER_ID };
