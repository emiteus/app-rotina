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
  if (/\b(provision|chatwoot|havok|kirvano|cinerush\s*tv|cine\s*rush\s*tv|cinehub|cine\s*hub)\b/.test(mensagem)) {
    hits.push('cinerush');
  }
  if (/\b(cinerush|cine\s*rush)\b/.test(mensagem) && !/\beditor\b|\bcortes?\s+em\s+massa\b|\bprocessar\b/i.test(mensagem)) {
    // "CineRush" / "CineRush tv" / vendas → TV; editor só se falar editor/massa
    if (/\btv\b|\biptv\b|\bassinate|\bvenda|\bhavok\b|\bkirvano\b/i.test(mensagem) || !/\beditor\b/i.test(mensagem)) {
      hits.push('cinerush');
    }
  }
  if (/\b(attracione|attra)\b/.test(mensagem) || /\bcomp\s*\d+\b/i.test(mensagem)) {
    hits.push('attracione');
  }
  // NL: reels/vídeos + Erik/Mateus/filmes/comp → Attracione (NÃO SocialHub)
  if (
    /\b(erik)\b/i.test(mensagem) ||
    (/\b(reels?|shorts?)\b/i.test(mensagem) &&
      /\b(erik|eu\s+e|postamos|postei|poste|filme|corte|competi)/i.test(mensagem)) ||
    (/\b(views?|visualiz)\b/i.test(mensagem) &&
      /\b(video|vídeo|corte|filme|tiktok|kwai|competi|reel)/i.test(mensagem)) ||
    (/\bpuxar\b/i.test(mensagem) && /\b(views?|video|vídeo)/i.test(mensagem)) ||
    (/\b(quantos?|qtd|quantidade)\b/i.test(mensagem) &&
      /\b(video|vídeo|reel|corte)/i.test(mensagem) &&
      /\b(erik|postamos|hoje|hj|competi|filme)/i.test(mensagem))
  ) {
    hits.push('attracione');
  }
  if (
    /\b(socialhub|social\s*hub|teushub)\b/i.test(mensagem) ||
    (/\b(agendar\s+post|publicar\s+agendad)/i.test(mensagem) && !/\berik\b|\battracione\b|\bcompeti/i.test(mensagem))
  ) {
    hits.push('socialhub');
  }
  if (/\b(clipper|vortex)\b/i.test(mensagem)) {
    hits.push('clipper');
  }
  if (/\b(editor\s*(em\s*)?massa|editor\s*video|cinerush\s*editor|corte\s*em\s*massa|cinerush\.app)\b/i.test(mensagem)) {
    hits.push('cinerush_editor');
  }
  if (/\bcutflix\b/i.test(mensagem)) {
    hits.push('cutflix');
  }
  if (
    /\b(projeto\s*milh[aã]o|milh[aã]o)\b/i.test(mensagem) ||
    (/\bfechamento\b/i.test(mensagem) &&
      /\b(milh[aã]o|meta\s*30|projeto)\b/i.test(mensagem))
  ) {
    hits.push('projeto_milhao');
  }

  // Pastas do ecossistema (knowledge ingest) — mesmo sem connector
  try {
    const { listEcosystem } = require('./knowledge');
    const msg = norm(mensagem);
    for (const p of listEcosystem()) {
      if (p.id === 'approtina' || p.id === 'jarvis') continue;
      // Evita Cinerush (editor) roubar "CineRush tv"
      if (
        p.id === 'cinerush_editor' &&
        /\btv\b|\biptv\b|\bassinate|\bvenda|\bhavok\b|\bkirvano\b/i.test(mensagem)
      ) {
        continue;
      }
      const terms = [p.id, p.folder, p.name]
        .filter(Boolean)
        .map((t) =>
          String(t)
            .toLowerCase()
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/[^a-z0-9]+/g, ' ')
            .trim()
        )
        .filter((t) => t.length >= 3);
      for (const t of terms) {
        const re = new RegExp(`(?:^|\\s)${t.replace(/\s+/g, '\\s+')}(?:\\s|$)`);
        if (re.test(` ${msg} `)) {
          hits.push(p.id);
          break;
        }
      }
    }
  } catch {
    /* knowledge ausente */
  }

  // Dedup + preferências: TV vs Editor, Attracione vs SocialHub
  let out = [...new Set(hits)];
  if (out.includes('cinerush') && out.includes('cinerush_editor')) {
    if (/\btv\b|\biptv\b|\bassinate|\bvenda|\bhavok\b|\bkirvano\b/i.test(mensagem)) {
      out = out.filter((id) => id !== 'cinerush_editor');
    } else if (/\beditor\b|\bmassa\b|\bcinerush\.app\b/i.test(mensagem)) {
      out = out.filter((id) => id !== 'cinerush');
    } else {
      // Ambíguo "cinerush" solo → preferir TV (produto comercial)
      out = out.filter((id) => id !== 'cinerush_editor');
    }
  }
  if (out.includes('attracione') && out.includes('socialhub')) {
    if (!/\b(socialhub|teushub|agendar)\b/i.test(mensagem)) {
      out = out.filter((id) => id !== 'socialhub');
    }
  }
  return out;
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
    const { requireConnector } = require('../host');
    const mod = requireConnector(project.connector);
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
  const { requireConnector } = require('../host');
  const mod = requireConnector(project.connector);
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
    opsBrief: p.opsBrief || null,
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
      let st = 'off';
      if (p.conectado) st = 'ON';
      else if (p.wired === false) st = 'stub';
      else if (p.envRequired && p.envConfigured < p.envRequired) st = 'off (env)';
      const brief = p.opsBrief ? ` | ops: ${p.opsBrief}` : '';
      return `- ${p.name} [${p.id}] ${st} — aliases: ${al}${brief}`;
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
