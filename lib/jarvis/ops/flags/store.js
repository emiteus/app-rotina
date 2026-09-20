/**
 * Ops flags store — durable per (user_id, project_id, key).
 * Works for ANY project; adapters may sync live backends.
 */
const { get, run, all } = require('../../host').requireLib('db');

async function ensureTable() {
  await run(`
    CREATE TABLE IF NOT EXISTS jarvis_ops_flags (
      user_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      flag_key TEXT NOT NULL,
      enabled BOOLEAN NOT NULL DEFAULT TRUE,
      note TEXT,
      synced BOOLEAN NOT NULL DEFAULT FALSE,
      live BOOLEAN NOT NULL DEFAULT FALSE,
      remote JSONB,
      atualizado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (user_id, project_id, flag_key)
    )
  `);
  await run(
    `CREATE INDEX IF NOT EXISTS idx_jarvis_ops_flags_user
     ON jarvis_ops_flags (user_id, atualizado_em DESC)`
  ).catch(() => {});
}

function hydrate(row) {
  if (!row) return null;
  let remote = row.remote;
  if (typeof remote === 'string') {
    try {
      remote = JSON.parse(remote);
    } catch {
      remote = null;
    }
  }
  return {
    project_id: row.project_id,
    key: row.flag_key,
    enabled: row.enabled !== false && row.enabled !== 0,
    note: row.note || null,
    synced: !!(row.synced === true || row.synced === 1),
    live: !!(row.live === true || row.live === 1),
    remote: remote || null,
    updated_at: row.atualizado_em || null
  };
}

async function listFlags(userId, projectId) {
  await ensureTable();
  if (projectId) {
    const rows = await all(
      `SELECT * FROM jarvis_ops_flags
       WHERE user_id = $1 AND project_id = $2
       ORDER BY flag_key ASC`,
      [userId, projectId]
    );
    return (rows || []).map(hydrate);
  }
  const rows = await all(
    `SELECT * FROM jarvis_ops_flags
     WHERE user_id = $1
     ORDER BY project_id ASC, flag_key ASC`,
    [userId]
  );
  return (rows || []).map(hydrate);
}

async function getFlag(userId, projectId, key) {
  await ensureTable();
  const row = await get(
    `SELECT * FROM jarvis_ops_flags
     WHERE user_id = $1 AND project_id = $2 AND flag_key = $3`,
    [userId, projectId, key]
  );
  return hydrate(row);
}

async function upsertFlag(userId, projectId, key, fields = {}) {
  await ensureTable();
  const enabled = fields.enabled !== false;
  const note =
    fields.note != null ? String(fields.note).slice(0, 500) : null;
  const synced = !!fields.synced;
  const live = !!fields.live;
  const remote = fields.remote != null ? JSON.stringify(fields.remote) : null;

  await run(
    `INSERT INTO jarvis_ops_flags
       (user_id, project_id, flag_key, enabled, note, synced, live, remote, atualizado_em)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, CURRENT_TIMESTAMP)
     ON CONFLICT (user_id, project_id, flag_key) DO UPDATE SET
       enabled = EXCLUDED.enabled,
       note = COALESCE(EXCLUDED.note, jarvis_ops_flags.note),
       synced = EXCLUDED.synced,
       live = EXCLUDED.live,
       remote = COALESCE(EXCLUDED.remote, jarvis_ops_flags.remote),
       atualizado_em = CURRENT_TIMESTAMP`,
    [userId, projectId, key, enabled, note, synced, live, remote]
  );
  return getFlag(userId, projectId, key);
}

module.exports = {
  ensureTable,
  listFlags,
  getFlag,
  upsertFlag
};
