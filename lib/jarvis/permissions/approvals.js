/**
 * Pending approvals store (Phase 5 HITL).
 */
const { v4: uuid } = require('uuid');
const { get, run } = require('../../db');

const TTL_MS = Number(process.env.JARVIS_APPROVAL_TTL_MS) || 10 * 60 * 1000;

async function ensureApprovalsTable() {
  await run(`
    CREATE TABLE IF NOT EXISTS jarvis_approvals (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      acoes JSONB NOT NULL DEFAULT '[]'::jsonb,
      summary TEXT,
      max_risk TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      expira_em TIMESTAMP,
      resolvido_em TIMESTAMP
    )
  `);
  await run(`CREATE INDEX IF NOT EXISTS idx_jarvis_approvals_user_status
    ON jarvis_approvals (user_id, status)`).catch(() => {});
}

function shortId() {
  return uuid().replace(/-/g, '').slice(0, 8);
}

function summarizeAcoes(acoes) {
  return (acoes || [])
    .map((a) => {
      const t = a && a.tipo ? a.tipo : '?';
      const hint =
        a.titulo ||
        a.nome ||
        a.search ||
        a.email ||
        a.caption ||
        a.id ||
        a.categoria_label ||
        '';
      return hint ? `${t} (${String(hint).slice(0, 40)})` : t;
    })
    .join('; ');
}

async function expireStale(userId) {
  await run(
    `UPDATE jarvis_approvals SET status = 'expired', resolvido_em = CURRENT_TIMESTAMP
     WHERE user_id = $1 AND status = 'pending' AND expira_em IS NOT NULL AND expira_em < NOW()`,
    [userId]
  );
}

/**
 * Creates a pending approval; supersedes other pending for the same user.
 */
async function createApproval(userId, acoes, { maxRisk } = {}) {
  await ensureApprovalsTable();
  await expireStale(userId);
  await run(
    `UPDATE jarvis_approvals SET status = 'superseded', resolvido_em = CURRENT_TIMESTAMP
     WHERE user_id = $1 AND status = 'pending'`,
    [userId]
  );

  const id = shortId();
  const summary = summarizeAcoes(acoes);
  const expira = new Date(Date.now() + TTL_MS);
  await run(
    `INSERT INTO jarvis_approvals (id, user_id, acoes, summary, max_risk, status, expira_em)
     VALUES ($1,$2,$3::jsonb,$4,$5,'pending',$6)`,
    [id, userId, JSON.stringify(acoes || []), summary, maxRisk || 'high', expira.toISOString()]
  );

  console.log(
    JSON.stringify({
      tag: 'jarvis.approval',
      event: 'created',
      id,
      userId,
      maxRisk: maxRisk || 'high',
      summary,
      count: (acoes || []).length
    })
  );

  return { id, userId, acoes, summary, maxRisk: maxRisk || 'high', expira_em: expira };
}

async function getPendingApproval(userId) {
  await ensureApprovalsTable();
  await expireStale(userId);
  const row = await get(
    `SELECT * FROM jarvis_approvals
     WHERE user_id = $1 AND status = 'pending'
     ORDER BY criado_em DESC LIMIT 1`,
    [userId]
  );
  if (!row) return null;
  return {
    id: row.id,
    userId: row.user_id,
    acoes: Array.isArray(row.acoes) ? row.acoes : JSON.parse(row.acoes || '[]'),
    summary: row.summary,
    maxRisk: row.max_risk,
    expira_em: row.expira_em
  };
}

async function getApprovalById(id, userId) {
  await ensureApprovalsTable();
  const row = await get(
    `SELECT * FROM jarvis_approvals WHERE id = $1 AND user_id = $2`,
    [id, userId]
  );
  if (!row) return null;
  return {
    id: row.id,
    userId: row.user_id,
    acoes: Array.isArray(row.acoes) ? row.acoes : JSON.parse(row.acoes || '[]'),
    summary: row.summary,
    maxRisk: row.max_risk,
    status: row.status,
    expira_em: row.expira_em
  };
}

async function resolveApproval(id, userId, decision) {
  const status = decision === 'approve' ? 'approved' : 'rejected';
  const row = await get(
    `UPDATE jarvis_approvals
     SET status = $1, resolvido_em = CURRENT_TIMESTAMP
     WHERE id = $2 AND user_id = $3 AND status = 'pending'
     RETURNING *`,
    [status, id, userId]
  );
  console.log(
    JSON.stringify({
      tag: 'jarvis.approval',
      event: status,
      id,
      userId
    })
  );
  if (!row) return null;
  return {
    id: row.id,
    acoes: Array.isArray(row.acoes) ? row.acoes : JSON.parse(row.acoes || '[]'),
    summary: row.summary,
    status
  };
}

module.exports = {
  ensureApprovalsTable,
  createApproval,
  getPendingApproval,
  getApprovalById,
  resolveApproval,
  summarizeAcoes,
  TTL_MS
};
