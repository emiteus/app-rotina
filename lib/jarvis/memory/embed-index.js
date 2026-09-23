/**
 * Durable embedding index for project memory chunks.
 * Cosine search in JS (no pgvector required).
 */
const { get, run, all } = require('../host').requireLib('db');
const { once } = require('../db-once');
const { embedText, cosineSimilarity, embeddingsEnabled, embeddingModel } = require('./embeddings');

const ensureTable = once(async () => {
  await run(`
    CREATE TABLE IF NOT EXISTS jarvis_memory_embeddings (
      user_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      chunk_key TEXT NOT NULL,
      kind TEXT NOT NULL,
      text TEXT NOT NULL,
      embedding JSONB NOT NULL,
      model TEXT NOT NULL,
      atualizado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (user_id, project_id, chunk_key)
    )
  `);
  await run(
    `CREATE INDEX IF NOT EXISTS idx_jarvis_mem_emb_user
     ON jarvis_memory_embeddings (user_id, atualizado_em DESC)`
  ).catch(() => {});
});

/** Chave pelo conteúdo: nota nova no topo não desloca (e re-embeda) todas as outras. */
function chunkKey(kind, text) {
  const h = require('crypto').createHash('sha1').update(String(text)).digest('hex').slice(0, 12);
  return `${kind}:${h}`;
}

/**
 * Build indexable chunks from a memory row / hydrated object.
 */
function chunksFromMemory(mem) {
  if (!mem) return [];
  const pid = mem.project_id;
  const out = [];
  if (mem.stack) {
    out.push({ chunk_key: chunkKey('stack', mem.stack), kind: 'stack', text: `stack: ${mem.stack}` });
  }
  if (mem.objetivo) {
    out.push({
      chunk_key: chunkKey('objetivo', mem.objetivo),
      kind: 'objetivo',
      text: `objetivo: ${mem.objetivo}`
    });
  }
  if (mem.status) {
    out.push({
      chunk_key: chunkKey('status', mem.status),
      kind: 'status',
      text: `status: ${mem.status}`
    });
  }
  (mem.decisoes || []).forEach((d) => {
    const text = typeof d === 'string' ? d : d && d.text;
    if (text) {
      out.push({
        chunk_key: chunkKey('decisao', text),
        kind: 'decisao',
        text: String(text)
      });
    }
  });
  (mem.notas || []).forEach((n) => {
    const text = typeof n === 'string' ? n : n && n.text;
    if (text) {
      out.push({ chunk_key: chunkKey('nota', text), kind: 'nota', text: String(text) });
    }
  });
  if (mem.ultima_falha && mem.ultima_falha.text) {
    out.push({
      chunk_key: chunkKey('falha', mem.ultima_falha.text),
      kind: 'falha',
      text: String(mem.ultima_falha.text)
    });
  }
  return out.map((c) => ({ ...c, project_id: pid }));
}

async function upsertChunk(userId, projectId, chunk, vector) {
  await ensureTable();
  await run(
    `INSERT INTO jarvis_memory_embeddings
       (user_id, project_id, chunk_key, kind, text, embedding, model, atualizado_em)
     VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,CURRENT_TIMESTAMP)
     ON CONFLICT (user_id, project_id, chunk_key) DO UPDATE SET
       kind = EXCLUDED.kind,
       text = EXCLUDED.text,
       embedding = EXCLUDED.embedding,
       model = EXCLUDED.model,
       atualizado_em = CURRENT_TIMESTAMP`,
    [
      userId,
      projectId,
      chunk.chunk_key,
      chunk.kind,
      String(chunk.text).slice(0, 2000),
      JSON.stringify(vector),
      embeddingModel()
    ]
  );
}

async function deleteStaleChunks(userId, projectId, keepKeys) {
  await ensureTable();
  if (!keepKeys.length) {
    await run(
      `DELETE FROM jarvis_memory_embeddings WHERE user_id = $1 AND project_id = $2`,
      [userId, projectId]
    );
    return;
  }
  // delete keys not in keepKeys
  await run(
    `DELETE FROM jarvis_memory_embeddings
     WHERE user_id = $1 AND project_id = $2
       AND NOT (chunk_key = ANY($3::text[]))`,
    [userId, projectId, keepKeys]
  );
}

/**
 * Reindex all chunks for a project memory (best-effort; never throws to caller).
 */
async function reindexProjectMemory(userId, mem) {
  if (!embeddingsEnabled() || !mem || !mem.project_id) return { ok: false, skipped: true };
  const chunks = chunksFromMemory(mem);
  // Só re-embeda o que mudou: cada falha de tool regravava a memória e re-embedava
  // tudo (~40 chamadas) de novo.
  await ensureTable();
  const existing = await all(
    `SELECT chunk_key, text, model FROM jarvis_memory_embeddings
     WHERE user_id = $1 AND project_id = $2`,
    [userId, mem.project_id]
  );
  const known = new Map((existing || []).map((r) => [r.chunk_key, r]));
  const model = embeddingModel();
  const keep = [];
  let indexed = 0;
  let reused = 0;
  for (const c of chunks) {
    const prev = known.get(c.chunk_key);
    if (prev && prev.model === model && prev.text === String(c.text).slice(0, 2000)) {
      keep.push(c.chunk_key);
      reused += 1;
      continue;
    }
    const vector = await embedText(c.text, 'RETRIEVAL_DOCUMENT');
    if (!vector) continue;
    await upsertChunk(userId, mem.project_id, c, vector);
    keep.push(c.chunk_key);
    indexed += 1;
  }
  await deleteStaleChunks(userId, mem.project_id, keep);
  console.log(
    JSON.stringify({
      tag: 'jarvis.embed',
      event: 'reindex',
      userId,
      projectId: mem.project_id,
      indexed,
      reused,
      total: chunks.length
    })
  );
  return { ok: true, indexed };
}

/**
 * @returns {Promise<Array<{project_id, kind, text, score, t?}>>}
 */
async function searchEmbeddings(userId, query, { projectIds = null, limit = 6, minScore = 0.55 } = {}) {
  if (!embeddingsEnabled()) return [];
  const qVec = await embedText(query, 'RETRIEVAL_QUERY');
  if (!qVec) return [];

  await ensureTable();
  let rows;
  if (projectIds && projectIds.length) {
    rows = await all(
      `SELECT project_id, kind, text, embedding
       FROM jarvis_memory_embeddings
       WHERE user_id = $1 AND project_id = ANY($2::text[])`,
      [userId, projectIds]
    );
  } else {
    rows = await all(
      `SELECT project_id, kind, text, embedding
       FROM jarvis_memory_embeddings
       WHERE user_id = $1
       ORDER BY atualizado_em DESC
       LIMIT 200`,
      [userId]
    );
  }

  const scored = [];
  for (const row of rows || []) {
    let emb = row.embedding;
    if (typeof emb === 'string') {
      try {
        emb = JSON.parse(emb);
      } catch {
        continue;
      }
    }
    if (!Array.isArray(emb)) continue;
    const score = cosineSimilarity(qVec, emb);
    if (score >= minScore) {
      scored.push({
        project_id: row.project_id,
        kind: row.kind,
        text: row.text,
        score: Math.round(score * 1000) / 1000,
        t: null
      });
    }
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit);
}

module.exports = {
  ensureTable,
  chunksFromMemory,
  reindexProjectMemory,
  searchEmbeddings,
  cosineSimilarity
};
