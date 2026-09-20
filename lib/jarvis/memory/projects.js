/**
 * Project memory — durable facts per project_id (stack, objetivo, status, decisions…).
 * Complements episodic notas in jarvis_prefs.
 */
const { get, run, all } = require('../host').requireLib('db');
const { resolveProject, resolveProjectsFromMessage, listProjects } =
  require('../projects/registry');

const MAX_DECISOES = 15;
const MAX_NOTAS = 20;
const MAX_LINKS = 12;

async function ensureTable() {
  await run(`
    CREATE TABLE IF NOT EXISTS jarvis_project_memory (
      user_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      stack TEXT,
      objetivo TEXT,
      status TEXT,
      links JSONB NOT NULL DEFAULT '[]'::jsonb,
      decisoes JSONB NOT NULL DEFAULT '[]'::jsonb,
      ultima_falha JSONB,
      notas JSONB NOT NULL DEFAULT '[]'::jsonb,
      extras JSONB NOT NULL DEFAULT '{}'::jsonb,
      atualizado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (user_id, project_id)
    )
  `);
  await run(
    `CREATE INDEX IF NOT EXISTS idx_jarvis_pm_user ON jarvis_project_memory (user_id, atualizado_em DESC)`
  ).catch(() => {});
}

function emptyMemory(projectId) {
  return {
    project_id: projectId,
    stack: null,
    objetivo: null,
    status: null,
    links: [],
    decisoes: [],
    ultima_falha: null,
    notas: [],
    extras: {}
  };
}

function hydrate(row) {
  if (!row) return null;
  const links = Array.isArray(row.links) ? row.links : JSON.parse(row.links || '[]');
  const decisoes = Array.isArray(row.decisoes)
    ? row.decisoes
    : JSON.parse(row.decisoes || '[]');
  let notas = Array.isArray(row.notas) ? row.notas : JSON.parse(row.notas || '[]');
  // Legacy: string → { t: null, text }
  notas = (notas || []).map((n) =>
    typeof n === 'string' ? { t: null, text: n } : n && n.text != null ? n : { t: null, text: String(n || '') }
  );
  let ultima = row.ultima_falha;
  if (typeof ultima === 'string') {
    try {
      ultima = JSON.parse(ultima);
    } catch {
      ultima = null;
    }
  }
  let extras = row.extras;
  if (typeof extras === 'string') {
    try {
      extras = JSON.parse(extras);
    } catch {
      extras = {};
    }
  }
  return {
    project_id: row.project_id,
    stack: row.stack || null,
    objetivo: row.objetivo || null,
    status: row.status || null,
    links,
    decisoes,
    ultima_falha: ultima || null,
    notas,
    extras: extras || {},
    atualizado_em: row.atualizado_em
  };
}

/** Resolve catalog id or freeform slug (cutflix, framerush…). */
function resolveMemoryProjectId(query) {
  const q = String(query || '').trim();
  if (!q) return null;
  const known = resolveProject(q);
  if (known) return known.id;
  const slug = q
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 48);
  return slug.length >= 2 ? slug : null;
}

function projectDisplayName(projectId) {
  const p = listProjects().find((x) => x.id === projectId);
  return p ? p.name : projectId;
}

async function getProjectMemory(userId, projectId) {
  await ensureTable();
  const row = await get(
    `SELECT * FROM jarvis_project_memory WHERE user_id = $1 AND project_id = $2`,
    [userId, projectId]
  );
  return hydrate(row) || emptyMemory(projectId);
}

async function listProjectMemories(userId, limit = 20) {
  await ensureTable();
  const rows = await all(
    `SELECT * FROM jarvis_project_memory
     WHERE user_id = $1
     ORDER BY atualizado_em DESC
     LIMIT $2`,
    [userId, limit]
  );
  return (rows || []).map(hydrate).filter(Boolean);
}

/**
 * Patch fields. Arrays append (decisao, nota, link); ultima_falha replaces.
 */
