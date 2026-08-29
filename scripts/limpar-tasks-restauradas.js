require('dotenv').config({ quiet: true });
const { pool } = require('../lib/db');

(async () => {
  const login = (process.argv[2] || 'teus').toLowerCase();
  const u = await pool.query(`SELECT id FROM usuarios WHERE lower(login) = $1`, [login]);
  const userId = u.rows[0]?.id;
  if (!userId) throw new Error('user not found');

  // 1) Aulão — apagar instâncias + desativar recorrente
  const aulaoRec = await pool.query(
    `UPDATE tarefas_recorrentes SET ativa = false
     WHERE user_id = $1 AND titulo ILIKE '%aulão%tylty%' RETURNING id, titulo`,
    [userId]
  );
  const aulaoTasks = await pool.query(
    `DELETE FROM tasks WHERE user_id = $1 AND titulo ILIKE '%aulão%tylty%' RETURNING id, titulo`,
    [userId]
  );
  console.log('Aulão recorrente desativada:', aulaoRec.rowCount);
  console.log('Aulão tasks apagadas:', aulaoTasks.rowCount);

  // 2) Tasks antigas restauradas (antes de ontem) — histórico agregado fica no task_historico
  const velhas = await pool.query(
    `DELETE FROM tasks
     WHERE user_id = $1 AND data_reset IS NOT NULL AND data_reset::date < CURRENT_DATE - 1
     RETURNING id`,
    [userId]
  );
  console.log('Tasks antigas removidas (só registro individual):', velhas.rowCount);

  // 3) Corrigir encoding ontem/hoje
  const fixes = [
    ['Gerar 10 v%deos de filmes', 'Gerar 10 vídeos de filmes'],
    ['Laranjeira %produzir 10 v%deos', 'Laranjeira – produzir 10 vídeos'],
  ];
  for (const [like, titulo] of fixes) {
    const r = await pool.query(
      `UPDATE tasks SET titulo = $1 WHERE user_id = $2 AND titulo ILIKE $3`,
      [titulo, userId, like]
    );
    if (r.rowCount) console.log('Encoding fix:', titulo, r.rowCount);
  }

  const restantes = await pool.query(
    `SELECT COUNT(*)::int AS n FROM tasks WHERE user_id = $1`,
    [userId]
  );
  console.log('Tasks restantes:', restantes.rows[0].n);

  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
