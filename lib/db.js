const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/app_rotina'
});

pool.on('error', (err) => {
  console.error('Pool error:', err);
});

// Cria tabelas se nao existirem
async function initDB() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
        titulo TEXT NOT NULL,
        concluida BOOLEAN DEFAULT false,
        data_criacao TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        data_reset TIMESTAMP,
        ordem INTEGER DEFAULT 0
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS financeiro (
        id TEXT PRIMARY KEY,
        tipo TEXT NOT NULL,
        valor DECIMAL(10,2) NOT NULL,
        descricao TEXT,
        data DATE,
        categoria TEXT,
        criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS alarmes (
        id TEXT PRIMARY KEY,
        hora TEXT NOT NULL,
        mensagem TEXT NOT NULL,
        ativo BOOLEAN DEFAULT true,
        criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS telegram_config (
        id SERIAL PRIMARY KEY,
        chat_id TEXT NOT NULL,
        user_id TEXT,
        criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    console.log('PostgreSQL conectado e tabelas criadas');
  } catch (err) {
    console.error('Erro ao inicializar BD:', err);
  }
}

// Helpers
const run = async (sql, params = []) => {
  const result = await pool.query(sql, params);
  return result;
};

const get = async (sql, params = []) => {
  const result = await pool.query(sql, params);
  return result.rows[0];
};

const all = async (sql, params = []) => {
  const result = await pool.query(sql, params);
  return result.rows || [];
};

module.exports = { pool, initDB, run, get, all };
