/**
 * Orchestrator (Gap Map #9) — escolhe agent(s) por intent; auto-missão tipada quando cabe.
 * Landing / pedidos mistos → suggestMission ou autoMission (host cria board).
 */
const {
  AGENTS,
  getAgent,
  parseAgentCommand,
  looksLikeDevRequest,
  looksLikeResearchRequest,
  looksLikeBrowserRequest,
  looksLikeCreativeRequest
} = require('./registry');
const { detectIntent } = require('../context/intent');

function looksLikeLandingPrep(mensagem) {
  const g = String(mensagem || '');
  // Pedido de landing é curto e direto ("prepara a landing do cutflix"). Texto longo que só cita
  // "página de vendas" (ex.: roteiro pro afiliado, 22/09/2026) não é pedido de missão.
  if (g.length > 220) return false;
  return (
    /\b(prepara|preparar|cria|criar|monta|montar|faz|fazer)\b.{0,48}\b(landing|lp\b|p[aá]gina\s+de\s+vendas|sales\s+page)\b/i.test(
      g
    ) ||
    /\blanding\s+(page|pra|para|do|da|de)\b/i.test(g) ||
    /\bmiss[aã]o\s*[:\-]?\s*.{0,40}\blanding\b/i.test(g)
  );
}

/**
 * @typedef {{ agentId: string, message: string, explicit: boolean, reason: string, agents?: string[], hint?: string, suggestMission?: boolean, autoMission?: boolean }} Route
 */

function formatRouteNudge(route) {
  if (!route) return '';
  if (route.autoMission) {
    return (
      '\n\n_Orquestrador: missão tipada aberta — manda **mete marcha** pra rodar os passos._'
    );
  }
  if (!route.suggestMission) return '';
  return (
    '\n\n_Pedido misto — se preferir passos tipados: **missão: ' +
    String(route.message || '').slice(0, 80) +
    '**_'
  );
}

function looksLikeMissionWorthy(mensagem) {
  const t = String(mensagem || '');
  return (
    looksLikeLandingPrep(t) ||
    /\be\s+(depois|também|tb)\b/i.test(t) ||
    /\bdepois\s+(disso|disso,)\b/i.test(t) ||
    (looksLikeDevRequest(t) && looksLikeResearchRequest(t)) ||
    /\b(sincroniz.*reconcili|diagnost.*log|pesquisa.*diagnost|diagnost.*pesquisa)\b/i.test(t)
  );
}

function looksLikeResearchWords(mensagem) {
  return /\b(pesquis|pesquisa|research|concorrent|benchmark|relat[oó]rio|fontes?|busc[ae]\s+na\s+web|o\s+que\s+[eé]\s+)\b/i.test(
    String(mensagem || '')
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

  // Gap #9 — prepara landing → auto-missão (research → copy → …)
  if (looksLikeLandingPrep(raw)) {
    return {
      agentId: 'research',
      message: raw,
      explicit: false,
      reason: 'landing_prep',
      agents: ['research', 'creative', 'browser'],
      suggestMission: true,
      autoMission: true,
      hint: `ORQUESTRADOR (landing):
1) research_web_search (refs/concorrentes)
2) creative_landing_copy (outline hero+seções a partir do brief)
3) creative_generate_image se pediu banner/imagem
4) browser_open se o projeto tem URL
5) dev_deploy_checklist
Missão tipada — não invente copy fora da tool.`
    };
  }

  const wantsDev = looksLikeDevRequest(raw);
  const wantsBrowser = looksLikeBrowserRequest(raw);
  const wantsResearch = looksLikeResearchWords(raw) && !wantsBrowser;
  const multi = looksLikeMissionWorthy(raw) || (wantsDev && wantsResearch);

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
3) se pediu redeploy: dev_railway_redeploy; restart: dev_railway_restart (critical → SIM)
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

  if (wantsBrowser) {
    return {
      agentId: 'browser',
      message: raw,
      explicit: false,
      reason: 'browser',
      agents: ['browser'],
      hint: ''
    };
  }

  if (looksLikeCreativeRequest(raw)) {
    return {
      agentId: 'creative',
      message: raw,
      explicit: false,
      reason: 'creative',
      agents: ['creative'],
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
  looksLikeLandingPrep,
  formatRouteNudge,
  AGENTS
};
