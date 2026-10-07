/**
 * Permission engine + HITL reply parser (Phase 5).
 * Approvals are channel-scoped.
 * WhatsApp (0.10.37): high/medium AUTO por padrão (autonomia). Opt-in HITL high: JARVIS_HITL_WHATSAPP=1.
 * Critical sempre pede SIM em qualquer canal.
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

/**
 * HITL high/medium por canal. Critical é tratado em toolNeedsHitl (sempre).
 * WA: autonomia — high auto; só reativa high com JARVIS_HITL_WHATSAPP=1.
 */
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
  const meta = resolveToolMeta(tipo);
  if (!meta.registered) return false;
  // critical = sempre SIM (inclusive WhatsApp e com JARVIS_HITL=0)
  if (meta.risk === 'critical') return true;
  if (!hitlEnabled()) return false;
  if (!hitlAppliesToChannel(channel)) return false;
  return RISK_ORDER[meta.risk] >= RISK_ORDER[approvalThreshold()];
}

function splitByApproval(acoes, channel = null) {
  const auto = [];
  const gated = [];
  const { runTestsNeedsApproval } = require('./patch-marks');
  for (const a of acoes || []) {
    // Teste depois de patch local = executar o patch → SIM sempre (como critical)
    if (toolNeedsHitl(a && a.tipo, channel) || runTestsNeedsApproval(a)) gated.push(a);
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
/**
 * Voz chega como "Ei, Jarvis. Sim." (a transcrição pega o nome junto) e "Pode, Jarvis." —
 * tira o vocativo e a pontuação da ponta antes de ler (25/09/2026: o "sim" falado virava pedido
 * novo e o Jarvis perguntava de novo).
 */
function stripVocative(mensagem) {
  return String(mensagem || '')
    .trim()
    .replace(/^\[?[áa]udio transcrito\]?:?\s*/i, '')
    .replace(/^(?:(?:ei|hey|oi|ô|o|e a[ií]|fala)[\s,.!]*)?jarvis[\s,.!:]*/i, '')
    .replace(/[\s,.!]*jarvis[\s,.!]*$/i, '')
    .replace(/^[\s,.!]+|[\s,.!]+$/g, '')
    .trim();
}

// Só valem com aprovação pendente no canal (sem pendente, seguem pra conversa normal)
const BARE_YES =
  /^(sim(?:\s+sim)?|ah\s+sim|[eé]\s+sim|sim(?:\s+pfv|\s+por\s+favor)?|confirma|confirmar|confirmo|yes|aprovado|aprova|aprovo|aprovar|pode(?: sim| fazer| mandar| ir| seguir| rodar)?|sim,? pode|pode sim,? jarvis|manda(?: ver| bala| a[ií])?|bora|vai|faz(?: isso| a[ií])?|isso|claro|positivo|ok|beleza|fechou|com certeza|sim senhor|ok,? pode|t[aá]|tudo\s+bem)$/i;
const BARE_NO =
  /^(n[aã]o|cancela|cancelar|nega|negar|nope|no|n[aã]o precisa|n[aã]o,? obrigado|deixa|deixa (?:pra|para) l[aá]|esquece|negativo|para|n[aã]o faz)$/i;

// "Sempre sim" / "sempre não" (permissions/standing.js): resposta + lembrar pra próxima vez
const ALWAYS_YES = /^(?:sempre(?:,)?\s+(?:sim|pode|aprova|faz)|(?:sim|pode)(?:,)?\s+sempre|pode\s+fazer\s+sempre|sempre|faz\s+sempre(?:\s+sem\s+perguntar)?|(?:pode\s+)?(?:fazer\s+)?sem\s+(?:me\s+)?perguntar)$/i;
const ALWAYS_NO = /^(?:sempre(?:,)?\s+n[aã]o|n[aã]o(?:,)?\s+(?:sempre|nunca(?:\s+mais)?)|nunca(?:\s+mais)?|nunca\s+faz(?:\s+isso)?)$/i;
// "sempre sim qualquer" = vale pra QUALQUER alvo desse tipo (não só o Discord dessa vez)
const ALWAYS_YES_TIPO = /^sempre\s+sim\s+qualquer$/i;
const ALWAYS_NO_TIPO = /^sempre\s+n[aã]o\s+qualquer$/i;

function parseApprovalReply(mensagem) {
  const t = stripVocative(mensagem);
  if (!t || t.length > 64) return null;

  // "sempre sim 2322c40d" / "sempre não 2322c40d" (botões do PC e do celular mandam com o código)
  let m = t.match(/^sempre\s+(sim|n[aã]o)\s+(?:#)?([a-f0-9]{6,12})\s*[!.]*$/i);
  if (m) return { decision: /^sim$/i.test(m[1]) ? 'approve' : 'reject', approvalId: m[2], always: true };
  if (ALWAYS_YES_TIPO.test(t)) return { decision: 'approve', approvalId: null, always: true, porTipo: true };
  if (ALWAYS_NO_TIPO.test(t)) return { decision: 'reject', approvalId: null, always: true, porTipo: true };
  if (ALWAYS_YES.test(t)) return { decision: 'approve', approvalId: null, always: true };
  if (ALWAYS_NO.test(t)) return { decision: 'reject', approvalId: null, always: true };

  m = t.match(
    /^(sim|confirma|confirmar|pode|yes|aprovado|aprova|aprovar)\s+(?:#)?([a-f0-9]{6,12})\s*[!.]*$/i
  );
  if (m) return { decision: 'approve', approvalId: m[2] };

  m = t.match(
    /^(n[aã]o|cancela|cancelar|nega|negar|nope|no)\s+(?:#)?([a-f0-9]{6,12})\s*[!.]*$/i
  );
  if (m) return { decision: 'reject', approvalId: m[2] };

  // Bare SIM/NÃO — resolved against channel pending (if any; sem pendente vira conversa normal).
  if (BARE_YES.test(t)) return { decision: 'approve', approvalId: null };
  if (BARE_NO.test(t)) return { decision: 'reject', approvalId: null };

  // Só o id da aprovação (ex. 2322c40d) = SIM
  m = t.match(/^(?:#)?([a-f0-9]{6,12})\s*[!.]*$/i);
  if (m) return { decision: 'approve', approvalId: m[1] };

  return null;
}

function formatApprovalAsk(approval) {
  const summary = approval.summary || summarizeAcoes(approval.acoes);
  // Só a pergunta (Mateus, 24/09/2026: "eu sei como funciona, a instrução polui o WhatsApp").
  // SIM/NÃO continuam valendo; o código segue no banco pro "SIM <código>" de quem quiser usar.
  return `Posso ${summary}?`;
}

async function holdForApproval(userId, gatedAcoes, { channel } = {}) {
  // Sempre id novo: createApproval marca o pendente anterior do canal como superseded.
  // Reusar o id trocando as ações fazia "SIM <id antigo>" executar o pedido novo.
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

  // "sempre sim/não": grava a regra ANTES de executar (se a execução cair, a decisão já ficou)
  let nota = '';
  if (parsed.always) {
    const standing = require('./standing');
    try {
      const { gravadas, recusadas } = await standing.lembrarDecisao(
        userId,
        pending.acoes || [],
        parsed.decision === 'approve' ? standing.SEMPRE_SIM : standing.SEMPRE_NAO,
        { porTipo: !!parsed.porTipo }
      );
      const lista = (xs) => xs.map((x) => `**${x}**`).join(', ');
      if (parsed.decision === 'approve') {
        if (gravadas.length) nota += `Combinado: daqui pra frente faço ${lista(gravadas)} sem perguntar.`;
        if (recusadas.length) {
          nota += `${nota ? ' ' : ''}Isso aqui eu continuo perguntando toda vez (mexe com dinheiro, apaga, publica ou fala com cliente): ${lista(recusadas)}.`;
        }
      } else if (gravadas.length) {
        nota = `E não pergunto mais: nunca faço ${lista(gravadas)}.`;
      }
      if (nota) nota += ' Pra desfazer: "volta a me perguntar sobre …".';
    } catch (e) {
      console.error('[jarvis] regra de aprovação:', e.message);
      nota = 'Não consegui guardar o "sempre" agora; da próxima vez eu pergunto de novo.';
    }
  }

  if (parsed.decision === 'reject') {
    return {
      handled: true,
      resposta: `Cancelado — não executei **${pending.summary || pending.id}**.${nota ? `\n\n${nota}` : ''}`,
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
    approved: true,
    nota: nota || undefined
  };
}

/** Follow-ups like "conseguiu?" / "é do que?" while something is waiting — don't invent a new plan. */
function looksLikeApprovalFollowUp(mensagem) {
  const t = stripVocative(mensagem);
  if (!t || t.length > 80) return false;
  return (
    /^(conseguiu|rodou|foi\??|e a[ií]|status|confirma|aprov|pendente|e agora|já\s*(fez|foi|rodou)|ok\s*\??)\b/i.test(
      t
    ) ||
    /^(é|eh|e)\s+do\s+que\b/i.test(t) ||
    /^do\s+que(\s+[eé])?\??$/i.test(t) ||
    /^o\s+que\s+([eé]|eh)(\s+isso)?\??$/i.test(t) ||
    /^pra\s+qu[eê]\??$/i.test(t) ||
    /^para\s+qu[eê]\??$/i.test(t) ||
    /^que\s+a[cç][aã]o\b/i.test(t)
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
