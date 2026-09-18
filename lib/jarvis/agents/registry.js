/**
 * Specialist agents (Phase 9) — personas + Dev agent with real tools (Phase 31–60).
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
    addendum: `Agente Ops ativo: priorize registry + projetos.* (CineRush, Attracione, SocialHub, Clipper, Milhão). Ações high-risk pedem confirmação SIM/NÃO.`
  },
  dev: {
    id: 'dev',
    name: 'Dev',
    aliases: ['dev', 'debug', 'opsdebug', 'diagnostico', 'diagnóstico'],
    toolPrefixes: ['dev_'],
    addendum: `Agente Dev/Ops ativo (read-only):
- Use dev_diagnose primeiro (registry + snapshot + ultima_falha).
- Depois dev_git_status / dev_read_file / dev_railway_logs se precisar de código ou logs.
- NÃO invente logs ou diffs — só o que as tools devolverem.
- Se dev_railway_logs trouxer lines, cole as últimas linhas (não só resuma).
- NÃO emita tools de write/deploy (não existem neste agente).
- Se faltar GITHUB_TOKEN/RAILWAY_TOKEN, diga o que falta setar.`
  },
  research: {
    id: 'research',
    name: 'Pesquisa',
    aliases: ['pesquisa', 'research', 'analise', 'análise'],
    addendum: `Agente Pesquisa ativo: modo análise — prefira acoes:[]; explique com dados do contexto; só emita tools se o usuário pedir explicitamente pra alterar. (Web tools ainda não wired — use contexto/briefs.)`
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
    aliases: a.aliases,
    toolPrefixes: a.toolPrefixes || []
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
  m = t.match(
    /^\/(finance|ops|dev|debug|research|rotina|financeiro|pesquisa|diagnostico)\s*(.*)$/i
  );
  if (m) {
    const map = {
      finance: 'finance',
      financeiro: 'finance',
      ops: 'ops',
      dev: 'dev',
      debug: 'dev',
      diagnostico: 'dev',
      research: 'research',
      pesquisa: 'research',
      rotina: 'rotina'
    };
    return { agentId: map[m[1].toLowerCase()] || 'default', rest: (m[2] || '').trim() };
  }
  return null;
}

function looksLikeDevRequest(mensagem) {
  const t = String(mensagem || '');
  return (
    /\b(debug|diagn[oó]stic|tail\s*log|railway\s*log|git\s*status|stack\s*trace|traceback)\b/i.test(
      t
    ) ||
    /\b(t[aá]\s+quebr|est[aá]\s+quebr|n[aã]o\s+sobe|crash|exception|deploy\s+fail|falhou\s+o\s+deploy)\b/i.test(
      t
    ) ||
    /\b(l[eê]\s+o\s+arquivo|abre\s+o\s+arquivo|mostra\s+o\s+c[oó]digo)\b/i.test(t)
  );
}

function pickAgentForMessage(mensagem) {
  const explicit = parseAgentCommand(mensagem);
  if (explicit) {
    return {
      agent: getAgent(explicit.agentId),
      message: explicit.rest || mensagem,
      explicit: true
    };
  }

  if (looksLikeDevRequest(mensagem)) {
    return { agent: getAgent('dev'), message: mensagem, explicit: false };
  }

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
  pickAgentForMessage,
  looksLikeDevRequest
};