async function upsertProjectMemory(userId, patch = {}) {
  await ensureTable();
  const projectId = resolveMemoryProjectId(patch.project_id || patch.project || patch.id);
  if (!projectId) throw new Error('project_id obrigatório');

  const cur = await getProjectMemory(userId, projectId);
  const now = new Date().toISOString();

  let stack = cur.stack;
  let objetivo = cur.objetivo;
  let status = cur.status;
  let links = [...(cur.links || [])];
  let decisoes = [...(cur.decisoes || [])];
  let notas = [...(cur.notas || [])];
  let ultima_falha = cur.ultima_falha;
  const extras = { ...(cur.extras || {}) };

  if (patch.stack != null) stack = String(patch.stack).slice(0, 200);
  if (patch.objetivo != null) objetivo = String(patch.objetivo).slice(0, 400);
  if (patch.status != null) status = String(patch.status).slice(0, 120);

  if (patch.link) {
    const url = String(patch.link).trim().slice(0, 300);
    if (url && !links.includes(url)) {
      links.unshift(url);
      links = links.slice(0, MAX_LINKS);
    }
  }
  if (Array.isArray(patch.links)) {
    for (const u of patch.links) {
      const url = String(u || '').trim().slice(0, 300);
      if (url && !links.includes(url)) links.unshift(url);
    }
    links = links.slice(0, MAX_LINKS);
  }

  if (patch.decisao) {
    const text = String(patch.decisao).replace(/\s+/g, ' ').trim().slice(0, 300);
    if (text) {
      decisoes = decisoes.filter((d) => String(d.text).toLowerCase() !== text.toLowerCase());
      decisoes.unshift({ t: now, text });
      decisoes = decisoes.slice(0, MAX_DECISOES);
    }
  }

  if (patch.nota) {
    const text = String(patch.nota).replace(/\s+/g, ' ').trim().slice(0, 300);
    if (text) {
      const norm = (n) =>
        String(typeof n === 'string' ? n : (n && n.text) || '')
          .toLowerCase()
          .trim();
      notas = notas.filter((n) => norm(n) !== text.toLowerCase());
      notas.unshift({ t: now, text });
      notas = notas.slice(0, MAX_NOTAS);
    }
  }

  if (patch.ultima_falha != null) {
    const text = String(patch.ultima_falha).replace(/\s+/g, ' ').trim().slice(0, 400);
    ultima_falha = text ? { t: now, text } : null;
  }

  if (patch.limpar_falha) ultima_falha = null;

  await run(
    `INSERT INTO jarvis_project_memory
       (user_id, project_id, stack, objetivo, status, links, decisoes, ultima_falha, notas, extras, atualizado_em)
     VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8::jsonb,$9::jsonb,$10::jsonb,CURRENT_TIMESTAMP)
     ON CONFLICT (user_id, project_id) DO UPDATE SET
       stack = EXCLUDED.stack,
       objetivo = EXCLUDED.objetivo,
       status = EXCLUDED.status,
       links = EXCLUDED.links,
       decisoes = EXCLUDED.decisoes,
       ultima_falha = EXCLUDED.ultima_falha,
       notas = EXCLUDED.notas,
       extras = EXCLUDED.extras,
       atualizado_em = CURRENT_TIMESTAMP`,
    [
      userId,
      projectId,
      stack,
      objetivo,
      status,
      JSON.stringify(links),
      JSON.stringify(decisoes),
      ultima_falha ? JSON.stringify(ultima_falha) : null,
      JSON.stringify(notas),
      JSON.stringify(extras)
    ]
  );

  console.log(
    JSON.stringify({
      tag: 'jarvis.memory',
      event: 'project_upsert',
      userId,
      projectId,
      fields: Object.keys(patch).filter((k) => !['project', 'project_id', 'id'].includes(k))
    })
  );

  return getProjectMemory(userId, projectId);
}

/** Compact for LLM pack */
function slimMemory(mem, { keepTimestamps = false } = {}) {
  if (!mem) return null;
  const out = {
    id: mem.project_id,
    name: projectDisplayName(mem.project_id)
  };
  if (mem.stack) out.stack = mem.stack;
  if (mem.objetivo) out.objetivo = mem.objetivo;
  if (mem.status) out.status = mem.status;
  if (mem.links?.length) out.links = mem.links.slice(0, 5);
  if (mem.decisoes?.length) {
    out.decisoes = mem.decisoes.slice(0, 5).map((d) =>
      keepTimestamps && d && d.t
        ? { t: d.t, text: d.text || d }
        : d.text || d
    );
  }
  if (mem.ultima_falha?.text) {
    out.ultima_falha =
      keepTimestamps && mem.ultima_falha.t
        ? { t: mem.ultima_falha.t, text: mem.ultima_falha.text }
        : mem.ultima_falha.text;
  }
  if (mem.notas?.length) {
    out.notas = mem.notas.slice(0, 8).map((n) => {
      const text = typeof n === 'string' ? n : n && n.text;
      if (keepTimestamps && n && n.t) return { t: n.t, text };
      return text;
    });
  }
  return out;
}

