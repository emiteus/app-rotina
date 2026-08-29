require('dotenv').config({ quiet: true });
const { Pool } = require('pg');
const { pool } = require('../lib/db');

(async () => {
  const login = (process.argv[2] || 'teus').toLowerCase();
  const u = await pool.query(`SELECT id FROM usuarios WHERE lower(login) = $1`, [login]);
  const userId = u.rows[0]?.id;

  const rec = await pool.query(
    `SELECT id, titulo, ativa, frequencia, dias_semana, ultima_criacao, prioridade, categoria
     FROM tarefas_recorrentes WHERE user_id = $1 ORDER BY titulo`,
    [userId]
  );
  console.log('=== recorrentes atuais ===');
  rec.rows.forEach((r) => console.log(r.ativa ? '✓' : '○', r.titulo, r.dias_semana));

  const busca = await pool.query(
    `SELECT id, titulo, ativa FROM tarefas_recorrentes
     WHERE user_id = $1 AND (titulo ILIKE '%prancha%' OR titulo ILIKE '%lixo%')`,
    [userId]
  );
  console.log('\n=== prancha/lixo ===', busca.rows);

  const restoreUrl = (process.env.DATABASE_URL || '').replace(
    /@[^/]+/,
    '@ep-icy-night-atpz9b05-pooler.c-9.us-east-1.aws.neon.tech'
  );
  const backup = new Pool({ connectionString: restoreUrl, ssl: { rejectUnauthorized: false } });
  const bu = await backup.query(`SELECT id FROM usuarios WHERE lower(login) = $1`, [login]);
  const bakRec = await backup.query(
    `SELECT id, titulo, ativa, frequencia, dias_semana, prioridade, categoria, descricao
     FROM tarefas_recorrentes WHERE user_id = $1
       AND (titulo ILIKE '%prancha%' OR titulo ILIKE '%lixo%')`,
    [bu.rows[0]?.id]
  );
  console.log('\n=== backup branch ===');
  bakRec.rows.forEach((r) => console.log(r));

  const allBak = await backup.query(
    `SELECT titulo, ativa FROM tarefas_recorrentes WHERE user_id = $1 ORDER BY titulo`,
    [bu.rows[0]?.id]
  );
  console.log('\n=== todas recorrentes no backup ===');
  allBak.rows.forEach((r) => console.log(r.ativa ? '✓' : '○', r.titulo));

  await backup.end();
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
