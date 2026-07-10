const { Pool } = require('pg');

const connectionString = process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/app_rotina';
// Banco na nuvem (Neon/Supabase/Railway) exige SSL; local não
const isLocal = /localhost|127\.0\.0\.1/.test(connectionString);

const pool = new Pool({
  connectionString,
  ssl: isLocal ? false : { rejectUnauthorized: false }
});

pool.on('error', (err) => {
  console.error('Pool error:', err);
});

// Cria tabelas se nao existirem
// Cache: só roda o schema completo 1x/dia (32 ALTERs no Neon = 6-10s por boot)
async function initDB() {
  try {
    // Guarda dupla: tabela mínima primeiro, depois pula o resto se recente
    await pool.query(`
      CREATE TABLE IF NOT EXISTS app_estado (
        chave TEXT PRIMARY KEY,
        valor TEXT,
        atualizado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    const check = await pool.query(`SELECT valor FROM app_estado WHERE chave = 'schema_last_init'`);
    const ultimo = check.rows[0] ? Number(check.rows[0].valor) : 0;
    const agora = Date.now();
    if (ultimo && (agora - ultimo) < 24 * 60 * 60 * 1000) {
      console.log('PostgreSQL conectado (schema recente, skip)');
      return;
    }
    await pool.query(`
      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
        titulo TEXT NOT NULL,
        descricao TEXT,
        prioridade TEXT DEFAULT 'media',
        categoria TEXT DEFAULT 'geral',
        concluida BOOLEAN DEFAULT false,
        data_criacao TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        data_reset TIMESTAMP,
        ordem INTEGER DEFAULT 0
      )
    `);

    // Adiciona colunas se ja existir tabela antiga
    await pool.query(`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS descricao TEXT`).catch(() => {});
    await pool.query(`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS prioridade TEXT DEFAULT 'media'`).catch(() => {});
    await pool.query(`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS categoria TEXT DEFAULT 'geral'`).catch(() => {});
    await pool.query(`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS hora TEXT`).catch(() => {});

    await pool.query(`
      CREATE TABLE IF NOT EXISTS financeiro (
        id TEXT PRIMARY KEY,
        tipo TEXT NOT NULL,
        valor DECIMAL(10,2) NOT NULL,
        descricao TEXT,
        data DATE DEFAULT CURRENT_DATE,
        categoria TEXT DEFAULT 'outros',
        criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Open Finance: origem e id externo (dedupe ao sincronizar)
    await pool.query(`ALTER TABLE financeiro ADD COLUMN IF NOT EXISTS external_id TEXT`).catch(() => {});
    await pool.query(`ALTER TABLE financeiro ADD COLUMN IF NOT EXISTS fonte TEXT DEFAULT 'manual'`).catch(() => {});
    await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_financeiro_external ON financeiro (external_id) WHERE external_id IS NOT NULL`).catch(() => {});
    // Multi-conta: qual conta/banco originou a transação
    await pool.query(`ALTER TABLE financeiro ADD COLUMN IF NOT EXISTS account_id TEXT`).catch(() => {});
    // Categorização com aprendizado
    await pool.query(`ALTER TABLE financeiro ADD COLUMN IF NOT EXISTS categoria_confirmada BOOLEAN DEFAULT false`).catch(() => {});
    await pool.query(`ALTER TABLE financeiro ADD COLUMN IF NOT EXISTS chave_categoria TEXT`).catch(() => {});
    // Regras aprendidas: chave (estabelecimento/descrição normalizada) -> categoria
    await pool.query(`
      CREATE TABLE IF NOT EXISTS categoria_regras (
        chave TEXT PRIMARY KEY,
        categoria TEXT NOT NULL,
        exemplo TEXT,
        criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Catálogo de categorias (seed + custom). chave = normalized(label) sem acento/espaço/lowercase
    await pool.query(`
      CREATE TABLE IF NOT EXISTS categorias (
        chave TEXT PRIMARY KEY,
        label TEXT NOT NULL,
        criado_por_usuario BOOLEAN DEFAULT false,
        criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    const seed = [
      ['receita_trabalho','Receita de trabalho'], ['transferencia','Transferência'],
      ['alimentacao','Alimentação'], ['contas_fixas','Contas fixas'],
      ['moradia','Moradia'], ['transporte','Transporte'], ['lazer','Lazer'],
      ['apostas','Apostas'], ['compras','Compras'], ['assinaturas','Assinaturas'],
      ['saude','Saúde'], ['educacao','Educação'],
      ['pj_receita','PJ: Receita de serviço'], ['pj_despesa','PJ: Despesa dedutível'],
      ['outros','Outros']
    ];
    for (const [k, l] of seed) {
      await pool.query(`INSERT INTO categorias (chave, label) VALUES ($1,$2) ON CONFLICT (chave) DO NOTHING`, [k, l]).catch(() => {});
    }

    // Estado do app (chave-valor) — substitui o localStorage (orçamentos, reserva, IR, etc.)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS app_estado (
        chave TEXT PRIMARY KEY,
        valor TEXT,
        atualizado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Apostas: autor ('eu' se participei) + amigo e a parte dele (aposta em conjunto/dividida)
    await pool.query(`ALTER TABLE financeiro ADD COLUMN IF NOT EXISTS aposta_autor TEXT`).catch(() => {});
    await pool.query(`ALTER TABLE financeiro ADD COLUMN IF NOT EXISTS aposta_amigo TEXT`).catch(() => {});
    await pool.query(`ALTER TABLE financeiro ADD COLUMN IF NOT EXISTS aposta_amigo_valor DECIMAL(12,2)`).catch(() => {});
    // Pagamentos avulsos de amigos (acerto de contas de apostas)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS apostas_pagamentos (
        id SERIAL PRIMARY KEY,
        amigo TEXT NOT NULL,
        valor DECIMAL(12,2) NOT NULL,
        descricao TEXT,
        data DATE DEFAULT CURRENT_DATE,
        criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Metas financeiras
    await pool.query(`
      CREATE TABLE IF NOT EXISTS metas (
        id SERIAL PRIMARY KEY,
        nome TEXT NOT NULL,
        valor_total DECIMAL(12,2) NOT NULL,
        prazo DATE,
        prioridade INTEGER DEFAULT 1,
        concluida BOOLEAN DEFAULT false,
        criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Depósitos feitos em cada meta (histórico + saldo)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS metas_depositos (
        id SERIAL PRIMARY KEY,
        meta_id INTEGER REFERENCES metas(id) ON DELETE CASCADE,
        valor DECIMAL(12,2) NOT NULL,
        data DATE DEFAULT CURRENT_DATE,
        descricao TEXT,
        criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // DAS mensal do MEI (controle de pagamento)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS mei_das (
        ym TEXT PRIMARY KEY,
        valor DECIMAL(10,2),
        pago BOOLEAN DEFAULT false,
        data_pagamento DATE,
        criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Bancos conectados via Open Finance (Pluggy)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS openfinance_items (
        item_id TEXT PRIMARY KEY,
        connector_nome TEXT,
        status TEXT DEFAULT 'ativo',
        ultima_sync TIMESTAMP,
        criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Multi-conta: PF/PJ e apelido de cada banco conectado
    await pool.query(`ALTER TABLE openfinance_items ADD COLUMN IF NOT EXISTS pessoa TEXT DEFAULT 'PF'`).catch(() => {});
    await pool.query(`ALTER TABLE openfinance_items ADD COLUMN IF NOT EXISTS apelido TEXT`).catch(() => {});

    // Contas (saldos reais) de cada item conectado
    await pool.query(`
      CREATE TABLE IF NOT EXISTS openfinance_accounts (
        account_id TEXT PRIMARY KEY,
        item_id TEXT,
        tipo TEXT,
        nome TEXT,
        saldo DECIMAL(12,2) DEFAULT 0,
        atualizado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    // saldo_em = quando o Pluggy de fato falou com o banco (data real do saldo)
    await pool.query(`ALTER TABLE openfinance_accounts ADD COLUMN IF NOT EXISTS saldo_em TIMESTAMP`).catch(() => {});

    await pool.query(`
      CREATE TABLE IF NOT EXISTS alarmes (
        id TEXT PRIMARY KEY,
        hora TEXT NOT NULL,
        mensagem TEXT NOT NULL,
        repeticao TEXT DEFAULT 'diario',
        ativo BOOLEAN DEFAULT true,
        criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await pool.query(`ALTER TABLE alarmes ADD COLUMN IF NOT EXISTS repeticao TEXT DEFAULT 'diario'`).catch(() => {});

    // Tarefas Recorrentes - templates que recriam automaticamente
    await pool.query(`
      CREATE TABLE IF NOT EXISTS tarefas_recorrentes (
        id TEXT PRIMARY KEY,
        titulo TEXT NOT NULL,
        descricao TEXT DEFAULT '',
        prioridade TEXT DEFAULT 'media',
        categoria TEXT DEFAULT 'geral',
        frequencia TEXT DEFAULT 'diario',
        dias_semana TEXT DEFAULT '0,1,2,3,4,5,6',
        ativa BOOLEAN DEFAULT true,
        ultima_criacao DATE,
        criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Eventos do calendário
    await pool.query(`
      CREATE TABLE IF NOT EXISTS eventos (
        id TEXT PRIMARY KEY,
        titulo TEXT NOT NULL,
        descricao TEXT DEFAULT '',
        data DATE NOT NULL,
        hora TEXT,
        tipo TEXT DEFAULT 'evento',
        cor TEXT DEFAULT 'blue',
        criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS task_historico (
        id SERIAL PRIMARY KEY,
        data DATE UNIQUE NOT NULL,
        total INTEGER DEFAULT 0,
        concluidas INTEGER DEFAULT 0,
        por_categoria JSONB DEFAULT '{}',
        por_prioridade JSONB DEFAULT '{}'
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

    // Índices — queries usadas com muita frequência
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_financeiro_data_tipo ON financeiro (data, tipo)`).catch(() => {});
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_financeiro_categoria ON financeiro (categoria)`).catch(() => {});
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_financeiro_account ON financeiro (account_id) WHERE account_id IS NOT NULL`).catch(() => {});
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_financeiro_chave ON financeiro (chave_categoria) WHERE chave_categoria IS NOT NULL`).catch(() => {});
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_tasks_data_reset ON tasks (data_reset)`).catch(() => {});
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_metas_depositos_meta ON metas_depositos (meta_id)`).catch(() => {});
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_of_accounts_item ON openfinance_accounts (item_id)`).catch(() => {});

    // Marca que o schema foi criado agora — próximas 24h pulam este bloco
    await pool.query(
      `INSERT INTO app_estado (chave, valor, atualizado_em) VALUES ('schema_last_init', $1, CURRENT_TIMESTAMP)
       ON CONFLICT (chave) DO UPDATE SET valor = EXCLUDED.valor, atualizado_em = CURRENT_TIMESTAMP`,
      [String(Date.now())]
    );
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