/** Janela temporal a partir da mensagem (America/Sao_Paulo ≈ UTC-3). */
function parseTemporalWindow(mensagem, now = new Date()) {
  const msg = String(mensagem || '').toLowerCase();
  const end = new Date(now);
  const start = new Date(now);

  if (/\bsemana\s+passad[ao]\b|\blast\s+week\b/.test(msg)) {
    // semana civil anterior (seg–dom), aproximando: últimos 7–14 dias
    end.setDate(end.getDate() - ((end.getDay() + 6) % 7)); // última segunda 00h ≈ início desta semana
    end.setHours(0, 0, 0, 0);
    start.setTime(end.getTime());
    start.setDate(start.getDate() - 7);
    return {
      label: 'semana passada',
      since: start.toISOString(),
      until: end.toISOString()
    };
  }
  if (/\b(essa|esta)\s+semana\b|\bthis\s+week\b/.test(msg)) {
    start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
    start.setHours(0, 0, 0, 0);
    return { label: 'essa semana', since: start.toISOString(), until: end.toISOString() };
  }
  if (/\bontem\b|\byesterday\b/.test(msg)) {
    start.setDate(start.getDate() - 1);
    start.setHours(0, 0, 0, 0);
    end.setDate(end.getDate() - 1);
    end.setHours(23, 59, 59, 999);
    return { label: 'ontem', since: start.toISOString(), until: end.toISOString() };
  }
  const mDays = msg.match(/\b[uú]ltimos?\s+(\d{1,2})\s+dias?\b/);
  if (mDays) {
    const n = Math.min(30, Math.max(1, Number(mDays[1]) || 7));
    start.setDate(start.getDate() - n);
    start.setHours(0, 0, 0, 0);
    return { label: `últimos ${n} dias`, since: start.toISOString(), until: end.toISOString() };
  }
  if (
    /\b(o\s+que\s+(a\s+gente\s+|nós\s+|eu\s+)?(fiz|fizemos|aconteceu|rolou)|hist[oó]rico|linha\s+do\s+tempo)\b/i.test(
      msg
    ) &&
    /\b(cutflix|milh|cinerush|attracione|jarvis|projeto|semana|ontem|dias)\b/i.test(msg)
  ) {
    start.setDate(start.getDate() - 7);
    start.setHours(0, 0, 0, 0);
    return { label: 'últimos 7 dias', since: start.toISOString(), until: end.toISOString() };
  }
  return null;
}

function looksLikeTemporalRecall(mensagem) {
  return !!parseTemporalWindow(mensagem);
}

const SEMANTIC_STOP = new Set([
  'que',
  'de',
  'da',
  'do',
  'dos',
  'das',
  'um',
  'uma',
  'uns',
  'os',
  'as',
  'no',
  'na',
  'nos',
  'nas',
  'em',
  'pra',
  'para',
  'com',
  'por',
  'foi',
  'ser',
  'esta',
  'esse',
  'essa',
  'isso',
  'como',
  'qual',
  'quais',
  'sobre',
  'lembra',
  'lembrar',
  'anota',
  'jarvis',
  'voce',
  'você',
  'vc',
  'meu',
  'minha',
  'meus',
  'suas',
  'seu',
  'the',
  'and',
  'for',
  'with',
  'what',
  'about',
  'projeto',
  'projetos'
]);

function tokenizeSemantic(text) {
  return String(text || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length >= 3 && !SEMANTIC_STOP.has(t));
}

function scoreSemanticOverlap(queryTokens, docTokens) {
  if (!queryTokens.length || !docTokens.length) return 0;
  const set = new Set(docTokens);
  let hit = 0;
  for (const t of queryTokens) {
    if (set.has(t)) hit += 1;
  }
  return hit / queryTokens.length;
}

/**
 * Pedido de recall por significado (não temporal).
 * Ex.: "o que você lembra sobre redis no cutflix", "qual a stack do milhão"
 */
