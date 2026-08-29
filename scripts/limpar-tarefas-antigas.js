#!/usr/bin/env node
/**
 * DESATIVADO por padrão — apaga tasks individuais de dias antigos.
 * Só rode com --confirm explícito. Histórico agregado (task_historico) não é apagado.
 */
require('dotenv').config({ quiet: true });
const { initDB, pool } = require('../lib/db');
const { limparTarefasAntigas, limparTarefasAntigasTodos } = require('../lib/limpar-tarefas-antigas');

async function main() {
  if (!process.argv.includes('--confirm')) {
    console.error('ABORTADO: passe --confirm para executar. Ex.: node scripts/limpar-tarefas-antigas.js teus --confirm');
    process.exit(1);
  }
  await initDB();
  const alvo = (process.argv[2] || 'todos').toLowerCase();
  let result;
  if (alvo === 'todos') {
    result = await limparTarefasAntigasTodos();
  } else {
    const u = await pool.query(`SELECT id FROM usuarios WHERE lower(login) = $1`, [alvo]);
    if (!u.rows[0]) throw new Error(`Usuário não encontrado: ${alvo}`);
    result = await limparTarefasAntigas(u.rows[0].id);
    console.log(`Limpeza ${alvo}:`, result);
  }
  if (alvo === 'todos') console.log('Limpeza todos:', result);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
