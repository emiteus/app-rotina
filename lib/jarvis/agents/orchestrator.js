/**
 * Orchestrator (Gap Map #9) — escolhe agent(s) por intent; hint multi-braço.
 * Não substitui missões explícitas; emite plano tipado quando o pedido mistura braços.
 */
const {
  AGENTS,
  getAgent,
  parseAgentCommand,
  looksLikeDevRequest,
  looksLikeResearchRequest
} = require('./registry');
const { detectIntent } = require('../context/intent');

/**
 * @typedef {{ agentId: string, message: string, explicit: boolean, reason: string, agents?: string[], hint?: string, suggestMission?: boolean }} Route
 */

function looksLikeMissionWorthy(mensagem) {
  const t = String(mensagem || '');
  return (
    /\be\s+(depois|também|tb)\b/i.test(t) ||
    /\bdepois\s+(disso|disso,)\b/i.test(t) ||
    (looksLikeDevRequest(t) && looksLikeResearchRequest(t)) ||
    /\b(sincroniz.*reconcili|diagnost.*log|pesquisa.*diagnost|diagnost.*pesquisa)\b/i.test(t)
  );
}

/**
 * Roteia o turno: 1 agent principal + hint opcional pro system prompt.
 * @returns {Route}
 */
function routeTurn(mensagem) {
  const raw = String(mensagem || '').trim();
  const explicit = parseAgentCommand(raw);
  if (explicit) {
    return {
      agentId: explicit.agentId,
      message: explicit.rest || raw,
      explicit: true,
      reason: 'explicit',
      agents: [explicit.agentId],
      hint: ''
    };
  }

  const wantsDev = looksLikeDevRequest(raw);
  const wantsResearch = looksLikeResearchRequest(raw);
  const multi = looksLikeMissionWorthy(raw);

  if (wantsDev && wantsResearch) {
    return {
      agentId: 'default',
      message: raw,
      explicit: false,
      reason: 'multi_dev_research',
      agents: ['research', 'dev'],
      suggestMission: true,
      hint: `ORQUESTRADOR (pedido misto):
1) research_web_search + research_write_report (curto)
2) se pediu diagnóstico/logs: dev_diagnose (+ dev_railway_logs se pedir log)
Não invente dados. Resposta curta.`
    };
  }

  if (wantsDev) {
    return {
      agentId: 'dev',
      message: raw,
      explicit: false,
      reason: 'dev',
      agents: ['dev'],
      hint: ''
    };
  }

  if (wantsResearch) {
    return {
      agentId: 'research',
      message: raw,
      explicit: false,
      reason: 'research',
      agents: ['research'],
      hint: ''
    };
  }

  const intent = detectIntent(raw);
  if (intent.kind === 'finance') {
    return {
      agentId: 'finance',
      message: raw,
      explicit: false,
      reason: 'finance',
      agents: ['finance'],
      hint: ''
    };
  }
  if (intent.kind === 'projects') {
    return {
      agentId: 'ops',
      message: raw,
      explicit: false,
      reason: 'ops',
      agents: ['ops'],
      hint: multi
        ? `ORQUESTRADOR: pedido de ops/projetos. Prefira tools do projeto citado. Se for multi-passo, emita as tools em sequência.`
        : ''
    };
  }
  if (intent.kind === 'tasks' || intent.kind === 'habits') {
    return {
      agentId: 'rotina',
      message: raw,
      explicit: false,
      reason: intent.kind,
      agents: ['rotina'],
      hint: ''
    };
  }

  return {
    agentId: 'default',
    message: raw,
    explicit: false,
    reason: intent.kind || 'default',
    agents: ['default'],
    hint:
      intent.kind === 'status'
        ? `ORQUESTRADOR: status geral — use registry + pack; não invente ON/off.`
        : `ORQUESTRADOR: se for debug/diagnóstico → tools dev_*; se pesquisa/web → research_*; se finanças → tools financeiras; se multi-passo claro → emita várias tools na ordem.`
  };
}

function pickAgentViaOrchestrator(mensagem) {
  const route = routeTurn(mensagem);
  return {
    agent: getAgent(route.agentId),
    message: route.message,
    explicit: route.explicit,
    route
  };
}

module.exports = {
  routeTurn,
  pickAgentViaOrchestrator,
  looksLikeMissionWorthy,
  AGENTS
};