function looksLikeSemanticRecall(mensagem) {
  if (looksLikeTemporalRecall(mensagem)) return false;
  const msg = String(mensagem || '');
  if (/^(oi+|ola|e ai|eai|fala|bom dia|boa tarde|boa noite)\b/i.test(msg.trim()) && msg.length < 80) {
    return false;
  }
  if (
    /\b(o\s+que\s+(você|voce|vc|tu)\s+(lembra|sabe|tem)\b|lembra\s+(do|da|sobre|quando)|qual\s+(foi|é|e)\s+(a\s+|o\s+)?(decis[aã]o|stack|status|objetivo|falha)|mem[oó]ria\s+(do|da|sobre)|sobre\s+(o\s+|a\s+)?\w+)/i.test(
      msg
    )
  ) {
    return true;
  }
  // projeto citado + pergunta de fato
  const ids = resolveProjectsFromMessage(msg);
  if (
    ids.length &&
    /\b(stack|status|objetivo|decid|falhou|erro|nota|lembra|sabe)\b/i.test(msg)
  ) {
    return true;
  }
  return false;
}

function corpusFromMemory(mem) {
  if (!mem) return [];
  const pid = mem.project_id;
  const out = [];
  if (mem.stack) out.push({ project_id: pid, kind: 'stack', text: String(mem.stack), t: null });
  if (mem.objetivo)
    out.push({ project_id: pid, kind: 'objetivo', text: String(mem.objetivo), t: null });
  if (mem.status)
    out.push({ project_id: pid, kind: 'status', text: String(mem.status), t: null });
  for (const d of mem.decisoes || []) {
    const text = typeof d === 'string' ? d : d && d.text;
    if (text)
      out.push({
        project_id: pid,
        kind: 'decisao',
        text: String(text),
        t: (d && d.t) || null
      });
  }
  for (const n of mem.notas || []) {
    const text = typeof n === 'string' ? n : n && n.text;
    if (text)
      out.push({
        project_id: pid,
        kind: 'nota',
        text: String(text),
        t: (n && n.t) || null
      });
  }
  if (mem.ultima_falha && mem.ultima_falha.text) {
    out.push({
      project_id: pid,
      kind: 'falha',
      text: String(mem.ultima_falha.text),
      t: mem.ultima_falha.t || null
    });
  }
  return out;
}

/**
 * Recall lexical (Jaccard-lite) sobre notas/decisões/stack — sem embeddings.
 */
async function recallSemanticForMessage(
  userId,
  mensagem,
  { prefsNotas = [], limit = 6, minScore = 0.22 } = {}
) {
  const queryTokens = tokenizeSemantic(mensagem);
  if (queryTokens.length < 1) return null;

  const memories = await loadMemoriesForMessage(userId, mensagem, { limit: 8 });
  const corpus = [];

  for (const slim of memories) {
    const pid = slim.id || slim.project_id;
    if (!pid) continue;
    const raw = await getProjectMemory(userId, pid);
    corpus.push(...corpusFromMemory(raw));
  }

  for (const n of prefsNotas || []) {
    const text = typeof n === 'string' ? n : n && n.text;
    if (text) {
      corpus.push({
        project_id: null,
        kind: 'prefs',
        text: String(text),
        t: (n && n.t) || null
      });
    }
  }

  const scored = [];
  for (const item of corpus) {
    const docTokens = tokenizeSemantic(item.text);
    const score = scoreSemanticOverlap(queryTokens, docTokens);
    // boost se project_id aparece na query
    let boost = 0;
    if (item.project_id && queryTokens.includes(String(item.project_id).toLowerCase())) {
      boost = 0.15;
    }
    const final = Math.min(1, score + boost);
    if (final >= minScore) {
      scored.push({ ...item, score: Math.round(final * 100) / 100 });
    }
  }

  scored.sort((a, b) => b.score - a.score || String(b.t || '').localeCompare(String(a.t || '')));
  const hits = scored.slice(0, limit);

  return {
    mode: 'lexical',
    query_tokens: queryTokens.slice(0, 12),
    hits,
    empty: hits.length === 0
  };
}

function itemTime(item) {
  if (!item) return null;
  if (typeof item === 'string') return null;
  const t = item.t || item.at || item.criado_em;
  if (!t) return null;
  const ms = new Date(t).getTime();
  return Number.isFinite(ms) ? ms : null;
}

