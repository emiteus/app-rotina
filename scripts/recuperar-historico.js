#!/usr/bin/env node
/** Reconstrói task_historico a partir das tasks ainda no banco (até 365 dias). */
require('dotenv').config();
const { initDB, pool } = require('../lib/db');
const { backfillHistorico, backfillHistoricoTodos } = require('../lib/historico');

async function main() {
  await initDB();
  const dias = Math.min(Math.max(Number(process.argv[2]) || 365, 30), 365);
  const login = (process.argv[3] || process.env.OWNER_LOGIN || 'teus').toLowerCase();

  let result;
  if (login === 'todos') {
    result = await backfillHistoricoTodos(dias);
    console.log(`Backfill todos usuários (${dias}d):`, result);
  } else {
    const u = await pool.query(`SELECT id, login FROM usuarios WHERE lower(login) = $1`, [login]);
    if (!u.rows[0]) throw new Error(`Usuário não encontrado: ${login}`);
    result = await backfillHistorico(dias, u.rows[0].id);
    console.log(`Backfill ${login} (${dias}d):`, result);
  }

  const id = login !== 'todos'
    ? (await pool.query(`SELECT id FROM usuarios WHERE lower(login) = $1`, [login])).rows[0].id
    : null;

  if (id) {
    const hist = await pool.query(
      `SELECT COUNT(*)::int AS n, MIN(data) AS min, MAX(data) AS max,
              COALESCE(SUM(total), 0)::int AS total_tarefas,
              COALESCE(SUM(concluidas), 0)::int AS concluidas
       FROM task_historico WHERE user_id = $1`,
      [id]
    );
    console.log('task_historico após backfill:', hist.rows[0]);
  }

  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
