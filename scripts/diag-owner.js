require('dotenv').config();
const { pool } = require('../lib/db');

(async () => {
  const u = await pool.query(`SELECT id, login FROM usuarios WHERE lower(login) = 'teus'`);
  const id = u.rows[0]?.id;
  console.log('teus', u.rows[0]);
  if (!id) return process.exit(1);
  const t = await pool.query('SELECT COUNT(*)::int AS n FROM tasks WHERE user_id = $1', [id]);
  const f = await pool.query('SELECT COUNT(*)::int AS n FROM financeiro WHERE user_id = $1', [id]);
  const n = await pool.query('SELECT COUNT(*)::int AS n FROM financeiro WHERE user_id IS NULL');
  const orphans = await pool.query(`
    SELECT user_id, COUNT(*)::int AS n FROM financeiro
    WHERE user_id IS NOT NULL
    GROUP BY user_id ORDER BY n DESC LIMIT 5
  `);
  const others = await pool.query(`
    SELECT u.id, u.login,
      (SELECT COUNT(*)::int FROM tasks WHERE user_id = u.id) AS tasks,
      (SELECT COUNT(*)::int FROM financeiro WHERE user_id = u.id) AS fin
    FROM usuarios u
    ORDER BY (SELECT COUNT(*) FROM financeiro WHERE user_id = u.id) DESC
    LIMIT 12
  `);
  console.log('tasks', t.rows[0].n, 'financeiro', f.rows[0].n, 'fin_null', n.rows[0].n);
  console.log('top user_ids financeiro:', orphans.rows);
  const total = await pool.query('SELECT COUNT(*)::int AS n FROM usuarios');
  console.log('total usuarios', total.rows[0].n);
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
