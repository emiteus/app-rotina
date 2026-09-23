/**
 * Lições (Fase 1 MCU) — erro de tool vira lição; a mesma tool passando depois resolve.
 * Termina o item #8 do plano 3.0: antes só existia ultima_falha (1 por projeto, sobrescrita).
 */
const crypto = require('crypto');
const { get, run, all } = require('../host').requireLib('db');

let tableReady = null;
function ensureTable() {
  // Uma vez por processo (CREATE IF NOT EXISTS a cada consulta = idas extras ao banco)
  if (!tableReady) {
    tableReady = (async () => {
      await run(`
        CREATE TABLE IF NOT EXISTS jarvis_lessons (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          fingerprint TEXT NOT NULL,
          tool TEXT NOT NULL,
          project_id TEXT,
          sintoma TEXT NOT NULL,
          solucao TEXT,
          count INT NOT NULL DEFAULT 1,
          first_seen TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          last_seen TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          resolved_at TIMESTAMP,
          ignored BOOLEAN NOT NULL DEFAULT false,
          UNIQUE (user_id, fingerprint)
        )
      `);
      await run(
        `CREATE INDEX IF NOT EXISTS idx_jarvis_lessons_user ON jarvis_lessons (user_id, resolved_at, last_seen DESC)`
      ).catch(() => {});
    })().catch((e) => {
      tableReady = null;
      throw e;
    });
  }
  return tableReady;
}

function redact(text) {
  try {
    return require('../tools/handlers/dev').redactSecrets(text);
  } catch {
    return String(text || '');
  }
}

