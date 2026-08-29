#!/usr/bin/env node
/** Redefine senha de um usuário. Uso: node scripts/reset-senha.js teus novasenha */
require('dotenv').config();
const { initDB, run, get } = require('../lib/db');
const { hashSenha } = require('../lib/password');

async function main() {
  const login = (process.argv[2] || 'teus').toLowerCase();
  const senha = process.argv[3];
  if (!senha) {
    console.error('Uso: node scripts/reset-senha.js <login> <nova-senha>');
    process.exit(1);
  }
  await initDB();
  const u = await get(`SELECT id, login FROM usuarios WHERE lower(login) = $1`, [login]);
  if (!u) {
    console.error('Usuário não encontrado:', login);
    process.exit(1);
  }
  await run(`UPDATE usuarios SET senha_hash = $1 WHERE id = $2`, [hashSenha(senha), u.id]);
  console.log(`Senha de "${login}" atualizada.`);
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
