#!/usr/bin/env node
/**
 * Cria/atualiza contas de usuário (Mateus + colega).
 * Uso:
 *   node scripts/seed-usuarios.js
 *   COLEGA_LOGIN=joao COLEGA_SENHA=temp123 COLEGA_NOME="João" node scripts/seed-usuarios.js
 */
require('dotenv').config();
const { v4: uuid } = require('uuid');
const { initDB, get, run } = require('../lib/db');
const { hashSenha } = require('../lib/password');

async function upsertUser({ id, login, nome, senha, cor }) {
  const existing = await get(`SELECT id FROM usuarios WHERE lower(login) = $1`, [login.toLowerCase()]);
  const userId = existing?.id || id || uuid();
  await run(
    `INSERT INTO usuarios (id, login, nome, senha_hash, cor, ativo)
     VALUES ($1,$2,$3,$4,$5,true)
     ON CONFLICT (login) DO UPDATE SET
       nome = EXCLUDED.nome,
       senha_hash = EXCLUDED.senha_hash,
       cor = EXCLUDED.cor,
       ativo = true`,
    [userId, login.toLowerCase(), nome, hashSenha(senha), cor || '#f97316']
  );
  return userId;
}

async function main() {
  await initDB();

  const ownerLogin = process.env.OWNER_LOGIN || 'mateus';
  const ownerNome = process.env.OWNER_NOME || 'Mateus';
  const ownerSenha = process.env.OWNER_SENHA || process.env.APP_PASSWORD || 'senha123';

  const ownerId = await upsertUser({
    login: ownerLogin,
    nome: ownerNome,
    senha: ownerSenha,
    cor: '#f97316'
  });
  console.log(`[seed] Owner: login=${ownerLogin} id=${ownerId}`);

  const colegaLogin = process.env.COLEGA_LOGIN || 'colega';
  const colegaNome = process.env.COLEGA_NOME || 'Colega';
  const colegaSenha = process.env.COLEGA_SENHA || process.env.COLEGA_PASSWORD || 'colega123';

  const colegaId = await upsertUser({
    login: colegaLogin,
    nome: colegaNome,
    senha: colegaSenha,
    cor: process.env.COLEGA_COR || '#3b82f6'
  });
  console.log(`[seed] Colega: login=${colegaLogin} id=${colegaId} senha=${colegaSenha}`);

  console.log('\nPróximos passos:');
  console.log('1. Deploy com backup do Postgres');
  console.log('2. Passe URL + credenciais do colega');
  console.log('3. Cada um conecta bancos Open Finance separadamente');
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