/** Erro → sintoma estável: tira ids, números, urls e aspas pra repetição cair na mesma lição. */
function normalizeSintoma(erro) {
  return redact(String(erro || 'falha'))
    .replace(/https?:\/\/\S+/gi, '<url>')
    .replace(/\b[0-9a-f]{8,}\b/gi, '#')
    .replace(/\d+/g, '#')
    .replace(/["'`]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 240);
}

function projectOf(acao, projectIdFromTool) {
  const explicit = acao && (acao.project || acao.projeto || acao.project_id);
  if (explicit) return String(explicit).toLowerCase().slice(0, 48);
  return (projectIdFromTool && projectIdFromTool(acao && acao.tipo)) || null;
}

function fingerprintOf(tool, projectId, sintoma) {
  return crypto
    .createHash('sha1')
    .update(`${tool}|${projectId || ''}|${sintoma}`)
    .digest('hex')
    .slice(0, 16);
}

/** Args da chamada que passou, curtos, pra lição dizer "passou com …". */
function summarizeArgs(acao) {
  const skip = new Set(['tipo', '_ctx', 'content', 'files', 'image_base64', 'reference_image_base64']);
  const parts = [];
  for (const [k, v] of Object.entries(acao || {})) {
    if (skip.has(k) || v == null || typeof v === 'object') continue;
    parts.push(`${k}=${String(v).slice(0, 60)}`);
  }
  return redact(parts.join(' ')).slice(0, 200) || null;
}

/** Resultado que conta como falha "de verdade" (não é pedido de SIM nem bloqueio de permissão). */
function isLessonFailure(r) {
  return !!(r && r.ok === false && !r.pending_approval && !r.owner_blocked && !r.agent_scope_blocked);
}

/**
 * Registra o desfecho de um lote: falha → lição (+1 se repetida); sucesso → resolve
 * lições abertas da mesma tool no mesmo projeto.
 * @param {Array<{acao: object, result: object}>} pairs
 */
async function recordOutcomes(userId, pairs, { projectIdFromTool } = {}) {
  if (!userId || !Array.isArray(pairs) || !pairs.length) return { recorded: 0, resolved: 0 };
  await ensureTable();
  let recorded = 0;
  let resolved = 0;
  for (const { acao, result } of pairs) {
    const tool = String((result && result.tipo) || (acao && acao.tipo) || '');
    if (!tool) continue;
    const projectId = projectOf(acao, projectIdFromTool);
    if (isLessonFailure(result)) {
      const sintoma = normalizeSintoma(result.erro || result.error);
      const fp = fingerprintOf(tool, projectId, sintoma);
      await run(
        `INSERT INTO jarvis_lessons (id, user_id, fingerprint, tool, project_id, sintoma)
         VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (user_id, fingerprint) DO UPDATE SET
           count = jarvis_lessons.count + 1,
           last_seen = CURRENT_TIMESTAMP,
           resolved_at = NULL`,
        [fp, userId, fp, tool, projectId, sintoma]
      );
      recorded += 1;
    } else if (result && result.ok === true) {
      const r = await run(
        `UPDATE jarvis_lessons
         SET resolved_at = CURRENT_TIMESTAMP, solucao = $4
         WHERE user_id = $1 AND tool = $2 AND COALESCE(project_id, '') = COALESCE($3, '')
           AND resolved_at IS NULL`,
        [userId, tool, projectId, summarizeArgs(acao)]
      );
      resolved += Number(r && r.rowCount) || 0;
    }
  }
  if (recorded || resolved) {
    console.log(JSON.stringify({ tag: 'jarvis.lesson', event: 'outcomes', userId, recorded, resolved }));
  }
  return { recorded, resolved };
}

function hydrate(row) {
  return {
    id: row.id,
    tool: row.tool,
    project_id: row.project_id || null,
    sintoma: row.sintoma,
    solucao: row.solucao || null,
    count: Number(row.count) || 1,
    last_seen: row.last_seen,
    resolved: !!row.resolved_at
  };
}

/**
 * Lições relevantes pra um pedido: por tool e/ou projeto. Abertas primeiro;
 * resolvidas com solução entram como "da última vez passou com …".
 */
async function relevantLessons(userId, { tools = [], projectIds = [], limit = 5 } = {}) {
  if (!userId || (!tools.length && !projectIds.length)) return [];
  await ensureTable();
  const rows = await all(
    `SELECT * FROM jarvis_lessons
     WHERE user_id = $1 AND ignored = false
       AND (tool = ANY($2::text[]) OR project_id = ANY($3::text[]))
       AND (resolved_at IS NULL OR solucao IS NOT NULL)
     ORDER BY (resolved_at IS NULL) DESC, last_seen DESC
     LIMIT $4`,
    [userId, tools, projectIds, limit]
  );
  return (rows || []).map(hydrate);
}

/** Linha curta pro prompt (planner/turno). */
function formatLessonLine(l) {
  const onde = l.project_id ? ` em ${l.project_id}` : '';
  const vezes = l.count > 1 ? ` (${l.count}x)` : '';
  if (l.resolved && l.solucao) {
    return `- ${l.tool}${onde}: falhava com "${l.sintoma}"; passou com ${l.solucao}`;
  }
  return `- ${l.tool}${onde}: falha aberta${vezes} — "${l.sintoma}"`;
}

async function listLessons(userId, { includeResolved = false, limit = 10 } = {}) {
  await ensureTable();
  const rows = await all(
    `SELECT * FROM jarvis_lessons
     WHERE user_id = $1 AND ignored = false ${includeResolved ? '' : 'AND resolved_at IS NULL'}
     ORDER BY (resolved_at IS NULL) DESC, last_seen DESC
     LIMIT $2`,
    [userId, limit]
  );
  return (rows || []).map(hydrate);
}

/** "esquece a lição X" — não apaga (a falha pode voltar), só tira do contexto. */
async function ignoreLesson(userId, idPrefix) {
  await ensureTable();
  const prefix = String(idPrefix || '').toLowerCase().replace(/[^0-9a-f]/g, '');
  if (prefix.length < 4) return null;
  const row = await get(
    `UPDATE jarvis_lessons SET ignored = true
     WHERE id = (SELECT id FROM jarvis_lessons WHERE user_id = $1 AND id LIKE $2 ORDER BY last_seen DESC LIMIT 1)
     RETURNING *`,
    [userId, `${prefix}%`]
  );
  return row ? hydrate(row) : null;
}

module.exports = {
  ensureTable,
  normalizeSintoma,
  fingerprintOf,
  summarizeArgs,
  isLessonFailure,
  recordOutcomes,
  relevantLessons,
  formatLessonLine,
  listLessons,
  ignoreLesson
};
