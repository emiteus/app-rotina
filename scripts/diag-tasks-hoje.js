require('dotenv').config({ quiet: true });
const { pool } = require('../lib/db');

(async () => {
  const id = (await pool.query(`SELECT id FROM usuarios WHERE login = 'teus'`)).rows[0].id;

  const aulao = await pool.query(
    `SELECT id, titulo, data_reset, concluida, data_criacao
     FROM tasks WHERE user_id = $1 AND titulo ILIKE '%aulão%tylty%'`,
    [id]
  );
  console.log('Aulão:', aulao.rows);

  const hoje = await pool.query(
    `SELECT id, titulo, data_reset::date AS dia, concluida
     FROM tasks WHERE user_id = $1
       AND data_reset::date >= CURRENT_DATE - 1
     ORDER BY data_reset, titulo`,
    [id]
  );
  console.log('\nTasks ontem+hoje (' + hoje.rows.length + '):');
  hoje.rows.forEach((r) => console.log(`  ${r.dia} | ${r.concluida ? '✓' : '○'} | ${r.titulo}`));

  const antigas = await pool.query(
    `SELECT COUNT(*)::int AS n FROM tasks WHERE user_id = $1 AND data_reset::date < CURRENT_DATE - 1`,
    [id]
  );
  console.log('\nTasks antigas no banco (ocultas na UI):', antigas.rows[0].n);

  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
