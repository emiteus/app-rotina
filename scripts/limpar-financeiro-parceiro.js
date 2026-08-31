#!/usr/bin/env node
/** Remove dados financeiros vazados do plano do owner para outro usuário. */
require('dotenv').config({ quiet: true });
const { initDB, get, run, all } = require('../lib/db');
const { isPlanoOwnerUserId, OWNER_LOGIN } = require('../lib/plano-owner');

const alvo = (process.argv[2] || 'eriktizon').toLowerCase();

async function main() {
  await initDB();
  const u = await get(`SELECT id, login, nome FROM usuarios WHERE lower(login) = $1`, [alvo]);
  if (!u) {
    console.log('Usuário não encontrado:', alvo);
    process.exit(0);
  }
  if (await isPlanoOwnerUserId(u.id)) {
    console.log('Recusado: é a conta owner.');
    process.exit(1);
  }

  console.log(`Limpando financeiro vazado de ${u.login} (${u.nome})…`);

  const tabelas = [
    'financeiro',
    'despesas_mes',
    'receitas_mes',
    'metas_depositos',
    'metas',
    'mei_das',
    'openfinance_items'
  ];

  for (const t of tabelas) {
    const r = await run(`DELETE FROM ${t} WHERE user_id = $1`, [u.id]);
    if (r.rowCount) console.log(`  ${t}: ${r.rowCount}`);
  }

  await run(`DELETE FROM app_estado WHERE user_id = $1`, [u.id]).catch(() => {});
  await run(`DELETE FROM categoria_regras WHERE user_id = $1`, [u.id]).catch(() => {});

  // Contas OF órfãs (sem item do user)
  const items = await all(`SELECT item_id FROM openfinance_items WHERE user_id = $1`, [u.id]);
  if (items.length) {
    const ids = items.map((i) => i.item_id);
    await run(`DELETE FROM openfinance_accounts WHERE item_id = ANY($1::text[])`, [ids]);
  }

  console.log(`\nPronto. Owner (${OWNER_LOGIN}) não foi alterado.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
