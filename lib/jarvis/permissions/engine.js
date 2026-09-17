/**
 * Permission engine + HITL reply parser (Phase 5).
 */
const { RISK_ORDER, needsApproval } = require('../tools/definitions');
const { resolveToolMeta } = require('../tools/registry');
const {
  createApproval,
  getPendingApproval,
  getApprovalById,
  resolveApproval,
  summarizeAcoes
} = require('./approvals');

function hitlEnabled() {
  const v = String(process.env.JARVIS_HITL || '1').toLowerCase();
  return v !== '0' && v !== 'false' && v !== 'off';
}

function approvalThreshold() {
  const t = String(process.env.JARVIS_APPROVAL_THRESHOLD || 'high').toLowerCase();
  return RISK_ORDER[t] != null ? t : 'high';
}

function toolNeedsHitl(tipo) {
  if (!hitlEnabled()) return false;
  const meta = resolveToolMeta(tipo);
  if (!meta.registered) return false;
  return RISK_ORDER[meta.risk] >= RISK_ORDER[approvalThreshold()];
}

function splitByApproval(acoes) {
  const auto = [];
  const gated = [];
  for (const a of acoes || []) {
    if (toolNeedsHitl(a && a.tipo)) gated.push(a);
    else auto.push(a);
  }
  return { auto, gated };
}

function maxRiskOf(acoes) {
  let max = 'low';
  for (const a of acoes || []) {
    const r = resolveToolMeta(a && a.tipo).risk || 'medium';
    if (RISK_ORDER[r] > RISK_ORDER[max]) max = r;
  }
  return max;
}

/**
 * Pure confirm/cancel utterances (short). Optional short approval id.
 * @returns {{ decision: 'approve'|'reject', approvalId: string|null } | null}
 */
function parseApprovalReply(mensagem) {
  const t = String(mensagem || '').trim();
  if (!t || t.length > 40) return null;

  let m = t.match(
    /^(sim|confirma|confirmar|pode|yes|aprovado|aprova)(?:\s+([a-f0-9]{6,12}))?\s*[!.]*$/i
  );
  if (m) return { decision: 'approve', approvalId: m[2] || null };

  m = t.match(
    /^(n[aã]o|cancela|cancelar|nega|nope|no)(?:\s+([a-f0-9]{6,12}))?\s*[!.]*$/i
  );
  if (m) return { decision: 'reject', approvalId: m[2] || null };

  return null;
}

function formatApprovalAsk(approval) {
  const risk = (approval.maxRisk || 'high').toUpperCase();
  const summary = approval.summary || summarizeAcoes(approval.acoes);
  return (
    `⚠️ Ação **${risk}** aguardando confirmação (**${approval.id}**):\n` +
    `${summary}\n\n` +
    `Responde **SIM** pra executar ou **NÃO** pra cancelar.`
  );
}

async function holdForApproval(userId, gatedAcoes) {
  const approval = await createApproval(userId, gatedAcoes, {
    maxRisk: maxRiskOf(gatedAcoes)
  });
  return (gatedAcoes || []).map((a) => ({
    tipo: a.tipo,
    ok: false,
    pending_approval: true,
    approval_id: approval.id,
    risk: resolveToolMeta(a.tipo).risk,
    summary: approval.summary
  }));
}

/**
 * If message is SIM/NÃO against a pending approval, resolve it.
 * @returns {null | { handled: true, resposta: string, acoes: Array, approval: object }}
 */
async function tryHandleApprovalReply(userId, mensagem, executeApproved) {
  const parsed = parseApprovalReply(mensagem);
  if (!parsed) return null;

  let pending = null;
  if (parsed.approvalId) {
    pending = await getApprovalById(parsed.approvalId, userId);
    if (pending && pending.status !== 'pending') {
      return {
        handled: true,
        resposta: `Essa aprovação (**${pending.id}**) já está **${pending.status}**.`,
        acoes: [],
        approval: pending
      };
    }
  }
  if (!pending) pending = await getPendingApproval(userId);

  if (!pending) {
    // "sim"/"ok" solto sem pendência → deixa o chat normal seguir
    if (parsed.approvalId) {
      return {
        handled: true,
        resposta: `Não achei aprovação **${parsed.approvalId}** pendente.`,
        acoes: [],
        approval: null
      };
    }
    return null;
  }

  const resolved = await resolveApproval(pending.id, userId, parsed.decision);
  if (!resolved) {
    return {
      handled: true,
      resposta: 'Essa aprovação expirou ou já foi resolvida.',
      acoes: [],
      approval: pending
    };
  }

  if (parsed.decision === 'reject') {
    return {
      handled: true,
      resposta: `Cancelado — não executei **${pending.summary || pending.id}**.`,
      acoes: [{ tipo: 'approval_reject', ok: true, approval_id: pending.id }],
      approval: pending
    };
  }

  const acoes = await executeApproved(pending.acoes || []);
  return {
    handled: true,
    resposta: null, // caller reconciles
    acoes,
    approval: pending,
    approved: true
  };
}

module.exports = {
  hitlEnabled,
  approvalThreshold,
  toolNeedsHitl,
  splitByApproval,
  maxRiskOf,
  parseApprovalReply,
  formatApprovalAsk,
  holdForApproval,
  tryHandleApprovalReply,
  needsApproval,
  getPendingApproval
};