function filterDatedItems(items, window) {
  if (!window || !Array.isArray(items)) return [];
  const since = new Date(window.since).getTime();
  const until = new Date(window.until).getTime();
  return items.filter((it) => {
    const ms = itemTime(it);
    if (ms == null) return false;
    return ms >= since && ms <= until;
  });
}

/**
 * Recall temporal por projeto — decisões/notas/falhas com timestamp na janela.
 */
async function recallForMessage(userId, mensagem, { prefsNotas = [], limit = 20 } = {}) {
  const window = parseTemporalWindow(mensagem);
  if (!window) return null;

  const memories = await loadMemoriesForMessage(userId, mensagem, { limit: 6 });
  const itens = [];

  for (const slim of memories) {
    const pid = slim.id || slim.project_id;
    if (!pid) continue;
    const raw = await getProjectMemory(userId, pid);
    for (const d of filterDatedItems(raw.decisoes, window)) {
      itens.push({ project_id: pid, kind: 'decisao', t: d.t, text: d.text });
    }
    for (const n of filterDatedItems(raw.notas, window)) {
      itens.push({
        project_id: pid,
        kind: 'nota',
        t: n.t,
        text: typeof n === 'string' ? n : n.text
      });
    }
    if (raw.ultima_falha && filterDatedItems([raw.ultima_falha], window).length) {
      itens.push({
        project_id: pid,
        kind: 'falha',
        t: raw.ultima_falha.t,
        text: raw.ultima_falha.text
      });
    }
  }

  for (const n of filterDatedItems(prefsNotas, window)) {
    const text = typeof n === 'string' ? n : n.text;
    itens.push({ project_id: null, kind: 'prefs', t: n.t || null, text });
  }

  itens.sort((a, b) => String(b.t || '').localeCompare(String(a.t || '')));

  return {
    window: { label: window.label, since: window.since, until: window.until },
    projects: memories.map((m) => m.id || m.project_id).filter(Boolean),
    itens: itens.slice(0, limit),
    empty: itens.length === 0
  };
}

/**
 * Load memories relevant to the message (mentioned projects), else recent ones.
 */
async function loadMemoriesForMessage(userId, mensagem, { limit = 8 } = {}) {
  const ids = resolveProjectsFromMessage(mensagem);
  // Also try freeform "cutflix" etc. via resolveMemoryProjectId on tokens
  const msg = String(mensagem || '');
  const extra = [];
  const mProj = msg.match(
    /\b(?:projeto|no|na|do|da)\s+([a-zA-Z0-9][\w\s-]{1,30})/gi
  );
  if (mProj) {
    for (const raw of mProj) {
      const name = raw.replace(/^(?:projeto|no|na|do|da)\s+/i, '').trim();
      const id = resolveMemoryProjectId(name);
      if (id) extra.push(id);
    }
  }

  const want = [...new Set([...ids, ...extra])];
  if (want.length) {
    const out = [];
    for (const id of want.slice(0, limit)) {
      const mem = await getProjectMemory(userId, id);
      const has =
        mem.stack ||
        mem.objetivo ||
        mem.status ||
        (mem.notas && mem.notas.length) ||
        (mem.decisoes && mem.decisoes.length) ||
        mem.ultima_falha;
      if (has) out.push(slimMemory(mem));
      else out.push({ id, name: projectDisplayName(id), _empty: true });
    }
    return out;
  }

  const recent = await listProjectMemories(userId, limit);
  return recent.map(slimMemory).filter((m) => m && !m._empty);
}

/**
 * NL → memory write.
 * "lembra que no cutflix a stack é next"
 * "anota no cinerush: deploy falhou por redis"
 * "no projeto attracione, status é pausado"
 */
