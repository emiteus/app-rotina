/**
 * Contatos/grupos WhatsApp aprendidos (por usuário) — sem precisar setar env no Railway.
 * Env WHATSAPP_CONTACTS / WHATSAPP_GROUPS continua valendo como seed/override.
 */
const { v4: uuid } = require('uuid');
const { get, all, run } = require('../host').requireLib('db');
const { once } = require('../db-once');

const ensureTable = once(async () => {
  await run(`
    CREATE TABLE IF NOT EXISTS jarvis_wa_contacts (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      alias TEXT NOT NULL,
      dest TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT 'contact',
      criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      atualizado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (user_id, alias)
    )
  `);
  await run(
    `CREATE INDEX IF NOT EXISTS idx_jarvis_wa_contacts_user
     ON jarvis_wa_contacts (user_id, alias)`
  ).catch(() => {});
});

function foldAlias(s) {
  return String(s || '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '')
    .slice(0, 40);
}

async function upsert(userId, alias, dest, { kind = 'contact' } = {}) {
  await ensureTable();
  const a = foldAlias(alias);
  if (a.length < 2) throw new Error('nome do contato muito curto');
  const k = kind === 'group' ? 'group' : 'contact';
  const d = String(dest || '').trim();
  if (!d) throw new Error('falta o número ou id do grupo');
  const id = uuid().replace(/-/g, '').slice(0, 16);
  await run(
    `INSERT INTO jarvis_wa_contacts (id, user_id, alias, dest, kind)
     VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (user_id, alias) DO UPDATE
       SET dest = EXCLUDED.dest, kind = EXCLUDED.kind, atualizado_em = CURRENT_TIMESTAMP`,
    [id, String(userId), a, d, k]
  );
  return { alias: a, dest: d, kind: k };
}

async function forget(userId, alias) {
  await ensureTable();
  const a = foldAlias(alias);
  const row = await get(
    `DELETE FROM jarvis_wa_contacts WHERE user_id = $1 AND alias = $2 RETURNING alias, dest`,
    [String(userId), a]
  );
  return row;
}

async function list(userId, { limit = 50 } = {}) {
  await ensureTable();
  return all(
    `SELECT alias, dest, kind, atualizado_em FROM jarvis_wa_contacts
     WHERE user_id = $1 ORDER BY atualizado_em DESC LIMIT $2`,
    [String(userId), Math.min(100, Math.max(1, limit))]
  );
}

async function getByAlias(userId, alias) {
  await ensureTable();
  const a = foldAlias(alias);
  if (!a) return null;
  return get(
    `SELECT alias, dest, kind FROM jarvis_wa_contacts WHERE user_id = $1 AND alias = $2`,
    [String(userId), a]
  );
}

/**
 * Resolve destino: eu → whitelist; env; DB aprendido; número hint do pedido.
 * Se alias novo + phoneHint → grava e usa.
 */
async function resolveDestination(userId, para, { phoneHint = null, remember = true } = {}) {
  const {
    normalizeWaId,
    phonesAllowed,
    phoneVariants,
    contactsMap,
    groupsMap
  } = require('../host').requireLib('evolution');

  const soft = String(para || '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

  if (!soft || /^(eu|mim|me|dono|owner|meu|voce|você|jarvis)$/.test(soft)) {
    const phones = phonesAllowed();
    if (!phones.length) {
      return { ok: false, erro: 'nenhum número liberado (WHATSAPP_ALLOWED_PHONES)' };
    }
    return { ok: true, to: phones[0], label: 'você', learned: false };
  }

  const alias = foldAlias(soft);
  const envContacts = contactsMap();
  const envGroups = groupsMap();

  if (alias && envContacts.has(alias)) {
    const to = normalizeWaId(envContacts.get(alias));
    if (!to) return { ok: false, erro: `contato "${soft}" com número inválido no env` };
    return { ok: true, to, label: soft, learned: false };
  }
  if (alias && envGroups.has(alias)) {
    const g = String(envGroups.get(alias)).trim();
    if (!/@g\.us$/i.test(g)) {
      return { ok: false, erro: `grupo "${soft}" no env precisa terminar em @g.us` };
    }
    return { ok: true, to: g, label: soft, learned: false };
  }

  const learned = alias ? await getByAlias(userId, alias) : null;
  if (learned) {
    if (learned.kind === 'group' || /@g\.us$/i.test(learned.dest)) {
      return { ok: true, to: learned.dest, label: soft, learned: false };
    }
    const to = normalizeWaId(learned.dest);
    if (!to) return { ok: false, erro: `contato "${soft}" guardado com número inválido` };
    return { ok: true, to, label: soft, learned: false };
  }

  const hint = phoneHint ? normalizeWaId(phoneHint) : null;
  if (alias && hint && remember) {
    await upsert(userId, alias, hint, { kind: 'contact' });
    return {
      ok: true,
      to: hint,
      label: soft,
      learned: true,
      textoExtra: `Guardei o zap de **${soft}**.`
    };
  }

  // para = número puro
  const digits = normalizeWaId(soft);
  if (digits) {
    return { ok: true, to: digits, label: digits, learned: false };
  }

  if (alias && !hint) {
    return {
      ok: false,
      erro: `não tenho o zap de **${soft}** — me passa o número (ex.: "o zap do ${soft} é 55…") que eu guardo e mando`
    };
  }
  return { ok: false, erro: `não entendi o destino "${para}"` };
}

module.exports = {
  foldAlias,
  upsert,
  forget,
  list,
  getByAlias,
  resolveDestination,
  ensureTable
};
