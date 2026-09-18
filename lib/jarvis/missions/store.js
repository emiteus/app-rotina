/**
 * Mission store (Phase 7) — multi-step goals with status machine.
 */
const { v4: uuid } = require('uuid');
const { get, run, all } = require('../host').requireLib('db');

const STATUSES = [
  'draft',
  'planned',
  'running',
  'waiting_approval',
  'paused',
  'done',
  'failed',
  'cancelled'
];

async function ensureMissionsTable() {
  await run(`
    CREATE TABLE IF NOT EXISTS jarvis_missions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      goal TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'draft',
      steps JSONB NOT NULL DEFAULT '[]'::jsonb,
      current_step INT NOT NULL DEFAULT 0,
      result JSONB,
      criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      atualizado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await run(
    `CREATE INDEX IF NOT EXISTS idx_jarvis_missions_user ON jarvis_missions (user_id, status)`
  ).catch(() => {});
}

function shortId() {
  return uuid().replace(/-/g, '').slice(0, 10);
}

async function createMission(userId, goal, steps = []) {
  await ensureMissionsTable();
  const id = shortId();
  const normalized = (steps || []).map((s, i) => ({
    i,
    status: 'pending',
    description: s.description || s.tipo || `passo ${i + 1}`,
    tipo: s.tipo || null,
    kind: s.kind || (s.tipo ? 'tool' : 'info'),
    args: s.args || s,
    result: null
  }));
  const status = normalized.length ? 'planned' : 'draft';
  await run(
    `INSERT INTO jarvis_missions (id, user_id, goal, status, steps, current_step)
     VALUES ($1,$2,$3,$4,$5::jsonb,0)`,
    [id, userId, String(goal || '').slice(0, 500), status, JSON.stringify(normalized)]
  );
  console.log(
    JSON.stringify({
      tag: 'jarvis.mission',
      event: 'created',
      id,
      userId,
      steps: normalized.length,
      goal: String(goal || '').slice(0, 80)
    })
  );
  return getMission(id, userId);
}

async function getMission(id, userId) {
  await ensureMissionsTable();
  const row = await get(
    `SELECT * FROM jarvis_missions WHERE id = $1 AND user_id = $2`,
    [id, userId]
  );
  if (!row) return null;
  return hydrate(row);
}

async function getActiveMission(userId) {
  await ensureMissionsTable();
  const row = await get(
    `SELECT * FROM jarvis_missions
     WHERE user_id = $1 AND status IN ('draft','planned','running','waiting_approval','paused')
     ORDER BY atualizado_em DESC LIMIT 1`,
    [userId]
  );
  return row ? hydrate(row) : null;
}

async function listMissions(userId, limit = 10) {
  await ensureMissionsTable();
  const rows = await all(
    `SELECT * FROM jarvis_missions WHERE user_id = $1
     ORDER BY atualizado_em DESC LIMIT $2`,
    [userId, limit]
  );
  return (rows || []).map(hydrate);
}

function hydrate(row) {
  const steps = Array.isArray(row.steps) ? row.steps : JSON.parse(row.steps || '[]');
  return {
    id: row.id,
    userId: row.user_id,
    goal: row.goal,
    status: row.status,
    steps,
    currentStep: row.current_step || 0,
    result: row.result,
    criado_em: row.criado_em,
    atualizado_em: row.atualizado_em
  };
}

async function updateMission(id, userId, patch) {
  const cur = await getMission(id, userId);
  if (!cur) return null;
  const next = {
    status: patch.status != null ? patch.status : cur.status,
    steps: patch.steps != null ? patch.steps : cur.steps,
    currentStep: patch.currentStep != null ? patch.currentStep : cur.currentStep,
    result: patch.result !== undefined ? patch.result : cur.result
  };
  if (next.status && !STATUSES.includes(next.status)) {
    throw new Error(`status inválido: ${next.status}`);
  }
  await run(
    `UPDATE jarvis_missions
     SET status = $1, steps = $2::jsonb, current_step = $3, result = $4::jsonb,
         atualizado_em = CURRENT_TIMESTAMP
     WHERE id = $5 AND user_id = $6`,
    [
      next.status,
      JSON.stringify(next.steps),
      next.currentStep,
      next.result != null ? JSON.stringify(next.result) : null,
      id,
      userId
    ]
  );
  return getMission(id, userId);
}

async function cancelMission(id, userId) {
  return updateMission(id, userId, { status: 'cancelled' });
}

module.exports = {
  STATUSES,
  ensureMissionsTable,
  createMission,
  getMission,
  getActiveMission,
  listMissions,
  updateMission,
  cancelMission
};