function inferProjectMemoryFromMessage(mensagem) {
  const msg = String(mensagem || '').trim();
  if (!msg) return null;
  if (!/\b(lembra|anota|guarda|registra)\b/i.test(msg)) return null;

  // Nome do projeto = token único (sem espaços) — evita engolir "a stack é…"
  // Preferir ids conhecidos do registry quando o texto os cita.
  const known = resolveProjectsFromMessage(msg);
  let projectRaw = null;
  let fact = null;

  let m = msg.match(
    /(?:lembra(?:\s+que)?|anota(?:\s+que)?|guarda(?:\s+que)?|registra(?:\s+que)?)\s+(?:no|na|do|da|sobre|pro|para\s+o)?\s*(?:projeto\s+)?([a-zA-Z0-9][\w-]{1,40})\s*[:\-–]\s*(.+)$/i
  );
  if (!m) {
    m = msg.match(
      /(?:lembra(?:\s+que)?|anota(?:\s+que)?)\s+(?:no|na|do|da)\s+(?:projeto\s+)?([a-zA-Z0-9][\w-]{1,40})\s+(?:que\s+)?(.+)$/i
    );
  }
  if (!m) {
    m = msg.match(
      /(?:no|na)\s+(?:projeto\s+)?([a-zA-Z0-9][\w-]{1,40})\s*[,:]?\s*(?:lembra|anota|guarda)\s+(?:que\s+)?(.+)$/i
    );
  }
  if (m) {
    projectRaw = m[1];
    fact = m[2];
  } else if (known.length === 1) {
    // "lembra que no Cutflix a stack é next" via alias do registry
    const id = known[0];
    const aliases = listProjects()
      .filter((p) => p.id === id)
      .flatMap((p) => [p.id, p.name, ...(p.aliases || [])].filter(Boolean));
    const re = new RegExp(
      `(?:lembra(?:\\s+que)?|anota(?:\\s+que)?)\\s+(?:no|na|do|da)?\\s*(?:projeto\\s+)?(?:${aliases
        .map((a) => a.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
        .join('|')})\\s+(?:que\\s+)?(.+)$`,
      'i'
    );
    const m2 = msg.match(re);
    if (m2) {
      projectRaw = id;
      fact = m2[1];
    }
  }
  if (!projectRaw || !fact) return null;

  const projectId =
    resolveMemoryProjectId(projectRaw) || (known.length === 1 ? known[0] : null);
  fact = String(fact || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 400);
  if (!projectId || fact.length < 3) return null;

  const patch = { project_id: projectId };

  if (/\bstack\b/i.test(fact) || /\b(next\.?js|react|node|rails|python|django|fastapi)\b/i.test(fact)) {
    const sm = fact.match(/\bstack\s*(?:é|=|:|e)\s+(.+)$/i);
    if (sm) {
      patch.stack = sm[1].trim();
    } else {
      const tech = fact.match(/\b(next\.?js|react(?:\s*native)?|node(?:\.?js)?|rails|python|django|fastapi|go|rust)\b/i);
      patch.stack = tech ? tech[1].trim() : fact.replace(/^.*?\bstack\b\s*/i, '').trim() || fact;
    }
  } else if (/\bstatus\b/i.test(fact) || /\b(pausado|ativo|parado|wip|produção|prod)\b/i.test(fact)) {
    const sm = fact.match(/\bstatus\s*(?:é|=|:|e)\s+(.+)$/i);
    patch.status = sm ? sm[1].trim() : fact.replace(/^.*?\bstatus\b\s*(?:é|=|:|e)?\s*/i, '').trim() || fact;
  } else if (/\bobjetivo\b/i.test(fact) || /\bmeta\s+(do|da)\s+projeto\b/i.test(fact)) {
    const sm = fact.match(/\bobjetivo\s*(?:é|=|:|e)\s+(.+)$/i);
    patch.objetivo = sm ? sm[1].trim() : fact;
  } else if (/\bfalhou|erro|bug|quebr/i.test(fact)) {
    patch.ultima_falha = fact;
  } else if (/\bdecid|vamos\s+usar|optamos\b/i.test(fact)) {
    patch.decisao = fact;
  } else if (/^https?:\/\//i.test(fact) || /\blink\b/i.test(fact)) {
    const url = fact.match(/https?:\/\/\S+/i);
    if (url) patch.link = url[0];
    else patch.nota = fact;
  } else {
    patch.nota = fact;
  }

  return patch;
}

module.exports = {
  ensureTable,
  getProjectMemory,
  listProjectMemories,
  upsertProjectMemory,
  loadMemoriesForMessage,
  inferProjectMemoryFromMessage,
  resolveMemoryProjectId,
  slimMemory,
  projectDisplayName,
  emptyMemory,
  parseTemporalWindow,
  looksLikeTemporalRecall,
  filterDatedItems,
  recallForMessage,
  tokenizeSemantic,
  scoreSemanticOverlap,
  looksLikeSemanticRecall,
  recallSemanticForMessage,
  corpusFromMemory
};
