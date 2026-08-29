require('dotenv').config();
const { pool } = require('../lib/db');

(async () => {
  const id = (await pool.query(`SELECT id FROM usuarios WHERE login = 'teus'`)).rows[0].id;

  const counts = await pool.query(
    `SELECT COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE data_reset::date >= CURRENT_DATE - 1)::int AS visiveis_hoje_ontem,
            COUNT(*) FILTER (WHERE data_reset::date < CURRENT_DATE - 1)::int AS antigas_no_banco
     FROM tasks WHERE user_id = $1`,
    [id]
  );

  const byMonth = await pool.query(
    `SELECT TO_CHAR(data_reset::date, 'YYYY-MM') AS m, COUNT(*)::int AS n
     FROM tasks WHERE user_id = $1 AND data_reset IS NOT NULL
     GROUP BY 1 ORDER BY 1`,
    [id]
  );

  const coverage = await pool.query(
    `SELECT COUNT(DISTINCT data_reset::date)::int AS dias_com_tasks
     FROM tasks WHERE user_id = $1 AND data_reset IS NOT NULL`,
    [id]
  );

  const histCount = await pool.query(
    `SELECT COUNT(*)::int AS n FROM task_historico WHERE user_id = $1`,
    [id]
  );

  const orphanTasks = await pool.query(`SELECT COUNT(*)::int AS n FROM tasks WHERE user_id IS NULL`);
  const orphanHist = await pool.query(`SELECT COUNT(*)::int AS n FROM task_historico WHERE user_id IS NULL`);

  const diasSemHist = await pool.query(
    `SELECT TO_CHAR(t.data_reset::date, 'YYYY-MM-DD') AS d, COUNT(*)::int AS tasks
     FROM tasks t
     LEFT JOIN task_historico h ON h.user_id = t.user_id AND h.data = t.data_reset::date
     WHERE t.user_id = $1 AND t.data_reset IS NOT NULL AND h.data IS NULL
     GROUP BY 1 ORDER BY 1 DESC LIMIT 20`,
    [id]
  );

  console.log('=== teus task recovery diagnostic ===');
  console.log('counts', counts.rows[0]);
  console.log('by month', byMonth.rows);
  console.log('dias distintos com tasks', coverage.rows[0].dias_com_tasks);
  console.log('dias em task_historico', histCount.rows[0].n);
  console.log('orphan tasks (user_id null)', orphanTasks.rows[0].n);
  console.log('orphan historico', orphanHist.rows[0].n);
  console.log('dias com tasks mas SEM historico (top 20):', diasSemHist.rows);

  const histVsTasks = await pool.query(
    `SELECT TO_CHAR(h.data, 'YYYY-MM-DD') AS d, h.total, h.concluidas,
            COALESCE(t.n, 0)::int AS tasks_restantes
     FROM task_historico h
     LEFT JOIN (
       SELECT data_reset::date AS d, COUNT(*)::int AS n
       FROM tasks WHERE user_id = $1 GROUP BY 1
     ) t ON t.d = h.data
     WHERE h.user_id = $1
     ORDER BY h.data DESC`,
    [id]
  );
  const onlyHist = await pool.query(
    `SELECT COUNT(*)::int AS dias,
            COALESCE(SUM(h.total), 0)::int AS total_tarefas,
            COALESCE(SUM(h.concluidas), 0)::int AS concluidas
     FROM task_historico h
     WHERE h.user_id = $1 AND h.total > 0
       AND NOT EXISTS (
         SELECT 1 FROM tasks t
         WHERE t.user_id = $1 AND t.data_reset::date = h.data
       )`,
    [id]
  );
  console.log('dias só no histórico (tasks individuais já apagadas):', onlyHist.rows[0]);
  console.log('amostra histórico vs tasks restantes:', histVsTasks.rows.slice(0, 20));

  for (const dias of [30, 60, 90, 120, 180]) {
    const r = await pool.query(
      `SELECT COUNT(*)::int AS n, COALESCE(SUM(total), 0)::int AS tot,
              COALESCE(SUM(concluidas), 0)::int AS concluidas
       FROM task_historico
       WHERE user_id = $1 AND data >= CURRENT_DATE - ($2::int * INTERVAL '1 day')`,
      [id, dias]
    );
    console.log(`histórico últimos ${dias}d:`, r.rows[0]);
  }

  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
