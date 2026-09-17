/**
 * Ecossistema R:\Projetos — conhecimento gerado por scripts/ingest-projects.js
 */
const path = require('path');
const fs = require('fs');

const { getBrief, getBriefsPromptBlock, resolveBriefId, PROJECT_BRIEFS } = require('./briefs');

let cached = null;

function knowledgePath() {
  return path.join(__dirname, 'knowledge.json');
}

function loadKnowledge() {
  if (cached) return cached;
  const p = knowledgePath();
  if (!fs.existsSync(p)) {
    cached = { version: 0, projects: [], promptBlock: '', count: 0, wired: [] };
    return cached;
  }
  try {
    cached = JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    cached = { version: 0, projects: [], promptBlock: '', count: 0, wired: [] };
  }
  // Merge briefs curados em cima do ingest (briefs vencem no "o que é")
  cached.projects = (cached.projects || []).map((p) => {
    const b = getBrief(p.id);
    if (!b) return p;
    return {
      ...p,
      name: b.name || p.name,
      summary: b.brief || p.summary,
      aliases: [...new Set([...(b.aliases || []), ...(p.aliases || [])])],
      people: b.people || p.people || [],
      brief: b.brief,
      related: b.related || p.related || [],
      urls: b.urls || p.urls || [],
      stackHint: b.stackHint || null,
      wiredNote: b.wiredNote || p.note
    };
  });
  // Inclui briefs que ainda não estão no ingest (ex. evolution)
  const have = new Set(cached.projects.map((p) => p.id));
  for (const [id, b] of Object.entries(PROJECT_BRIEFS)) {
    if (have.has(id)) continue;
    cached.projects.push({
      id,
      folder: b.name,
      wired: false,
      name: b.name,
      summary: b.brief,
      brief: b.brief,
      aliases: b.aliases || [],
      people: b.people || [],
      related: b.related || [],
      urls: b.urls || [],
      stackHint: b.stackHint || null,
      stack: [],
      structure: [],
      note: b.wiredNote || null
    });
  }
  return cached;
}

function reloadKnowledge() {
  cached = null;
  return loadKnowledge();
}

function listEcosystem() {
  return loadKnowledge().projects || [];
}

function getProjectKnowledge(idOrFolder) {
  const briefId = resolveBriefId(idOrFolder);
  const q = String(idOrFolder || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
  if (!q && !briefId) return null;
  const list = listEcosystem();
  const byId = list.find((p) => p.id === (briefId || q));
  if (byId) return byId;
  const byFolder = list.find(
    (p) =>
      String(p.folder)
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '') === q
  );
  if (byFolder) return byFolder;
  return (
    list.find((p) => String(p.name || '').toLowerCase() === q) ||
    list.find((p) => {
      const folder = String(p.folder)
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '');
      return folder.length >= 4 && (folder.includes(q) || q.includes(folder));
    }) ||
    null
  );
}

/** Bloco compacto pro system prompt (todos os projetos). */
function getEcosystemPromptBlock() {
  // Prefer briefs curados (mais densos) + fallback ingest
  const curated = getBriefsPromptBlock();
  const k = loadKnowledge();
  const extra = (k.projects || [])
    .filter((p) => !PROJECT_BRIEFS[p.id] && p.summary)
    .map((p) => {
      const stack = (p.stack || []).slice(0, 5).join('+') || '?';
      return `- ${p.folder} [${p.id}] ${p.wired ? 'ON' : 'off'} stack:${stack} — ${String(p.summary).slice(0, 180)}`;
    })
    .join('\n');
  return extra ? `${curated}\n${extra}` : curated;
}

/** Fatia pro pack de contexto — briefs completos (ciência do ecossistema). */
function ecosystemLite(limit = 40) {
  return listEcosystem()
    .slice(0, limit)
    .map((p) => ({
      id: p.id,
      folder: p.folder,
      name: p.name || p.folder,
      wired: !!p.wired,
      stack: (p.stack || []).slice(0, 8),
      stackHint: p.stackHint || null,
      summary: p.brief || p.summary || null,
      people: p.people || [],
      related: (p.related || []).slice(0, 8),
      urls: (p.urls || []).slice(0, 3),
      aliases: (p.aliases || []).slice(0, 10),
      note: p.wiredNote || p.note || null
    }));
}

module.exports = {
  loadKnowledge,
  reloadKnowledge,
  listEcosystem,
  getProjectKnowledge,
  getEcosystemPromptBlock,
  ecosystemLite,
  getBrief,
  getBriefsPromptBlock,
  resolveBriefId
};
