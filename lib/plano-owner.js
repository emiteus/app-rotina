const { get } = require('./db');

const OWNER_LOGIN = (process.env.OWNER_LOGIN || 'teus').toLowerCase();

/** Plano financeiro hardcoded é só do dono da conta (Mateus). Outros usuários começam vazios. */
async function isPlanoOwnerUserId(userId) {
  if (!userId) return false;
  const row = await get(`SELECT lower(login) AS login FROM usuarios WHERE id = $1 AND ativo = true`, [userId]);
  return !!(row && row.login === OWNER_LOGIN);
}

function isPlanoOwnerLogin(login) {
  return String(login || '').trim().toLowerCase() === OWNER_LOGIN;
}

module.exports = { isPlanoOwnerUserId, isPlanoOwnerLogin, OWNER_LOGIN };
