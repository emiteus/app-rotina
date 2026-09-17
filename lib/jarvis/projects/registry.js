/**
 * Project Registry API (Phase 6).
 */
const { PROJECT_CATALOG } = require('./catalog');

function norm(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function listProjects() {
  return PROJECT_CATALOG.map((p) => ({ ...p }));
}

function getProject(id) {
  return PROJECT_CATALOG.find((p) => p.id === id) || null;
}

function getBySnapshotKey(key) {
  return PROJECT_CATALOG.find((p) => p.snapshotKey === key) || null;
}

/** Resolve project id from alias / name / id */
function resolveProject(query) {
  const q = norm(query);
  if (!q) return null;
  for (const p of PROJECT_CATALOG) {
    if (norm(p.id) === q || norm(p.name) === q) return p;
    for (const a of p.aliases) {
      if (norm(a) === q) return p;
    }
  }
  // partial: alias contained in query or query contained in alias (min 3 chars)
  if (q.length >= 3) {
    for (const p of PROJECT_CATALOG) {
      const hay = [p.id, p.name, ...p.aliases].map(norm);
      if (hay.some((h) => h === q || (h.length >= 3 && (q.includes(h) || h.includes(q))))) {
        return p;
      }
    }
  }
  return null;
}

/**
 * Which projects are mentioned in a free-text message.
 * @returns {string[]} project ids (unique)
 */
function resolveProjectsFromMessage(mensagem) {
  const msg = norm(mensagem);
  if (!msg) return [];
  const hits = [];
  const padded = ` ${msg} `;

  for (const p of PROJECT_CATALOG) {
    if (p.id === 'approtina' || p.id === 'evolution') continue;
    // Skip ultra-generic aliases that pollute NL (still usable via resolveProject exact)
    const skipExact = new Set([
      'tv',
      'posts',
      'clip',
      'clips',
      'comp',
      'ranking',
      'coleta',
      'streaming',
      'instagram',
      'assinante',
      'assinantes'
    ]);
    const terms = [p.id, p.name, ...p.aliases]
      .map(norm)
      .filter((t) => t.length >= 3 && !skipExact.has(t));
    terms.sort((a, b) => b.length - a.length);
    for (const t of terms) {
      const re = new RegExp(`(?:^|\\s)${t.replace(/\s+/g, '\\s+')}(?:\\s|$)`);
      if (re.test(padded)) {
        hits.push(p.id);
        break;
      }
    }
  }

  // Intentional ops keywords → project (word boundary)
  if (/\b(provision|chatwoot|havok|kirvano|cinerush|cine\s*rush)\b/.test(mensagem)) {
    hits.push('cinerush');
  }
  if (/\b(attracione|attra)\b/.test(mensagem) || /\bcomp\s*\d+\b/i.test(mensagem)) {
    hits.push('attracione');
  }
  if (/\b(socialhub|social\s*hub|teushub)\b/i.test(mensagem)) {
    hits.push('socialhub');
  }
  if (/\b(clipper|vortex)\b/i.test(mensagem)) {
    hits.push('clipper');
  }
  if (/\b(editor\s*(em\s*)?massa|editor\s*video|cinerush\s*editor|corte\s*em\s*massa)\b/i.test(mensagem)) {
    hits.push('cinerush_editor');
  }

  return [...new Set(hits)];
}

function isConnectorReady(project) {
  if (!project) return false;
  if (!project.connector || !project.readyExport) {
    if (project.id === 'approtina') return true;
    if (project.id === 'evolution') {
      return !!(
        process.env.EVOLUTION_URL &&
        process.env.EVOLUTION_API_KEY &&
        process.env.EVOLUTION_INSTANCE
      );
    }
    return false;
  }
  try {
    const mod = require(project.connector);
    const fn = mod[project.readyExport];
    return typeof fn === 'function' ? !!fn() : false;
  } catch {
    return false;
  }
}

async function loadSnapshot(project) {
  if (!project || !project.connector || !project.snapshotExport) {
    return null;
  }
  if (!isConnectorReady(project)) {
    return {
      conectado: false,
      motivo: `${project.env.join('/')} ausentes`
    };
  }
  const mod = require(project.connector);
  const fn = mod[project.snapshotExport];
  return fn();
}

/** Build projetos.* object for owner snapshot via registry */
async function loadAllProjectSnapshots() {
  const withSnap = PROJECT_CATALOG.filter((p) => p.snapshotKey);
  const entries = await Promise.all(
    withSnap.map(async (p) => {
      try {
        return [p.snapshotKey, await loadSnapshot(p)];
      } catch (e) {
        return [
          p.snapshotKey,
          { conectado: false, motivo: e.message || 'erro ao carregar' }
        ];
      }
    })
  );
  return Object.fromEntries(entries);
}

/** Safe public status (no secrets) */
function getRegistryStatus() {
  return PROJECT_CATALOG.map((p) => ({
    id: p.id,
    name: p.name,
    aliases: p.aliases.slice(0, 8),
    description: p.description,
    snapshotKey: p.snapshotKey,
    toolPrefixes: p.toolPrefixes,
    docsUrl: p.docsUrl,
    ownerOnly: p.ownerOnly,
    wired: p.wired !== false,
    conectado: p.wired === false ? false : isConnectorReady(p),
    envConfigured: p.env.filter((k) => !!(process.env[k] && String(process.env[k]).trim())).length,
    envRequired: p.env.length
  }));
}

/** Compact block for LLM prompt */
function getRegistryPromptBlock() {
  return getRegistryStatus()
    .map((p) => {
      const al = p.aliases.slice(0, 5).join(', ');
      const st = p.conectado ? 'ON' : 'off';
      return `- ${p.name} [\`${p.id}\`] ${st} — aliases: ${al}`;
    })
    .join('\n');
}

function toolsForProject(projectId) {
  const p = getProject(projectId);
  if (!p || !p.toolPrefixes.length) return [];
  const { listToolNames } = require('../tools/registry');
  return listToolNames().filter((name) =>
    p.toolPrefixes.some((pref) => name.startsWith(pref))
  );
}

module.exports = {
  PROJECT_CATALOG,
  listProjects,
  getProject,
  getBySnapshotKey,
  resolveProject,
  resolveProjectsFromMessage,
  isConnectorReady,
  loadSnapshot,
  loadAllProjectSnapshots,
  getRegistryStatus,
  getRegistryPromptBlock,
  toolsForProject
};
