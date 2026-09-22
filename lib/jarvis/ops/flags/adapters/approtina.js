/**
 * Approtina live adapter — runtime flags in DB (__system__).
 * Host (server.js) must check isApprotinaFlagEnabled before crons/proactive.
 */
const store = require('../store');

const SYSTEM_USER = '__system__';
const PROJECT = 'approtina';

const KEYS = ['crons', 'proactive_wa'];

async function listRemote() {
  const rows = await store.listFlags(SYSTEM_USER, PROJECT);
  const byKey = new Map(rows.map((r) => [r.key, r]));
  return {
    ok: true,
    flags: KEYS.map((key) => {
      const r = byKey.get(key);
      return {
        key,
        enabled: r ? r.enabled !== false : true,
        note: r ? r.note : null,
        updated_at: r ? r.updated_at : null,
        source: r ? 'runtime' : 'default'
      };
    })
  };
}

async function setRemote(key, enabled, note) {
  if (!KEYS.includes(key)) {
    return { ok: false, erro: `flag desconhecida no Approtina: ${key}`, live: false, synced: false };
  }
  try {
    const saved = await store.upsertFlag(SYSTEM_USER, PROJECT, key, {
      enabled: enabled !== false,
      note: note || null,
      synced: true,
      live: true,
      remote: { source: 'approtina-db' }
    });
    return {
      ok: true,
      live: true,
      synced: true,
      flag: {
        key: saved.key,
        enabled: saved.enabled,
        note: saved.note,
        updated_at: saved.updated_at,
        source: 'runtime'
      }
    };
  } catch (e) {
    return {
      ok: false,
      erro: e.message || 'falha ao gravar flag Approtina',
      live: false,
      synced: false
    };
  }
}

/** Used by Approtina host (server / events). Default = on. */
async function isApprotinaFlagEnabled(key) {
  if (!KEYS.includes(key)) return true;
  try {
    const row = await store.getFlag(SYSTEM_USER, PROJECT, key);
    if (!row) return true;
    return row.enabled !== false;
  } catch {
    return true;
  }
}

module.exports = {
  name: 'approtina',
  listRemote,
  setRemote,
  isApprotinaFlagEnabled,
  KEYS,
  SYSTEM_USER,
  PROJECT
};
