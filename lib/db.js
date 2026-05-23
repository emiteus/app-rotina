const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, '../data/app.db');

const db = new sqlite3.Database(dbPath, (err) => {
  if (err) console.error('Erro ao conectar BD:', err);
  else console.log('SQLite conectado:', dbPath);
});

// Cria tabelas se nao existirem
function initDB() {
  db.serialize(() => {
    // Tarefas
    db.run(`
      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
        titulo TEXT NOT NULL,
        concluida BOOLEAN DEFAULT 0,
        data_criacao DATETIME DEFAULT CURRENT_TIMESTAMP,
        data_reset DATETIME,
        ordem INTEGER DEFAULT 0
      )
    `);

    // Financeiro
    db.run(`
      CREATE TABLE IF NOT EXISTS financeiro (
        id TEXT PRIMARY KEY,
        tipo TEXT NOT NULL,
        valor REAL NOT NULL,
        descricao TEXT,
        data DATE,
        categoria TEXT,
        criado_em DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Alarmes
    db.run(`
      CREATE TABLE IF NOT EXISTS alarmes (
        id TEXT PRIMARY KEY,
        hora TEXT NOT NULL,
        mensagem TEXT NOT NULL,
        ativo BOOLEAN DEFAULT 1,
        criado_em DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Config Telegram
    db.run(`
      CREATE TABLE IF NOT EXISTS telegram_config (
        id INTEGER PRIMARY KEY,
        chat_id TEXT NOT NULL,
        user_id TEXT,
        criado_em DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);
  });
}

// Helper: executar promise-based
const run = (sql, params = []) => {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function(err) {
      if (err) reject(err);
      else resolve({ id: this.lastID, changes: this.changes });
    });
  });
};

const get = (sql, params = []) => {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
};

const all = (sql, params = []) => {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows || []);
    });
  });
};

module.exports = { db, initDB, run, get, all };
