/**
 * WhatsApp phone → App Rotina user mapping (multi-user).
 *
 * WHATSAPP_PHONE_USERS=5584999999999:teus,5584888888888:maria
 * Phones still need to pass whitelist (WHATSAPP_ALLOWED_PHONES) OR appear in this map.
 * Default (sem map): comportamento antigo — whitelist → owner.
 */
const { get } = require('../db');
const { OWNER_LOGIN } = require('../plano-owner');
const { normalizeWaId, phoneVariants, phonesAllowed } = require('../evolution');

function parsePhoneUserMap() {
  const raw = process.env.WHATSAPP_PHONE_USERS || '';
  const map = new Map(); // normalized phone → login
  for (const part of raw.split(/[,;]+/)) {
    const bit = part.trim();
    if (!bit) continue;
    const m = bit.match(/^(\d{10,15})\s*[:=]\s*([a-zA-Z0-9_.\-]+)$/);
    if (!m) continue;
    const phone = normalizeWaId(m[1]);
    const login = String(m[2]).toLowerCase();
    if (!phone || !login) continue;
    for (const v of phoneVariants(phone)) map.set(v, login);
  }
  return map;
}

function isPhoneMappedOrAllowed(phone) {
  const map = parsePhoneUserMap();
  const variants = phoneVariants(phone);
  if (variants.some((v) => map.has(v))) return true;
  const list = phonesAllowed();
  if (!list.length && map.size) return false;
  const allowed = new Set(list.flatMap((a) => phoneVariants(a)));
  return variants.some((v) => allowed.has(v));
}

async function ownerUserId() {
  const row = await get(
    `SELECT id FROM usuarios WHERE lower(login) = $1 AND ativo = true`,
    [OWNER_LOGIN]
  );
  return row?.id || null;
}

async function userIdByLogin(login) {
  if (!login) return null;
  const row = await get(
    `SELECT id, login FROM usuarios WHERE lower(login) = $1 AND ativo = true`,
    [String(login).toLowerCase()]
  );
  return row?.id || null;
}

/**
 * Resolve which App Rotina user owns this WhatsApp phone.
 */
async function resolveUserIdForPhone(phone) {
  const map = parsePhoneUserMap();
  const variants = phoneVariants(phone);
  for (const v of variants) {
    const login = map.get(v);
    if (login) {
      const uid = await userIdByLogin(login);
      if (uid) {
        return { userId: uid, login, source: 'map' };
      }
    }
  }
  // Legacy: any whitelisted phone → owner
  const list = phonesAllowed();
  const allowed = new Set(list.flatMap((a) => phoneVariants(a)));
  if (variants.some((v) => allowed.has(v))) {
    const uid = await ownerUserId();
    return uid
      ? { userId: uid, login: OWNER_LOGIN, source: 'owner_whitelist' }
      : null;
  }
  return null;
}

function phoneMapStatus() {
  const map = parsePhoneUserMap();
  const entries = [];
  const seen = new Set();
  for (const [phone, login] of map.entries()) {
    const key = `${login}:${phone.slice(0, 6)}`;
    if (seen.has(login)) continue;
    seen.add(login);
    entries.push({ login, phoneSample: phone });
  }
  return {
    mappedLogins: entries.length,
    entries,
    fallbackOwner: true
  };
}

module.exports = {
  parsePhoneUserMap,
  isPhoneMappedOrAllowed,
  resolveUserIdForPhone,
  ownerUserId,
  phoneMapStatus
};
