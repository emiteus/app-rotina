/**
 * Pending approvals store (Phase 5 HITL) — channel-scoped.
 */
const { v4: uuid } = require('uuid');
const { get, run } = require('../host').requireLib('db');

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
      channel TEXT,
      criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      expira_em TIMESTAMP,
      resolvido_em TIMESTAMP
    )
  `);
  await run(
    `ALTER TABLE jarvis_approvals ADD COLUMN IF NOT EXISTS channel TEXT`
  ).catch(() => {});
  await run(
    `CREATE INDEX IF NOT EXISTS idx_jarvis_approvals_user_status
    ON jarvis_approvals (user_id, status)`
  ).catch(() => {});
}

function shortId() {
  return uuid().replace(/-/g, '').slice(0, 8);
}

function normalizeChannel(channel) {
  const c = String(channel || '').trim().toLowerCase();
  return c || 'unknown';
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
        a.path ||
        a.arquivo ||
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
 * Creates a pending approval; supersedes other pending for the same user+channel.
 */
async function createApproval(userId, acoes, { maxRisk, channel } = {}) {
  await ensureApprovalsTable();
  await expireStale(userId);
  const ch = normalizeChannel(channel);
  await run(
    `UPDATE jarvis_approvals SET status = 'superseded', resolvido_em = CURRENT_TIMESTAMP
     WHERE user_id = $1 AND status = 'pending' AND COALESCE(channel, 'unknown') = $2`,
    [userId, ch]
  );

  const id = shortId();
  const summary = summarizeAcoes(acoes);
  const expira = new Date(Date.now() + TTL_MS);
  await run(
    `INSERT INTO jarvis_approvals (id, user_id, acoes, summary, max_risk, status, channel, expira_em)
     VALUES ($1,$2,$3::jsonb,$4,$5,'pending',$6,$7)`,
    [id, userId, JSON.stringify(acoes || []), summary, maxRisk || 'high', ch, expira.toISOString()]
  );

  console.log(
    JSON.stringify({
      tag: 'jarvis.approval',
      event: 'created',
      id,
      userId,
      channel: ch,
      maxRisk: maxRisk || 'high',
      summary,
      count: (acoes || []).length
    })
  );

  return {
    id,
    userId,
    acoes,
    summary,
    maxRisk: maxRisk || 'high',
    channel: ch,
    expira_em: expira
  };
}

async function getPendingApproval(userId, channel = null) {
  await ensureApprovalsTable();
  await expireStale(userId);
  const ch = channel != null ? normalizeChannel(channel) : null;
  const row = ch
    ? await get(
        `SELECT * FROM jarvis_approvals
         WHERE user_id = $1 AND status = 'pending'
           AND COALESCE(channel, 'unknown') = $2
         ORDER BY criado_em DESC LIMIT 1`,
        [userId, ch]
      )
    : await get(
        `SELECT * FROM jarvis_approvals
         WHERE user_id = $1 AND status = 'pending'
         ORDER BY criado_em DESC LIMIT 1`,
        [userId]
      );
  if (!row) return null;
  return hydrateApproval(row);
}

async function getApprovalById(id, userId) {
  await ensureApprovalsTable();
  // TTL vale também no caminho "SIM <id>", não só no pending do canal
  await expireStale(userId);
  const row = await get(
    `SELECT * FROM jarvis_approvals WHERE id = $1 AND user_id = $2`,
    [id, userId]
  );
  if (!row) return null;
  return hydrateApproval(row);
}

/**
 * Reaproveita um pending do mesmo canal trocando as ações pelo pedido atual.
 * Sem isso, o SIM executaria o pedido anterior.
 */
async function replaceApprovalAcoes(id, userId, acoes, { maxRisk } = {}) {
  const summary = summarizeAcoes(acoes);
  const expira = new Date(Date.now() + TTL_MS);
  const row = await get(
    `UPDATE jarvis_approvals
     SET acoes = $1::jsonb, summary = $2, max_risk = $3, expira_em = $4
     WHERE id = $5 AND user_id = $6 AND status = 'pending'
     RETURNING *`,
    [
      JSON.stringify(acoes || []),
      summary,
      maxRisk || 'high',
      expira.toISOString(),
      id,
      userId
    ]
  );
  if (!row) return null;
  console.log(
    JSON.stringify({
      tag: 'jarvis.approval',
      event: 'replaced',
      id,
      userId,
      summary,
      count: (acoes || []).length
    })
  );
  return hydrateApproval(row);
}

function hydrateApproval(row) {
  return {
    id: row.id,
    userId: row.user_id,
    acoes: Array.isArray(row.acoes) ? row.acoes : JSON.parse(row.acoes || '[]'),
    summary: row.summary,
    maxRisk: row.max_risk,
    channel: row.channel || 'unknown',
    status: row.status,
    expira_em: row.expira_em
  };
}

async function resolveApproval(id, userId, decision) {
  const status = decision === 'approve' ? 'approved' : 'rejected';
  // Aprovar só vale dentro do TTL; rejeitar pode a qualquer momento
  const expiryGuard =
    decision === 'approve'
      ? `AND (expira_em IS NULL OR expira_em > NOW())`
      : '';
  const row = await get(
    `UPDATE jarvis_approvals
     SET status = $1, resolvido_em = CURRENT_TIMESTAMP
     WHERE id = $2 AND user_id = $3 AND status = 'pending' ${expiryGuard}
     RETURNING *`,
    [status, id, userId]
  );
  console.log(
    JSON.stringify({
      tag: 'jarvis.approval',
      event: status,
      id,
      userId,
      channel: row && row.channel ? row.channel : null
    })
  );
  if (!row) return null;
  return {
    id: row.id,
    acoes: Array.isArray(row.acoes) ? row.acoes : JSON.parse(row.acoes || '[]'),
    summary: row.summary,
    channel: row.channel || 'unknown',
    status
  };
}

module.exports = {
  ensureApprovalsTable,
  createApproval,
  getPendingApproval,
  getApprovalById,
  replaceApprovalAcoes,
  resolveApproval,
  expireStale,
  summarizeAcoes,
  normalizeChannel,
  TTL_MS
};
