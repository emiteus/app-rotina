/**
 * CineRush live adapter — Redis runtime flags via /api/admin/ops/flags
 */
const { requireConnector } = require('../../../host');

async function listRemote() {
  const cr = requireConnector('cinerush');
  if (!cr.cinerushReady()) {
    return { ok: false, erro: 'CineRush não configurado', flags: [] };
  }
  if (typeof cr.listOpsFlags !== 'function') {
    return { ok: false, erro: 'Connector sem listOpsFlags — sync host', flags: [] };
  }
  try {
    const out = await cr.listOpsFlags();
    return {
      ok: true,
      flags: (out.flags || []).map((f) => ({
        key: f.key,
        enabled: f.enabled !== false,
        note: f.note || null,
        updated_at: f.updated_at || null,
        source: f.source || 'runtime'
      }))
    };
  } catch (e) {
    return { ok: false, erro: e.message || 'falha ao listar flags', flags: [] };
  }
}

async function getRemote(key) {
  const listed = await listRemote();
  if (!listed.ok) return listed;
  const hit = (listed.flags || []).find((f) => f.key === key);
  if (!hit) {
    return { ok: false, erro: `flag remota desconhecida: ${key}`, flags: listed.flags };
  }
  return { ok: true, flag: hit };
}

async function setRemote(key, enabled, note) {
  const cr = requireConnector('cinerush');
  if (!cr.cinerushReady()) {
    return { ok: false, erro: 'CineRush não configurado', live: false, synced: false };
  }
  if (typeof cr.setOpsFlag !== 'function') {
    return {
      ok: false,
      erro: 'Connector sem setOpsFlag — deploy do backend + sync host',
      live: false,
      synced: false
    };
  }
  try {
    const out = await cr.setOpsFlag(key, enabled, note);
    const flag = out.flag || out;
    return {
      ok: true,
      live: true,
      synced: true,
      flag: {
        key: flag.key || key,
        enabled: flag.enabled !== false,
        note: flag.note || note || null,
        updated_at: flag.updated_at || null,
        source: flag.source || 'runtime'
      }
    };
  } catch (e) {
    return {
      ok: false,
      erro: e.message || 'falha ao gravar flag remota',
      live: false,
      synced: false,
      status: e.status || null
    };
  }
}

module.exports = {
  name: 'cinerush',
  listRemote,
  getRemote,
  setRemote
};
