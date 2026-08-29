require('dotenv').config({ quiet: true });
const { Pool } = require('pg');
const { pool } = require('../lib/db');

(async () => {
  const userId = (await pool.query(`SELECT id FROM usuarios WHERE login='teus'`)).rows[0].id;
  const restoreUrl = (process.env.DATABASE_URL || '').replace(/@[^/]+/, '@ep-icy-night-atpz9b05-pooler.c-9.us-east-1.aws.neon.tech');
  const backup = new Pool({ connectionString: restoreUrl, ssl: { rejectUnauthorized: false } });
  const backupUserId = (await backup.query(`SELECT id FROM usuarios WHERE login='teus'`)).rows[0].id;

  for (const label of ['prod', 'backup']) {
    const p = label === 'prod' ? pool : backup;
    const uid = label === 'prod' ? userId : backupUserId;
    const t = await p.query(
      `SELECT titulo, COUNT(*)::int n FROM tasks WHERE user_id=$1
       AND (titulo ILIKE '%pranch%' OR titulo ILIKE '%lixo%' OR titulo ILIKE '%acordar%')
       GROUP BY titulo`,
      [uid]
    );
    const r = await p.query(
      `SELECT titulo, ativa FROM tarefas_recorrentes WHERE user_id=$1
       AND (titulo ILIKE '%pranch%' OR titulo ILIKE '%lixo%' OR titulo ILIKE '%acordar%')`,
      [uid]
    );
    console.log(`\n=== ${label} tasks ===`, t.rows);
    console.log(`=== ${label} recorrentes ===`, r.rows);
  }

  // Busca ampla em tasks apagadas no historico por_categoria? não tem titulo
  const hist = await pool.query(
    `SELECT data, por_categoria FROM task_historico WHERE user_id=$1 ORDER BY data DESC LIMIT 5`,
    [userId]
  );
  console.log('\nhistorico sample', hist.rows);

  await backup.end();
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
