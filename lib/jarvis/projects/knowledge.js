/**
 * Ecossistema R:\Projetos — conhecimento gerado por scripts/ingest-projects.js
 */
const path = require('path');
const fs = require('fs');

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
  const q = String(idOrFolder || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
  if (!q) return null;
  const list = listEcosystem();
  return (
    list.find((p) => p.id === q || String(p.folder).toLowerCase() === q) ||
    list.find(
      (p) =>
        String(p.name || '').toLowerCase() === q ||
        String(p.folder)
          .toLowerCase()
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '')
          .includes(q)
    ) ||
    null
  );
}

/** Bloco compacto pro system prompt (todos os projetos). */
function getEcosystemPromptBlock() {
  const k = loadKnowledge();
  if (k.promptBlock) return k.promptBlock;
  return (k.projects || [])
    .map((p) => {
      const stack = (p.stack || []).slice(0, 5).join('+') || '?';
      const one = (p.summary || p.note || '').replace(/\s+/g, ' ').slice(0, 120);
      return `- ${p.folder} [${p.id}] ${p.wired ? 'ON' : 'off'} stack:${stack}${one ? ` — ${one}` : ''}`;
    })
    .join('\n');
}

/** Fatia leve pro pack de contexto. */
function ecosystemLite(limit = 24) {
  return listEcosystem()
    .slice(0, limit)
    .map((p) => ({
      id: p.id,
      folder: p.folder,
      wired: !!p.wired,
      stack: (p.stack || []).slice(0, 6),
      summary: p.summary ? String(p.summary).slice(0, 160) : null,
      note: p.note || null
    }));
}

module.exports = {
  loadKnowledge,
  reloadKnowledge,
  listEcosystem,
  getProjectKnowledge,
  getEcosystemPromptBlock,
  ecosystemLite
};
