/**
 * Specialist agents (Phase 9) — prompt personas under the same Core/tools.
 */
const { detectIntent } = require('../context/intent');

const AGENTS = {
  default: {
    id: 'default',
    name: 'Jarvis',
    aliases: ['jarvis'],
    addendum: ''
  },
  finance: {
    id: 'finance',
    name: 'Financeiro',
    aliases: ['financeiro', 'finance', 'grana', 'dinheiro'],
    addendum: `Agente Financeiro ativo: priorize despesas_mes, receitas_mes, financeiro.*, plano_financeiro, metas. Seja preciso com R$. Não invente saldos.`
  },
  ops: {
    id: 'ops',
    name: 'Ops',
    aliases: ['ops', 'projetos', 'operações', 'operacoes'],
    addendum: `Agente Ops ativo: priorize registry + projetos.* (CineRush, Attracione, SocialHub, Clipper). Ações high-risk pedem confirmação SIM/NÃO.`
  },
  research: {
    id: 'research',
    name: 'Pesquisa',
    aliases: ['pesquisa', 'research', 'analise', 'análise'],
    addendum: `Agente Pesquisa ativo: modo análise — prefira acoes:[]; explique com dados do contexto; só emita tools se o usuário pedir explicitamente pra alterar.`
  },
  rotina: {
    id: 'rotina',
    name: 'Rotina',
    aliases: ['rotina', 'tarefas', 'habitos', 'hábitos'],
    addendum: `Agente Rotina ativo: priorize tarefas, hábitos, eventos, alarmes, recorrentes. Seja curto e acionável.`
  }
};

function listAgents() {
  return Object.values(AGENTS).map((a) => ({
    id: a.id,
    name: a.name,
    aliases: a.aliases
  }));
}

function getAgent(id) {
  return AGENTS[id] || AGENTS.default;
}

/** Explicit "agente X:" or "/ops" style */
function parseAgentCommand(mensagem) {
  const t = String(mensagem || '').trim();
  let m = t.match(/^(?:agente|agent|modo)\s+(\w+)\s*[:\-]?\s*(.*)$/i);
  if (m) {
    const key = m[1].toLowerCase();
    for (const a of Object.values(AGENTS)) {
      if (a.id === key || a.aliases.includes(key)) {
        return { agentId: a.id, rest: (m[2] || '').trim() };
      }
    }
  }
  m = t.match(/^\/(finance|ops|research|rotina|financeiro|pesquisa)\s*(.*)$/i);
  if (m) {
    const map = {
      finance: 'finance',
      financeiro: 'finance',
      ops: 'ops',
      research: 'research',
      pesquisa: 'research',
      rotina: 'rotina'
    };
    return { agentId: map[m[1].toLowerCase()] || 'default', rest: (m[2] || '').trim() };
  }
  return null;
}

function pickAgentForMessage(mensagem) {
  const explicit = parseAgentCommand(mensagem);
  if (explicit) return { agent: getAgent(explicit.agentId), message: explicit.rest || mensagem, explicit: true };

  const intent = detectIntent(mensagem);
  if (intent.kind === 'finance') return { agent: getAgent('finance'), message: mensagem, explicit: false };
  if (intent.kind === 'projects') return { agent: getAgent('ops'), message: mensagem, explicit: false };
  if (intent.kind === 'tasks' || intent.kind === 'habits') {
    return { agent: getAgent('rotina'), message: mensagem, explicit: false };
  }
  if (intent.kind === 'status') return { agent: getAgent('default'), message: mensagem, explicit: false };
  return { agent: getAgent('default'), message: mensagem, explicit: false };
}

module.exports = {
  AGENTS,
  listAgents,
  getAgent,
  parseAgentCommand,
  pickAgentForMessage
};
