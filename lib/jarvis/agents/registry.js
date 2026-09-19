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
- Debug/diagnóstico/logs/git/patch/PR → tools dev_*
- Pesquisa/web/concorrentes → research_* (resposta curta)
- Imagem/banner/arte → creative_generate_image (prompt claro)
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
    aliases: ['dev', 'debug', 'opsdebug', 'diagnostico', 'diagnóstico', 'coding', 'code'],
    toolPrefixes: ['dev_'],
    addendum: `Agente Dev/Coding ativo:
- Diagnóstico: dev_diagnose → git_status / read_file / railway_logs.
- Código: dev_read_file → SEMPRE o conteúdo vem no texto da tool (cole no WA). Depois propose_patch (path+content OU files[]) → apply/PR (HITL).
- Testes locais: dev_run_tests (script allowlist test/smoke/check/lint) — precisa PROJETOS_ROOT.
- Diff sujo: dev_git_diff (só com disco local).
- Railway write: redeploy/restart — critical, SIM.
- NÃO invente diffs — só o que as tools devolverem.
- Em patch: passe content = arquivo completo; path allowlist (sem .env).
- Sem PROJETOS_ROOT no host → preferir dev_github_pr.
- Se faltar GITHUB_TOKEN/RAILWAY_TOKEN, diga o que falta.`
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
    /\b(debug|diagn[oó]stic\w*|tail\s*log|railway\s*log|git\s*status|git\s*diff|stack\s*trace|traceback)\b/i.test(
      t
    ) ||
    /\b(re\s*-?deploy|redeploy|restart|reinicia(r)?\s+(o\s+)?(deploy|railway|container|service|app))\b/i.test(
      t
    ) ||
    /\b(t[aá]\s+quebr|est[aá]\s+quebr|n[aã]o\s+sobe|crash|exception|deploy\s+fail|falhou\s+o\s+deploy)\b/i.test(
      t
    ) ||
    /\b(l[eê]\s+o\s+arquivo|abre\s+o\s+arquivo|mostra\s+o\s+c[oó]digo)\b/i.test(t) ||
    /\b(patch|aplica\s+patch|abre\s+(um\s+)?pr|pull\s*request|implementa|corrige\s+o\s+c[oó]digo|refatora|roda\s+(os\s+)?testes|npm\s+test)\b/i.test(
      t
    )
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
