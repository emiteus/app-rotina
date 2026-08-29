const { get } = require('./db');

const SKIP_USER_ID = process.env.SKIP_AUTH === 'true' && process.env.NODE_ENV !== 'production'
  ? (process.env.SKIP_AUTH_USER_ID || 'dev-local')
  : null;

function getUserId(req) {
  if (SKIP_USER_ID) return SKIP_USER_ID;
  return req.session && req.session.userId ? String(req.session.userId) : null;
}

function requireUserId(req, res) {
  const uid = getUserId(req);
  if (!uid) {
    res.status(401).json({ erro: 'Nao autenticado' });
    return null;
  }
  return uid;
}

async function ensureDevUser() {
  if (!SKIP_USER_ID) return;
  const row = await get(`SELECT id FROM usuarios WHERE id = $1`, [SKIP_USER_ID]);
  if (row) return;
  const { hashSenha } = require('./password');
  await require('./db').run(
    `INSERT INTO usuarios (id, login, nome, senha_hash, cor, ativo)
     VALUES ($1,$2,$3,$4,$5,true) ON CONFLICT (id) DO NOTHING`,
    [SKIP_USER_ID, 'dev', 'Dev', hashSenha('dev'), '#f97316']
  );
}

module.exports = { getUserId, requireUserId, ensureDevUser, SKIP_USER_ID };
