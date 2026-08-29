#!/usr/bin/env node
/**
 * Restaura tasks apagadas a partir de um branch/backup Neon.
 *
 * 1. No Neon: Branches → Create branch → "From point in time" (antes do apagamento)
 * 2. Copie a connection string do branch para RESTORE_DATABASE_URL no .env
 * 3. node scripts/restaurar-tasks-de-backup.js teus
 *
 * Só insere tasks que não existem mais (por id). Não sobrescreve nada.
 */
require('dotenv').config({ quiet: true });
const { Pool } = require('pg');
const { initDB, pool } = require('../lib/db');

async function main() {
  const restoreUrl = process.env.RESTORE_DATABASE_URL;
  const login = (process.argv[2] || 'teus').toLowerCase();
  const dryRun = process.argv.includes('--dry-run');

  if (!restoreUrl) {
    console.error(`
RESTORE_DATABASE_URL não definido.

Passos no Neon (console.neon.tech):
  1. Abra o projeto → Branches
  2. "Create branch" → "From point in time"
  3. Escolha hoje ~18:00 BRT (antes das ~19:15 quando rodou a limpeza)
  4. Copie a connection string do branch novo
  5. No .env: RESTORE_DATABASE_URL=postgresql://...
  6. node scripts/restaurar-tasks-de-backup.js ${login}
`);
    process.exit(1);
  }

  await initDB();
  const backup = new Pool({ connectionString: restoreUrl, ssl: { rejectUnauthorized: false } });

  const u = await pool.query(`SELECT id FROM usuarios WHERE lower(login) = $1`, [login]);
  const userId = u.rows[0]?.id;
  if (!userId) throw new Error(`Usuário não encontrado: ${login}`);

  const bu = await backup.query(`SELECT id FROM usuarios WHERE lower(login) = $1`, [login]);
  const backupUserId = bu.rows[0]?.id;
  if (!backupUserId) throw new Error(`Usuário ${login} não encontrado no backup`);

  const atuais = await pool.query(`SELECT id FROM tasks WHERE user_id = $1`, [userId]);
  const idsAtuais = new Set(atuais.rows.map((r) => r.id));

  const backupTasks = await backup.query(
    `SELECT * FROM tasks WHERE user_id = $1 ORDER BY data_reset ASC`,
    [backupUserId]
  );

  const faltando = backupTasks.rows.filter((t) => !idsAtuais.has(t.id));
  console.log(`Backup: ${backupTasks.rows.length} tasks | Atual: ${idsAtuais.size} | A restaurar: ${faltando.length}`);

  if (!faltando.length) {
    console.log('Nada a restaurar — ids já existem ou backup igual ao atual.');
    await backup.end();
    process.exit(0);
  }

  if (dryRun) {
    console.log('Dry-run — amostra:', faltando.slice(0, 5).map((t) => ({
      id: t.id,
      titulo: t.titulo,
      data_reset: t.data_reset,
      concluida: t.concluida
    })));
    await backup.end();
    process.exit(0);
  }

  let inseridas = 0;
  for (const t of faltando) {
    await pool.query(
      `INSERT INTO tasks (
         id, titulo, descricao, prioridade, categoria, concluida, data_reset,
         hora, data_criacao, concluida_em, user_id
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       ON CONFLICT (id) DO NOTHING`,
      [
        t.id, t.titulo, t.descricao, t.prioridade, t.categoria, t.concluida,
        t.data_reset, t.hora, t.data_criacao, t.concluida_em, userId
      ]
    );
    inseridas++;
  }

  const depois = await pool.query(`SELECT COUNT(*)::int AS n FROM tasks WHERE user_id = $1`, [userId]);
  console.log(`Restauradas ${inseridas} task(s). Total agora: ${depois.rows[0].n}`);

  await backup.end();
  process.exit(0);
}

main().catch(async (e) => {
  console.error(e);
  process.exit(1);
});
