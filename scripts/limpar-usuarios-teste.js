#!/usr/bin/env node
/**
 * Desativa contas de teste que poluem o ranking.
 * Mantém owner + colega (env OWNER_LOGIN / COLEGA_LOGIN).
 */
require('dotenv').config();
const { initDB, all, run } = require('../lib/db');

const MANTER = new Set([
  (process.env.OWNER_LOGIN || 'teus').toLowerCase(),
  (process.env.COLEGA_LOGIN || 'colega').toLowerCase()
]);

const NOMES_TESTE = new Set(['test a', 'test b', 'amigo teste', 'dev']);

async function main() {
  await initDB();
  const usuarios = await all(
    `SELECT id, login, nome, ativo FROM usuarios ORDER BY login`
  );
  console.log('Usuários atuais:');
  for (const u of usuarios) {
    console.log(`  ${u.ativo ? '✓' : '✗'} ${u.login} — ${u.nome}`);
  }

  let desativados = 0;
  for (const u of usuarios) {
    const login = String(u.login).toLowerCase();
    const nome = String(u.nome).toLowerCase();
    const ehTeste =
      !MANTER.has(login) &&
      (NOMES_TESTE.has(nome) ||
        login.startsWith('test_') ||
        login === 'dev');
    if (!ehTeste || !u.ativo) continue;
    await run(`UPDATE usuarios SET ativo = false WHERE id = $1`, [u.id]);
    console.log(`Desativado: ${u.login} (${u.nome})`);
    desativados++;
  }

  console.log(desativados ? `\n${desativados} conta(s) de teste desativada(s).` : '\nNenhuma conta de teste ativa encontrada.');
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
