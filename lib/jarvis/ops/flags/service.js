/**
 * Ops flags service — general for any project_id.
 * With adapter: syncs live backend and reports live/synced.
 * Without adapter: local store only — never claim live pause.
 */
const store = require('./store');
const {
  knownKeysFor,
  flagMeta,
  adapterNameFor,
  hasLiveAdapter
} = require('./registry');
const { getAdapter } = require('./adapters');
const { resolveProject } = require('../../projects/registry');

function resolveProjectId(raw) {
  const q = String(raw || '').trim();
  if (!q) return null;
  const p = resolveProject(q);
  return p ? p.id : q.toLowerCase().replace(/\s+/g, '_').slice(0, 64);
}

function mergeKnownWithStored(projectId, stored, remoteFlags) {
  const keys = new Set([
    ...knownKeysFor(projectId),
    ...stored.map((s) => s.key),
    ...(remoteFlags || []).map((r) => r.key)
  ]);
  const byLocal = new Map(stored.map((s) => [s.key, s]));
  const byRemote = new Map((remoteFlags || []).map((r) => [r.key, r]));

  return [...keys].sort().map((key) => {
    const local = byLocal.get(key);
    const remote = byRemote.get(key);
    const meta = flagMeta(key);
    const liveCapable = hasLiveAdapter(projectId);
    if (remote) {
      return {
        project_id: projectId,
        key,
        label: meta.label,
        enabled: remote.enabled !== false,
        note: remote.note || (local && local.note) || null,
        synced: !!(local && local.synced),
        live: true,
        source: remote.source || 'remote',
        updated_at: remote.updated_at || (local && local.updated_at) || null
      };
    }
    if (local) {
      return {
        ...local,
        label: meta.label,
        live: liveCapable ? !!local.live : false,
        source: 'local'
      };
    }
    return {
      project_id: projectId,
      key,
      label: meta.label,
      enabled: true,
      note: null,
      synced: false,
      live: false,
      source: 'default',
      updated_at: null
    };
  });
}

async function listProjectFlags(userId, projectRaw) {
  const projectId = resolveProjectId(projectRaw);
  if (!projectId) {
    return { ok: false, erro: 'project obrigatório (ex.: cinerush, cutflix, attracione)' };
  }
  const stored = await store.listFlags(userId, projectId);
  const adapter = getAdapter(adapterNameFor(projectId));
  let remoteFlags = [];
  let remoteOk = false;
  let remoteErro = null;
  if (adapter) {
    const rem = await adapter.listRemote();
    remoteOk = !!rem.ok;
    remoteErro = rem.erro || null;
    remoteFlags = rem.flags || [];
  }
  const flags = mergeKnownWithStored(projectId, stored, remoteFlags);
  return {
    ok: true,
    project_id: projectId,
    live_adapter: hasLiveAdapter(projectId),
    remote_ok: remoteOk,
    remote_erro: remoteErro,
    flags,
    aviso: hasLiveAdapter(projectId)
      ? remoteOk
        ? null
        : `Adapter live existe mas remoto falhou${remoteErro ? `: ${remoteErro}` : ''}. Store local ainda vale.`
      : 'Sem adapter live neste projeto — flag fica só no Jarvis (não pausa o backend sozinho).'
  };
}

async function getProjectFlag(userId, projectRaw, key) {
  const listed = await listProjectFlags(userId, projectRaw);
  if (!listed.ok) return listed;
  const k = String(key || '').trim();
  if (!k) return { ok: false, erro: 'key obrigatória' };
  const flag = (listed.flags || []).find((f) => f.key === k);
  if (!flag) {
    return {
      ok: false,
      erro: `flag desconhecida: ${k}`,
      project_id: listed.project_id,
      known: knownKeysFor(listed.project_id)
    };
  }
  return {
    ok: true,
    project_id: listed.project_id,
    live_adapter: listed.live_adapter,
    flag,
    aviso: listed.aviso
  };
}

async function setProjectFlag(userId, projectRaw, key, enabled, note) {
  const projectId = resolveProjectId(projectRaw);
  if (!projectId) {
    return { ok: false, erro: 'project obrigatório' };
  }
  const k = String(key || '').trim();
  if (!k) return { ok: false, erro: 'key obrigatória' };

  const wantEnabled = enabled !== false && enabled !== 'false' && enabled !== 0;
  const noteStr = note != null ? String(note).slice(0, 500) : null;

  const adapter = getAdapter(adapterNameFor(projectId));
  let synced = false;
  let live = false;
  let remote = null;
  let syncErro = null;

  if (adapter) {
    const rem = await adapter.setRemote(k, wantEnabled, noteStr);
    if (rem.ok) {
      synced = true;
      live = true;
      remote = rem.flag || { key: k, enabled: wantEnabled };
    } else {
      syncErro = rem.erro || 'sync remoto falhou';
      // Não grava como "pausado live" se o backend não aceitou
      const saved = await store.upsertFlag(userId, projectId, k, {
        enabled: wantEnabled,
        note: noteStr,
        synced: false,
        live: false,
        remote: { erro: syncErro }
      });
      return {
        ok: false,
        erro: syncErro,
        project_id: projectId,
        flag: saved,
        live: false,
        synced: false,
        aviso:
          'NÃO diga que pausou de verdade — o backend não aplicou. Flag local anotada; tente de novo ou cheque Redis/OPS_KEY.'
      };
    }
  }

  const saved = await store.upsertFlag(userId, projectId, k, {
    enabled: wantEnabled,
    note: noteStr,
    synced,
    live,
    remote
  });

  const meta = flagMeta(k);
  return {
    ok: true,
    project_id: projectId,
    flag: { ...saved, label: meta.label },
    live,
    synced,
    aviso: live
      ? `Flag **${k}** ${wantEnabled ? 'ligada' : 'pausada'} no backend live.`
      : `Flag **${k}** gravada só no Jarvis (projeto sem adapter live). NÃO diga que desligou o serviço real.`
  };
}

module.exports = {
  resolveProjectId,
  listProjectFlags,
  getProjectFlag,
  setProjectFlag
};
