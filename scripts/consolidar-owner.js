#!/usr/bin/env node
/** Move dados do mateus (ou conta com mais dados) para teus. */
require('dotenv').config();
const { initDB, all } = require('../lib/db');
const { consolidarContasDuplicadas } = require('../lib/migrate-multiuser');

async function main() {
  await initDB();
  const login = (process.env.OWNER_LOGIN || 'teus').toLowerCase();
  const ok = await consolidarContasDuplicadas(login);

  const rows = await all(`
    SELECT u.login,
      (SELECT COUNT(*)::int FROM tasks WHERE user_id = u.id) AS tasks,
      (SELECT COUNT(*)::int FROM financeiro WHERE user_id = u.id) AS financeiro
    FROM usuarios u WHERE u.ativo = true ORDER BY u.login
  `);
  console.log('Usuários após consolidação:', rows);
  console.log(ok ? 'Consolidado com sucesso.' : 'Nada a consolidar (teus já tem os dados).');
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
