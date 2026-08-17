/* Migra dados do Neon pro Supabase, tabela por tabela.
   - Só INSERT (schema já existe no Supabase)
   - ON CONFLICT DO NOTHING pra tabelas com PK conhecida
   - Ordem manual pra evitar violação de PK entre categorias/tasks
*/
const { Client } = require('pg');

const NEON_URL = process.env.NEON_URL;
const SUPABASE_URL_MIG = process.env.SUPABASE_URL_MIG;

if (!NEON_URL || !SUPABASE_URL_MIG) {
  console.error('Env NEON_URL e SUPABASE_URL_MIG obrigatorias');
  process.exit(1);
}

const TABLES = [
  { name: 'app_estado',            pk: ['chave'] },
  { name: 'categorias',            pk: ['chave'] },
  { name: 'categoria_regras',      pk: ['chave'] },
  { name: 'tasks',                 pk: ['id'] },
  { name: 'task_historico',        pk: null },
  { name: 'tarefas_recorrentes',   pk: ['id'] },
  { name: 'financeiro',            pk: ['id'] },
  { name: 'alarmes',               pk: ['id'] },
  { name: 'eventos',               pk: ['id'] },
  { name: 'metas',                 pk: ['id'] },
  { name: 'metas_depositos',       pk: ['id'] },
  { name: 'mei_das',               pk: ['id'] },
  { name: 'apostas_pagamentos',    pk: ['id'] },
  { name: 'openfinance_items',     pk: ['id'] },
  { name: 'openfinance_accounts',  pk: ['id'] },
  { name: 'push_subscriptions',    pk: ['endpoint'] },
  { name: 'telegram_config',       pk: null },
];

(async () => {
  const src = new Client({ connectionString: NEON_URL });
  const dst = new Client({ connectionString: SUPABASE_URL_MIG });
  await src.connect();
  await dst.connect();

  let total = 0, inserted = 0;

  for (const t of TABLES) {
    const rows = (await src.query(`SELECT * FROM ${t.name}`)).rows;
    if (rows.length === 0) {
      console.log(`${t.name.padEnd(25)} 0 (skip)`);
      continue;
    }
    const cols = Object.keys(rows[0]);
    const colList = cols.map(c => `"${c}"`).join(', ');
    const conflictClause = t.pk
      ? `ON CONFLICT (${t.pk.map(c => `"${c}"`).join(',')}) DO NOTHING`
      : 'ON CONFLICT DO NOTHING';

    let ok = 0, dup = 0;
    for (const row of rows) {
      const values = cols.map(c => row[c]);
      const placeholders = cols.map((_, i) => `$${i + 1}`).join(', ');
      try {
        const r = await dst.query(
          `INSERT INTO ${t.name} (${colList}) VALUES (${placeholders}) ${conflictClause}`,
          values
        );
        if (r.rowCount > 0) ok++; else dup++;
      } catch (e) {
        console.error(`  [${t.name}] ERRO row:`, e.message.slice(0, 120));
      }
    }
    total += rows.length;
    inserted += ok;
    console.log(`${t.name.padEnd(25)} ${rows.length} lidas, ${ok} inseridas, ${dup} duplicadas`);
  }

  console.log('---');
  console.log(`TOTAL: ${total} lidas, ${inserted} inseridas`);

  await src.end();
  await dst.end();
})();
