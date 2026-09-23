/**
 * Dispositivos do Jarvis (Fase 2 MCU) — pareamento por código de uso único + token por aparelho.
 * Banco guarda só hash (sha256) do código e do token: vazou o banco, não vazou acesso.
 */
const crypto = require('crypto');
const { get, run, all } = require('../host').requireLib('db');
const { once } = require('../db-once');

const PAIR_TTL_MS = 10 * 60 * 1000;
// Só caracteres que não se confundem na fonte do WhatsApp: fora 0/O, 1/I, 2/Z, 5/S, 6/G, 8/B
// (o 1º código real, 6Z2N-GTKS, tinha 3 pares desses e não passou)
const ALPHABET = 'ACDEFHJKLMNPQRTUVWXY34679';

const ensureTables = once(async () => {
  await run(`
    CREATE TABLE IF NOT EXISTS jarvis_devices (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      conversa_id TEXT,
      criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      last_seen TIMESTAMP,
      revoked_at TIMESTAMP
    )
  `);
  await run(`
    CREATE TABLE IF NOT EXISTS jarvis_pair_codes (
      code_hash TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      expires_at TIMESTAMP NOT NULL,
      used_at TIMESTAMP
    )
  `);
});

const sha256 = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');

function normalizeCode(code) {
  return String(code || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

function newCode() {
  let out = '';
  for (let i = 0; i < 8; i++) out += ALPHABET[crypto.randomInt(ALPHABET.length)];
  return `${out.slice(0, 4)}-${out.slice(4)}`;
}

/** Código novo invalida os anteriores não usados do mesmo usuário. */
async function createPairCode(userId) {
  await ensureTables();
  await run(`DELETE FROM jarvis_pair_codes WHERE user_id = $1 AND used_at IS NULL`, [userId]);
  const code = newCode();
  const expiresAt = new Date(Date.now() + PAIR_TTL_MS);
  // Validade calculada no próprio banco (mesma base do NOW() da validação) — sem
  // ida e volta de fuso entre JS (UTC) e coluna TIMESTAMP na sessão America/Sao_Paulo
  await run(
    `INSERT INTO jarvis_pair_codes (code_hash, user_id, expires_at)
     VALUES ($1, $2, NOW() + ($3 || ' milliseconds')::interval)`,
    [sha256(normalizeCode(code)), userId, String(PAIR_TTL_MS)]
  );
  return { code, expiresAt };
}

/** Troca código válido (uso único, dentro do TTL) por um token de aparelho. */
async function redeemPairCode(code, name) {
  await ensureTables();
  const norm = normalizeCode(code);
  if (norm.length !== 8) return null;
  const row = await get(
    `UPDATE jarvis_pair_codes SET used_at = CURRENT_TIMESTAMP
     WHERE code_hash = $1 AND used_at IS NULL AND expires_at > NOW()
     RETURNING user_id`,
    [sha256(norm)]
  );
  if (!row) {
    // Motivo só no log (pro cliente a resposta é genérica — não vira oráculo de código)
    const why = await get(
      `SELECT used_at IS NOT NULL AS usado, expires_at <= NOW() AS expirado FROM jarvis_pair_codes WHERE code_hash = $1`,
      [sha256(norm)]
    ).catch(() => null);
    const reason = !why ? 'nao_existe' : why.usado ? 'ja_usado' : why.expirado ? 'expirado' : 'desconhecido';
    console.log(JSON.stringify({ tag: 'jarvis.device', event: 'pair_fail', reason }));
    return null;
  }
  const deviceId = `dev_${crypto.randomBytes(5).toString('hex')}`;
  const token = `jdv_${crypto.randomBytes(32).toString('base64url')}`;
  const safeName = String(name || 'PC').replace(/[^\p{L}\p{N} ._-]/gu, '').trim().slice(0, 40) || 'PC';
  await run(
    `INSERT INTO jarvis_devices (id, user_id, name, token_hash) VALUES ($1,$2,$3,$4)`,
    [deviceId, row.user_id, safeName, sha256(token)]
  );
  console.log(JSON.stringify({ tag: 'jarvis.device', event: 'paired', deviceId, userId: row.user_id }));
  return { deviceId, token, name: safeName, userId: row.user_id };
}

function hydrate(row) {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    conversaId: row.conversa_id || null,
    lastSeen: row.last_seen || null,
    revoked: !!row.revoked_at,
    criadoEm: row.criado_em
  };
}

async function authenticateToken(token) {
  const t = String(token || '');
  if (!/^jdv_[A-Za-z0-9_-]{20,}$/.test(t)) return null;
  await ensureTables();
  const row = await get(
    `UPDATE jarvis_devices SET last_seen = CURRENT_TIMESTAMP
     WHERE token_hash = $1 AND revoked_at IS NULL
     RETURNING *`,
    [sha256(t)]
  );
  return row ? hydrate(row) : null;
}

async function setDeviceConversa(deviceId, conversaId) {
  await ensureTables();
  await run(`UPDATE jarvis_devices SET conversa_id = $2 WHERE id = $1`, [deviceId, conversaId]);
}

async function listDevices(userId) {
  await ensureTables();
  const rows = await all(
    `SELECT * FROM jarvis_devices WHERE user_id = $1 AND revoked_at IS NULL ORDER BY criado_em DESC`,
    [userId]
  );
  return (rows || []).map(hydrate);
}

async function revokeDevice(userId, idPrefix) {
  await ensureTables();
  const prefix = String(idPrefix || '').toLowerCase().replace(/[^a-z0-9_]/g, '');
  if (prefix.length < 4) return null;
  const like = prefix.startsWith('dev_') ? `${prefix}%` : `dev_${prefix}%`;
  const row = await get(
    `UPDATE jarvis_devices SET revoked_at = CURRENT_TIMESTAMP
     WHERE id = (SELECT id FROM jarvis_devices WHERE user_id = $1 AND id LIKE $2 AND revoked_at IS NULL LIMIT 1)
     RETURNING *`,
    [userId, like]
  );
  return row ? hydrate(row) : null;
}

module.exports = {
  PAIR_TTL_MS,
  normalizeCode,
  createPairCode,
  redeemPairCode,
  authenticateToken,
  setDeviceConversa,
  listDevices,
  revokeDevice
};
