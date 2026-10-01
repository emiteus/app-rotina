/**
 * Banco novo e vazio por arquivo de teste, criado no servidor de TEST_DATABASE_URL e apagado no fim.
 * Nunca usa o DATABASE_URL do .env (que aponta pra banco de verdade).
 */
const { Client } = require('pg');

function urlCom(base, banco) {
  const u = new URL(base);
  u.pathname = `/${banco}`;
  return u.toString();
}

/** @returns {Promise<{ url: string, apagar: () => Promise<void> } | null>} null = sem TEST_DATABASE_URL */
async function bancoNovo(prefixo) {
  const base = process.env.TEST_DATABASE_URL;
  if (!base) return null;
  const nome = `${prefixo}_${Date.now()}_${process.pid}`.toLowerCase().replace(/[^a-z0-9_]/g, '_');
  const admin = new Client({ connectionString: base });
  await admin.connect();
  await admin.query(`CREATE DATABASE "${nome}"`);
  await admin.end();
  return {
    url: urlCom(base, nome),
    apagar: async () => {
      const c = new Client({ connectionString: base });
      await c.connect();
      await c.query(`DROP DATABASE IF EXISTS "${nome}" WITH (FORCE)`);
      await c.end();
    }
  };
}

module.exports = { bancoNovo };
