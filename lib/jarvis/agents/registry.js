/**
 * Specialist agents (Phase 9) — personas + Dev/Research tools.
 * Routing: agents/orchestrator.js
 */
const AGENTS = {
  default: {
    id: 'default',
    name: 'Jarvis',
    aliases: ['jarvis'],
    addendum: `Orchestrator ativo: escolha o braço certo.
- Debug/diagnóstico/logs/git → tools dev_*
- Pesquisa/web/concorrentes → research_* (resposta curta)
- Finanças → tools financeiras; rotina → tarefas/hábitos; projetos → ops
- Pedido misto → várias tools na ordem, sem inventar dados.`
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
- Se lines.length > 0, NÃO diga que os logs vieram vazios.
- NÃO emita tools de write/deploy (não existem neste agente).
- Se faltar GITHUB_TOKEN/RAILWAY_TOKEN, diga o que falta setar.`
  },
  research: {
    id: 'research',
    name: 'Pesquisa',
    aliases: ['pesquisa', 'research', 'analise', 'análise'],
    toolPrefixes: ['research_'],
    addendum: `Agente Pesquisa ativo:
- Use research_web_search; opcional research_fetch_url; feche com research_write_report.
- Resposta CURTA por padrão (máx ~8 linhas / 5 bullets). Sem lista enorme de fontes.
- Só inclua links/fontes se o usuário pedir ("fontes", "links", "detalha", "completo").
- NÃO invente nomes/URLs — só o que as tools devolverem.
- NÃO emita tools de write financeiro/deploy.`
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
    /\b(debug|diagn[oó]stic\w*|tail\s*log|railway\s*log|git\s*status|stack\s*trace|traceback)\b/i.test(
      t
    ) ||
    /\b(t[aá]\s+quebr|est[aá]\s+quebr|n[aã]o\s+sobe|crash|exception|deploy\s+fail|falhou\s+o\s+deploy)\b/i.test(
      t
    ) ||
    /\b(l[eê]\s+o\s+arquivo|abre\s+o\s+arquivo|mostra\s+o\s+c[oó]digo)\b/i.test(t)
  );
}

function looksLikeResearchRequest(mensagem) {
  const t = String(mensagem || '');
  return (
    /\b(pesquis|pesquisa|research|concorrent|benchmark|relat[oó]rio|fontes?|busc[ae]\s+na\s+web|o\s+que\s+[eé]\s+)\b/i.test(
      t
    ) &&
    !looksLikeDevRequest(t)
  );
}

function pickAgentForMessage(mensagem) {
  const { pickAgentViaOrchestrator } = require('./orchestrator');
  return pickAgentViaOrchestrator(mensagem);
}

module.exports = {
  AGENTS,
  listAgents,
  getAgent,
  parseAgentCommand,
  pickAgentForMessage,
  looksLikeDevRequest,
  looksLikeResearchRequest
};
