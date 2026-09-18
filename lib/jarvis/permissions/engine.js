/**
 * Permission engine + HITL reply parser (Phase 5).
 * Approvals are channel-scoped.
 * WhatsApp: HITL off by default (personal OS) — opt-in JARVIS_HITL_WHATSAPP=1.
 * Bare SIM/NÃO OK when there's exactly one pending on this channel.
 */
const { RISK_ORDER, needsApproval } = require('../tools/definitions');
const { resolveToolMeta } = require('../tools/registry');
const {
  createApproval,
  getPendingApproval,
  getApprovalById,
  resolveApproval,
  summarizeAcoes,
  normalizeChannel
} = require('./approvals');

function hitlEnabled() {
  const v = String(process.env.JARVIS_HITL || '1').toLowerCase();
  return v !== '0' && v !== 'false' && v !== 'off';
}

/** HITL per channel — WA trusted by default for this personal hub. */
function hitlAppliesToChannel(channel) {
  if (!hitlEnabled()) return false;
  const ch = normalizeChannel(channel);
  if (ch === 'whatsapp') {
    return process.env.JARVIS_HITL_WHATSAPP === '1';
  }
  return true;
}

function approvalThreshold() {
  const t = String(process.env.JARVIS_APPROVAL_THRESHOLD || 'high').toLowerCase();
  return RISK_ORDER[t] != null ? t : 'high';
}

function toolNeedsHitl(tipo, channel = null) {
  if (!hitlEnabled()) return false;
  const meta = resolveToolMeta(tipo);
  if (!meta.registered) return false;
  // critical = sempre SIM (inclusive WhatsApp)
  if (meta.risk === 'critical') return true;
  if (!hitlAppliesToChannel(channel)) return false;
  return RISK_ORDER[meta.risk] >= RISK_ORDER[approvalThreshold()];
}

function splitByApproval(acoes, channel = null) {
  const auto = [];
  const gated = [];
  for (const a of acoes || []) {
    if (toolNeedsHitl(a && a.tipo, channel)) gated.push(a);
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
 * Confirm/cancel. Id optional when there's a pending approval on the channel.
 * @returns {{ decision: 'approve'|'reject', approvalId: string|null } | null}
 */
function parseApprovalReply(mensagem) {
  const t = String(mensagem || '').trim();
  if (!t || t.length > 48) return null;

  let m = t.match(
    /^(sim|confirma|confirmar|pode|yes|aprovado|aprova)\s+(?:#)?([a-f0-9]{6,12})\s*[!.]*$/i
  );
  if (m) return { decision: 'approve', approvalId: m[2] };

  m = t.match(
    /^(n[aã]o|cancela|cancelar|nega|nope|no)\s+(?:#)?([a-f0-9]{6,12})\s*[!.]*$/i
  );
  if (m) return { decision: 'reject', approvalId: m[2] };

  // Bare SIM/NÃO — resolved against channel pending (if any)
  m = t.match(/^(sim|confirma|confirmar|pode|yes|aprovado|aprova)\s*[!.]*$/i);
  if (m) return { decision: 'approve', approvalId: null };

  m = t.match(/^(n[aã]o|cancela|cancelar|nega|nope|no)\s*[!.]*$/i);
  if (m) return { decision: 'reject', approvalId: null };

  return null;
}

function formatApprovalAsk(approval) {
  const risk = (approval.maxRisk || 'high').toUpperCase();
  const summary = approval.summary || summarizeAcoes(approval.acoes);
  const id = approval.id;
  return (
    `⚠️ Ainda preciso da sua confirmação (**${id}**):\n` +
    `${summary}\n\n` +
    `Responde **SIM** (ou **SIM ${id}**) pra executar, **NÃO** pra cancelar.`
  );
}

async function holdForApproval(userId, gatedAcoes, { channel } = {}) {
  // Reuse pending on same channel — don't spawn a cascade of new ids
  const existing = await getPendingApproval(userId, channel);
  if (existing) {
    return (gatedAcoes || []).map((a) => ({
      tipo: a.tipo,
      ok: false,
      pending_approval: true,
      approval_id: existing.id,
      channel: existing.channel,
      risk: resolveToolMeta(a.tipo).risk,
      summary: existing.summary,
      reused: true
    }));
  }

  const approval = await createApproval(userId, gatedAcoes, {
    maxRisk: maxRiskOf(gatedAcoes),
    channel
  });
  return (gatedAcoes || []).map((a) => ({
    tipo: a.tipo,
    ok: false,
    pending_approval: true,
    approval_id: approval.id,
    channel: approval.channel,
    risk: resolveToolMeta(a.tipo).risk,
    summary: approval.summary
  }));
}

/**
 * Resolve SIM/NÃO against pending approval on this channel.
 */
async function tryHandleApprovalReply(userId, mensagem, executeApproved, opts = {}) {
  const parsed = parseApprovalReply(mensagem);
  if (!parsed) return null;

  const channel = normalizeChannel(opts.channel);

  let pending = null;
  if (parsed.approvalId) {
    pending = await getApprovalById(parsed.approvalId, userId);
    if (!pending) {
      return {
        handled: true,
        resposta: `Não achei aprovação **${parsed.approvalId}** pendente.`,
        acoes: [],
        approval: null
      };
    }
  } else {
    pending = await getPendingApproval(userId, channel);
    // Bare SIM/NÃO without pending → let normal chat continue
    if (!pending) return null;
  }

  if (pending.status && pending.status !== 'pending') {
    return {
      handled: true,
      resposta: `Essa aprovação (**${pending.id}**) já está **${pending.status}**.`,
      acoes: [],
      approval: pending
    };
  }

  const pendingChannel = normalizeChannel(pending.channel);
  if (pendingChannel !== channel) {
    return {
      handled: true,
      resposta:
        `Aprovação **${pending.id}** é do canal **${pendingChannel}** — ` +
        `confirma pelo mesmo canal.`,
      acoes: [],
      approval: pending
    };
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
    resposta: null,
    acoes,
    approval: pending,
    approved: true
  };
}

/** Follow-ups like "conseguiu?" while something is waiting — don't invent a new plan. */
function looksLikeApprovalFollowUp(mensagem) {
  const t = String(mensagem || '').trim();
  if (!t || t.length > 80) return false;
  return /^(conseguiu|rodou|foi\??|e a[ií]|status|confirma|aprov|pendente|e agora|já\s*(fez|foi|rodou)|ok\s*\??)\b/i.test(
    t
  );
}

module.exports = {
  hitlEnabled,
  hitlAppliesToChannel,
  approvalThreshold,
  toolNeedsHitl,
  splitByApproval,
  maxRiskOf,
  parseApprovalReply,
  formatApprovalAsk,
  holdForApproval,
  tryHandleApprovalReply,
  looksLikeApprovalFollowUp,
  needsApproval,
  getPendingApproval
};
