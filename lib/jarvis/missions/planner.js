/**
 * Mission planner + runner (Phase 7 → v2 wrap) — single-agent, tool-backed steps.
 */
const {
  createMission,
  getActiveMission,
  getMission,
  updateMission,
  cancelMission,
  listMissions
} = require('./store');
const { hasTool, listToolNames } = require('../tools/registry');

/** Resolve project id from free text (launch / landing / diagnose). */
function resolveProjectFromText(g) {
  const t = String(g || '');
  if (/milh/i.test(t)) return 'projeto_milhao';
  if (/cinerush|cine\s*rush/i.test(t)) return 'cinerush';
  if (/socialhub|teushub/i.test(t)) return 'socialhub';
  if (/attracione|attra/i.test(t)) return 'attracione';
  if (/cutflix/i.test(t)) return 'cutflix';
  if (/jarvis/i.test(t)) return 'jarvis';
  if (/framerush|frame\s*rush/i.test(t)) return 'framerush';
  return 'approtina';
}

function researchQueryFromBrief(project, fallback) {
  let researchQuery = String(fallback || project).slice(0, 160);
  try {
    const { getBrief } = require('../projects/briefs');
    const b = getBrief(project);
    if (b) {
      const host = (b.urls || [])
        .map((u) => {
          try {
            return new URL(u).hostname.replace(/^www\./, '');
          } catch (_) {
            return null;
          }
        })
        .find(Boolean);
      const gist = String(b.brief || '')
        .replace(/\bJarvis hoje:[^.]*\.?/gi, '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, host ? 90 : 110);
      researchQuery = [b.name || project, host, gist, 'landing page SaaS']
        .filter(Boolean)
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 160);
    }
  } catch (_) {
    /* brief opcional */
  }
  return researchQuery;
}

function looksLikeLandingPrep(goal) {
  const g = String(goal || '');
  return (
    /\b(prepara|preparar|cria|criar|monta|montar|faz|fazer)\b.{0,48}\b(landing|lp\b|p[aá]gina\s+de\s+vendas|sales\s+page)\b/i.test(
      g
    ) ||
    /\blanding\s+(page|pra|para|do|da|de)\b/i.test(g) ||
    /\bmiss[aã]o\s*[:\-]?\s*.{0,40}\blanding\b/i.test(g)
  );
}

/**
 * Tipa e limpa steps: kind tool|info; drop tipos inválidos; args só o necessário.
 */
function normalizeSteps(steps) {
  const out = [];
  for (const s of steps || []) {
    let tipo = s && s.tipo ? String(s.tipo).trim() : null;
    if (tipo && !hasTool(tipo)) tipo = null;
    const raw =
      s && typeof s.args === 'object' && s.args && !Array.isArray(s.args)
        ? { ...s.args }
        : {};
    // Lixo de planner LLM
    delete raw.description;
    delete raw.kind;
    delete raw.status;
    delete raw.result;
    delete raw.i;
    if (tipo) raw.tipo = tipo;
    else delete raw.tipo;
    out.push({
      description: String(s.description || tipo || 'passo').slice(0, 160),
      tipo,
      kind: tipo ? 'tool' : 'info',
      args: raw
    });
  }
  return out;
}

/**
 * Heuristic plan from natural language goal.
 * @returns {{ description: string, tipo: string|null, args: object }[]}
 */
function planFromGoal(goal) {
  const g = String(goal || '').trim();
  const steps = [];

  if (/sincroniz.*banco|pluggy|extrato/i.test(g)) {
    steps.push({
      description: 'Sincronizar bancos (Open Finance)',
      tipo: 'sincronizar_bancos',
      args: { tipo: 'sincronizar_bancos' }
    });
  }
  if (/reconcili/i.test(g)) {
    steps.push({
      description: 'Reconciliar despesas com extrato',
      tipo: 'reconciliar_despesas',
      args: { tipo: 'reconciliar_despesas' }
    });
  }
  if (/coleta|attracione/i.test(g)) {
    steps.push({
      description: 'Disparar coleta Attracione',
      tipo: 'attracione_coleta',
      args: { tipo: 'attracione_coleta' }
    });
  }
  if (/backup.*attracione|attracione.*backup/i.test(g)) {
    steps.push({
      description: 'Backup Attracione',
      tipo: 'attracione_backup',
      args: { tipo: 'attracione_backup' }
    });
  }
  if (/publicar.*agend|socialhub.*public/i.test(g)) {
    steps.push({
      description: 'Publicar posts agendados SocialHub',
      tipo: 'socialhub_publicar_agendados',
      args: { tipo: 'socialhub_publicar_agendados' }
    });
  }
  if (/academia|h[aá]bito/i.test(g) && /marcar|check/i.test(g)) {
    steps.push({
      description: 'Marcar Academia',
      tipo: 'marcar_habito',
      args: { tipo: 'marcar_habito', titulo: 'Academia' }
    });
  }
  if (/snapshot|atualiza.*cache|cache.*fresco/i.test(g)) {
    steps.push({
      description: 'Atualizar cache de snapshots',
      tipo: 'snapshot_refresh',
      args: { tipo: 'snapshot_refresh' }
    });
  }
  if (/fechamento.*milh|milh[aã]o.*fechamento/i.test(g)) {
    steps.push({
      description: 'Consultar fechamento Projeto Milhão',
      tipo: 'projeto_milhao_fechamento',
      args: { tipo: 'projeto_milhao_fechamento' }
    });
  }
  if (
    /\b(diagn[oó]stic|debug|investig|por\s+que\s+(quebr|falh)|t[aá]\s+quebr)/i.test(g)
  ) {
    let project = 'approtina';
    if (/milh/i.test(g)) project = 'projeto_milhao';
    else if (/cinerush|cine\s*rush/i.test(g)) project = 'cinerush';
    else if (/socialhub|teushub/i.test(g)) project = 'socialhub';
    else if (/attracione|attra/i.test(g)) project = 'attracione';
    else if (/jarvis/i.test(g)) project = 'jarvis';
    steps.push({
      description: `Diagnóstico Dev (${project})`,
      tipo: 'dev_diagnose',
      args: { tipo: 'dev_diagnose', project }
    });
    steps.push({
      description: `Git/commits recentes (${project})`,
      tipo: 'dev_git_status',
      args: { tipo: 'dev_git_status', project }
    });
    if (/log/i.test(g) || /railway/i.test(g) || /deploy/i.test(g)) {
      steps.push({
        description: `Logs Railway (${project})`,
        tipo: 'dev_railway_logs',
        args: { tipo: 'dev_railway_logs', project }
      });
    }
  }
  if (
    /\b(restart|reinicia(r)?(\s+(o|a))?\s+(deploy|railway|container|service|app|milh)|reinicia(r)?\s+o?\s*milh)\b/i.test(
      g
    ) ||
    (/\breinici/i.test(g) && !/\bre\s*-?deploy|redeploy/i.test(g))
  ) {
    let project = 'approtina';
    if (/milh/i.test(g)) project = 'projeto_milhao';
    else if (/cinerush|cine\s*rush/i.test(g)) project = 'cinerush';
    else if (/socialhub|teushub/i.test(g)) project = 'socialhub';
    else if (/attracione|attra/i.test(g)) project = 'attracione';
    steps.push({
      description: `Restart Railway (${project}) — HITL`,
      tipo: 'dev_railway_restart',
      args: { tipo: 'dev_railway_restart', project }
    });
  } else if (/\b(re\s*-?deploy|redeploy)\b/i.test(g)) {
    let project = 'approtina';
    if (/milh/i.test(g)) project = 'projeto_milhao';
    else if (/cinerush|cine\s*rush/i.test(g)) project = 'cinerush';
    else if (/socialhub|teushub/i.test(g)) project = 'socialhub';
    else if (/attracione|attra/i.test(g)) project = 'attracione';
    steps.push({
      description: `Redeploy Railway (${project}) — HITL`,
      tipo: 'dev_railway_redeploy',
      args: { tipo: 'dev_railway_redeploy', project }
    });
  }
  if (
    /\b(patch|corrige|implementa|refatora|abre\s+(um\s+)?pr|pull\s*request)\b/i.test(g) &&
    !/\bredeploy|restart/i.test(g)
  ) {
    let project = 'approtina';
    if (/milh/i.test(g)) project = 'projeto_milhao';
    else if (/cinerush|cine\s*rush/i.test(g)) project = 'cinerush';
    else if (/socialhub|teushub/i.test(g)) project = 'socialhub';
    else if (/attracione|attra/i.test(g)) project = 'attracione';
    else if (/jarvis/i.test(g)) project = 'jarvis';
    steps.push({
      description: `Git status (${project}) antes do patch`,
      tipo: 'dev_git_status',
      args: { tipo: 'dev_git_status', project }
    });
  }
  if (
    /\b(pesquis|pesquisa|research|concorrent|benchmark|relat[oó]rio\s+(sobre|de|pra))\b/i.test(
      g
    )
  ) {
    const query = g
      .replace(
        /^(miss[aã]o|mission|agente\s+pesquisa|agente\s+research)\s*[:\-]?\s*/i,
        ''
      )
      .slice(0, 200);
    steps.push({
      description: `Busca web: ${query.slice(0, 80)}`,
      tipo: 'research_web_search',
      args: { tipo: 'research_web_search', query, limit: 6 }
    });
    // fetch/report ficam pro agente (precisa das URLs da busca)
  }

  // Missão "lançar produto" — stub connection-first
  if (
    /\b(lan[cç]ar|lan[cç]a|ship|release)\s+(o\s+|um\s+|a\s+)?(produto|feature|app|projeto)\b/i.test(
      g
    ) ||
    /\bmiss[aã]o\s*[:\-]?\s*lan[cç]ar\b/i.test(g)
  ) {
    const project = resolveProjectFromText(g);
    const topic = g
      .replace(/^(miss[aã]o|mission)\s*[:\-]?\s*/i, '')
      .replace(/\b(lan[cç]ar|lan[cç]a|ship|release)\s+(o\s+|um\s+|a\s+)?(produto|feature|app|projeto)\b/i, '')
      .trim()
      .slice(0, 120) || project;
    const researchQuery = researchQueryFromBrief(project, `lançar produto ${topic}`);
    steps.push({
      description: `Research mercado/contexto: ${topic.slice(0, 60)}`,
      tipo: 'research_web_search',
      args: {
        tipo: 'research_web_search',
        query: researchQuery,
        limit: 5
      }
    });
    steps.push({
      description: `Diagnóstico Dev (${project})`,
      tipo: 'dev_diagnose',
      args: { tipo: 'dev_diagnose', project }
    });
    steps.push({
      description: `Git status (${project})`,
      tipo: 'dev_git_status',
      args: { tipo: 'dev_git_status', project }
    });
    steps.push({
      description: `Checklist deploy pós-código (${project})`,
      tipo: 'dev_deploy_checklist',
      args: { tipo: 'dev_deploy_checklist', project }
    });
  }

  // Gap #9 — "prepara landing" → research → copy stub → (visual) → browser → checklist
  if (!steps.length && looksLikeLandingPrep(g)) {
    const project = resolveProjectFromText(g);
    const topic = g
      .replace(/^(miss[aã]o|mission)\s*[:\-]?\s*/i, '')
      .replace(/\b(prepara|preparar|cria|criar|monta|montar|faz|fazer)\b/gi, '')
      .replace(/\b(landing|lp|p[aá]gina\s+de\s+vendas|sales\s+page)\b/gi, '')
      .trim()
      .slice(0, 100) || project;
    const researchQuery = researchQueryFromBrief(
      project,
      `${topic} landing page competitors hero copy`
    );
    steps.push({
      description: `Research refs/concorrentes: ${topic.slice(0, 50)}`,
      tipo: 'research_web_search',
      args: { tipo: 'research_web_search', query: researchQuery, limit: 5 }
    });
    steps.push({
      description: `Outline copy/hero (${project})`,
      tipo: null,
      args: {
        tipo: null,
        note: `Stub copy: headline + sub + CTA pra ${project}. Refine no próximo turno.`
      }
    });
    if (/\b(banner|imagem|hero|visual|arte|gera)\b/i.test(g)) {
      steps.push({
        description: `Hero/banner visual (${project})`,
        tipo: 'creative_generate_image',
        args: {
          tipo: 'creative_generate_image',
          prompt: `Landing hero banner for ${topic || project}, clean SaaS product marketing, no text overload`
        }
      });
    }
    let siteUrl = null;
    try {
      const { getBrief } = require('../projects/briefs');
      const b = getBrief(project);
      siteUrl = b && b.urls && b.urls[0] ? b.urls[0] : null;
    } catch (_) {
      /* ignore */
    }
    if (siteUrl) {
      steps.push({
        description: `Snapshot site atual (${project})`,
        tipo: 'browser_open',
        args: { tipo: 'browser_open', url: siteUrl }
      });
    }
    steps.push({
      description: `Checklist deploy (${project})`,
      tipo: 'dev_deploy_checklist',
      args: { tipo: 'dev_deploy_checklist', project }
    });
  }

  if (!steps.length) {
    steps.push({
      description: `Objetivo livre: ${g.slice(0, 120)}`,
      tipo: null,
      args: { tipo: null, note: g }
    });
  }
  return normalizeSteps(steps);
}

function isOnlyFreeStep(steps) {
  return Array.isArray(steps) && steps.length === 1 && !steps[0].tipo;
}

async function failuresHintForGoal(userId, goal) {
  try {
    const { loadMemoriesForMessage } = require('../memory/projects');
    const mems = await loadMemoriesForMessage(userId, goal, { limit: 6 });
    const fails = (mems || [])
      .map((m) => m.ultima_falha)
      .filter(Boolean)
      .slice(0, 3);
    if (!fails.length) return '';
    return (
      `\nÚltimas falhas conhecidas (NÃO repita o mesmo erro cego — ajuste args ou avise):\n` +
      fails.map((f) => `- ${f}`).join('\n')
    );
  } catch {
    return '';
  }
}

/**
 * LLM planner when heuristics don't match known tool sequences.
 */
async function planFromGoalLLM(goal, { userId = null } = {}) {
  if (process.env.JARVIS_LLM_PLANNER === '0') return null;
  const { chamarIA } = require('../ai-gateway');
  const tools = listToolNames().join(', ');
  const failHint = userId ? await failuresHintForGoal(userId, goal) : '';
  const { texto } = await chamarIA({
    system: `Você é o planner do Jarvis. Dado um objetivo, devolva APENAS JSON:
{"steps":[{"description":"texto curto","tipo":"nome_da_tool_ou_null","args":{}}]}
Regras:
- Máximo 5 steps
- "tipo" deve ser uma destas tools ou null: ${tools}
- args deve incluir "tipo" igual ao campo tipo quando houver tool
- Prefira tools reais; use tipo null só se for passo informativo
- Se o objetivo pede ação de ops/finanças, NÃO devolva só um passo null
- Português brasileiro nas descriptions${failHint}`,
    user: String(goal || '').slice(0, 500),
    maxTokens: 700,
    jsonMode: true,
    timeout: 22000
  });
  let parsed = null;
  try {
    parsed = JSON.parse(
      String(texto || '')
        .replace(/^```(?:json)?\s*/i, '')
        .replace(/\s*```$/, '')
        .trim()
    );
  } catch {
    return null;
  }
  const raw = Array.isArray(parsed?.steps) ? parsed.steps : [];
  const out = normalizeSteps(
    raw.slice(0, 5).map((s) => ({
      description: s.description,
      tipo: s.tipo,
      args: s.args
    }))
  );
  console.log(
    JSON.stringify({
      tag: 'jarvis.mission',
      event: 'llm_plan',
      steps: out.length,
      tipos: out.map((x) => x.tipo),
      kinds: out.map((x) => x.kind)
    })
  );
  return out.length ? out : null;
}

/**
 * Create mission from goal (heuristic, then LLM if needed).
 */
async function startMission(userId, goal) {
  let steps = planFromGoal(goal);
  if (isOnlyFreeStep(steps)) {
    try {
      const llm = await planFromGoalLLM(goal, { userId });
      if (llm && llm.length) steps = llm;
    } catch (e) {
      console.log(
        JSON.stringify({
          tag: 'jarvis.mission',
          event: 'llm_plan_fail',
          error: e.message
        })
      );
    }
  }
  steps = normalizeSteps(steps);
  return createMission(userId, goal, steps);
}

/**
 * Parse mission-related user commands.
 * @returns {null | { cmd: string, goal?: string, id?: string }}
 */
function parseMissionCommand(mensagem) {
  const t = String(mensagem || '').trim();

  let m = t.match(/^(?:miss[aã]o|plano|mission)\s*[:\-]\s*(.+)$/i);
  if (m) return { cmd: 'create', goal: m[1].trim() };

  m = t.match(/^(?:cria|criar|abre|abrir)\s+(?:uma\s+)?(?:miss[aã]o|plano)\s+(?:pra|para|de|:)\s*(.+)$/i);
  if (m) return { cmd: 'create', goal: m[1].trim() };

  if (/^(status\s+miss[aã]o|miss[aã]o\s+status|qual\s+miss[aã]o)\s*[?.!]*$/i.test(t)) {
    return { cmd: 'status' };
  }
  if (/^(lista|listar)\s+miss[oõ]es\s*[?.!]*$/i.test(t)) {
    return { cmd: 'list' };
  }
  if (/^(cancela|cancelar|aborta)\s+(a\s+)?miss[aã]o(?:\s+([a-f0-9]{6,12}))?\s*[!.]*$/i.test(t)) {
    const id = t.match(/([a-f0-9]{6,12})\s*$/i);
    return { cmd: 'cancel', id: id ? id[1] : null };
  }
  // "mete marcha" / "mete marcha na missão" = batch (não 1 passo)
  if (
    /^(mete\s+marcha(\s+(n[oa]\s+)?(tudo|batch|miss[aã]o))?|executa\s+miss[aã]o|roda\s+tudo|completa\s+miss[aã]o|run\s+mission|executar\s+miss[aã]o)(?:\s+([a-f0-9]{6,12}))?\s*[!.]*$/i.test(
      t
    )
  ) {
    const id = t.match(/([a-f0-9]{6,12})\s*$/i);
    return { cmd: 'run_all', id: id ? id[1] : null };
  }
  if (
    /^(pr[oó]ximo\s+passo|pr[oó]ximo|continua(\s+miss[aã]o)?|seguir(\s+miss[aã]o)?|roda\s+miss[aã]o|avança|avancar|bora)\s*[!.]*$/i.test(
      t
    )
  ) {
    return { cmd: 'advance' };
  }
  if (
    /^(retry|repete|repetir|tenta\s+de\s+novo)\s+(passo|miss[aã]o)(?:\s+([a-f0-9]{6,12}))?\s*[!.]*$/i.test(
      t
    ) ||
    /^(retry\s+miss[aã]o|repete\s+passo)(?:\s+([a-f0-9]{6,12}))?\s*[!.]*$/i.test(t)
  ) {
    const id = t.match(/([a-f0-9]{6,12})\s*$/i);
    return { cmd: 'retry', id: id ? id[1] : null };
  }
  return null;
}

function stepMark(s, i, currentStep) {
  if (s.status === 'done') return '✓';
  if (s.status === 'failed') return '✗';
  if (s.status === 'waiting_approval') return '⏸';
  if (i === currentStep) return '→';
  return '·';
}

function formatMission(mission) {
  if (!mission) return 'Nenhuma missão ativa.';
  const steps = mission.steps || [];
  const done = steps.filter((s) => s.status === 'done').length;
  const total = steps.length;
  const lines = steps
    .map((s, i) => {
      const mark = stepMark(s, i, mission.currentStep);
      const kind = s.kind === 'info' || !s.tipo ? 'info' : 'tool';
      return (
        `${mark} ${i + 1}. ${s.description || s.tipo || '?'}` +
        (s.tipo ? ` (\`${s.tipo}\`)` : ` [${kind}]`)
      );
    })
    .join('\n');
  return (
    `Missão **${mission.id}** — **${mission.status}** · progresso **${done}/${total}**\n` +
    `Objetivo: ${mission.goal}\n` +
    `${lines}\n` +
    (mission.status === 'planned' || mission.status === 'running'
      ? '\nManda **próximo passo** ou **executa missão** (ações high-risk pedem SIM).'
      : mission.status === 'waiting_approval'
        ? '\nAguardando **SIM** — continuo automaticamente depois.'
        : mission.status === 'failed'
          ? '\nManda **retry passo** pra reabrir o passo falho.'
          : '')
  );
}

/** Ping curto pro WA (não manda o board inteiro). */
function formatProgressPing(mission, idx, outcome) {
  const total = (mission && mission.steps && mission.steps.length) || '?';
  const step = mission && mission.steps && mission.steps[idx];
  const tipo = (step && step.tipo) || 'info';
  const desc = String((step && step.description) || '').slice(0, 40);
  const label =
    outcome === 'ok'
      ? 'ok'
      : outcome === 'fail'
        ? 'falhou'
        : outcome === 'hitl'
          ? 'aguardando SIM'
          : outcome === 'info'
            ? 'info'
            : outcome;
  return `Passo ${idx + 1}/${total} · ${label} · \`${tipo}\`${desc ? ` — ${desc}` : ''}`;
}

function projectIdFromToolTipo(tipo) {
  const t = String(tipo || '');
  if (t.startsWith('attracione_')) return 'attracione';
  if (t.startsWith('socialhub_')) return 'socialhub';
  if (t.startsWith('cinerush_editor_')) return 'cinerush_editor';
  if (t.startsWith('cinerush_') || t.startsWith('chatwoot_')) return 'cinerush';
  if (t.startsWith('clipper_')) return 'clipper';
  if (t.startsWith('cutflix_')) return 'cutflix';
  if (t.startsWith('projeto_milhao_')) return 'projeto_milhao';
  if (t.startsWith('dev_')) return 'jarvis';
  if (t.startsWith('research_')) return 'approtina';
  return null;
}

async function rememberMissionFailure(userId, mission, step, idx, done) {
  try {
    const { resolveProjectsFromMessage } = require('../projects/registry');
    const { upsertProjectMemory } = require('../memory/projects');
    const pids = resolveProjectsFromMessage(`${mission.goal} ${step.tipo || ''}`);
    const pid = pids[0] || projectIdFromToolTipo(step.tipo);
    if (!pid) return;
    const erro = String((done && (done.erro || done.error)) || 'falha').slice(0, 300);
    await upsertProjectMemory(userId, {
      project_id: pid,
      ultima_falha: `missão ${mission.id} passo ${idx + 1} (${step.tipo}): ${erro}`
    });
  } catch (e) {
    console.error('[jarvis.mission] ultima_falha:', e.message);
  }
}

/**
 * Execute next pending tool step.
 * @param {function} executeAcoes (acoes, userId) => Promise<results>
 */
async function advanceMission(userId, executeAcoes, missionId = null) {
  const mission = missionId
    ? await getMission(missionId, userId)
    : await getActiveMission(userId);
  if (!mission) {
    return { ok: false, resposta: 'Não há missão ativa. Crie com: missão: …' };
  }
  if (['done', 'cancelled', 'failed'].includes(mission.status)) {
    return { ok: false, resposta: formatMission(mission) };
  }

  const steps = [...mission.steps];
  let idx = steps.findIndex((s) => s.status === 'pending');
  if (idx < 0) {
    await updateMission(mission.id, userId, { status: 'done', currentStep: steps.length });
    return {
      ok: true,
      resposta: `Missão **${mission.id}** concluída.`,
      mission: await getMission(mission.id, userId),
      acoes: []
    };
  }

  const step = steps[idx];
  await updateMission(mission.id, userId, { status: 'running', currentStep: idx });

  if (!step.tipo) {
    steps[idx] = {
      ...step,
      kind: 'info',
      status: 'done',
      result: {
        note: 'Passo informativo — sem tool automática. Faça manualmente ou refine a missão.'
      }
    };
    const more = steps.some((s) => s.status === 'pending');
    await updateMission(mission.id, userId, {
      steps,
      status: more ? 'planned' : 'done',
      currentStep: more ? idx + 1 : steps.length
    });
    const mInfo = await getMission(mission.id, userId);
    return {
      ok: true,
      outcome: 'info',
      stepIndex: idx,
      resposta: formatProgressPing(mInfo, idx, 'info'),
      acoes: [],
      mission: mInfo
    };
  }

  // Gap #8 lite: avisa se a mesma tool já falhou recentemente
  let failHintLine = '';
  try {
    const hint = await failuresHintForGoal(userId, `${mission.goal} ${step.tipo}`);
    if (hint && step.tipo && hint.includes(step.tipo)) {
      failHintLine = `\n_(última falha conhecida pra \`${step.tipo}\` — ajustando/cuidado)_`;
      console.log(
        JSON.stringify({
          tag: 'jarvis.mission',
          event: 'fail_hint',
          id: mission.id,
          step: idx + 1,
          tipo: step.tipo
        })
      );
    }
  } catch (_) {
    /* ignore */
  }

  const acao = { tipo: step.tipo, ...(step.args || {}) };
  delete acao.description;

  // Exceção da tool deixaria a missão presa em "running" — vira passo failed
  let acoes;
  try {
    acoes = await executeAcoes([acao], userId);
  } catch (err) {
    const erro = String((err && err.message) || err).slice(0, 300);
    console.warn(
      JSON.stringify({
        tag: 'jarvis.mission',
        event: 'step_threw',
        id: mission.id,
        step: idx + 1,
        tipo: step.tipo,
        erro
      })
    );
    acoes = [{ tipo: step.tipo, ok: false, erro }];
  }
  const done = acoes[0] || { tipo: step.tipo, ok: false, erro: 'tool não retornou resultado' };

  if (done && done.pending_approval) {
    steps[idx] = { ...step, status: 'waiting_approval', result: done };
    await updateMission(mission.id, userId, {
      steps,
      status: 'waiting_approval',
      currentStep: idx
    });
    const mHitl = await getMission(mission.id, userId);
    return {
      ok: true,
      outcome: 'hitl',
      stepIndex: idx,
      resposta:
        `${formatProgressPing(mHitl, idx, 'hitl')}\n` +
        `Responde **SIM** — continuo a missão.` +
        failHintLine,
      acoes,
      mission: mHitl
    };
  }

  if (done && done.ok) {
    steps[idx] = { ...step, status: 'done', result: done };
    const more = steps.some((s) => s.status === 'pending');
    await updateMission(mission.id, userId, {
      steps,
      status: more ? 'planned' : 'done',
      currentStep: more ? idx + 1 : steps.length,
      result: more ? null : { ok: true }
    });
    const m2 = await getMission(mission.id, userId);
    return {
      ok: true,
      outcome: 'ok',
      stepIndex: idx,
      resposta: formatProgressPing(m2, idx, 'ok') + failHintLine,
      acoes,
      mission: m2
    };
  }

  steps[idx] = { ...step, status: 'failed', result: done };
  await updateMission(mission.id, userId, {
    steps,
    status: 'failed',
    currentStep: idx,
    result: done
  });

  await rememberMissionFailure(userId, mission, step, idx, done);

  const mFail = await getMission(mission.id, userId);
  return {
    ok: false,
    outcome: 'fail',
    stepIndex: idx,
    resposta:
      `${formatProgressPing(mFail, idx, 'fail')}: ${(done && done.erro) || 'erro'}\n` +
      `Manda **retry passo** ou **status missão**.` +
      failHintLine,
    acoes,
    mission: mFail
  };
}

/**
 * Roda passos pendentes em sequência com progresso (máx 8).
 * Para em waiting_approval / failed / done.
 * @param {(msg: string) => Promise<void>|void} [onProgress]
 */
async function runMissionBatch(userId, executeAcoes, { missionId = null, onProgress = null } = {}) {
  const leads = [];
  const allAcoes = [];
  let last = null;
  for (let i = 0; i < 8; i++) {
    last = await advanceMission(userId, executeAcoes, missionId);
    allAcoes.push(...(last.acoes || []));
    const st = last.mission && last.mission.status;
    const terminating =
      !last.ok ||
      !st ||
      ['done', 'failed', 'cancelled', 'waiting_approval'].includes(st);

    if (last.resposta) {
      leads.push(last.resposta.split('\n')[0]);
      // Ping compacto só em passos intermediários (evita bolha duplicada no fim)
      if (onProgress && !terminating) {
        try {
          await onProgress(
            formatProgressPing(
              last.mission,
              last.stepIndex != null ? last.stepIndex : i,
              last.outcome || (last.ok ? 'ok' : 'fail')
            )
          );
        } catch (_) {
          /* ignore */
        }
      }
    }

    if (terminating) break;
    missionId = last.mission.id;
  }

  const m = last && last.mission;
  const done = m && Array.isArray(m.steps)
    ? m.steps.filter((s) => s.status === 'done').length
    : 0;
  const total = m && Array.isArray(m.steps) ? m.steps.length : 0;
  const board =
    m && ['done', 'failed', 'waiting_approval'].includes(m.status)
      ? `\n\n${formatMission(m)}`
      : '';
  const summary =
    m
      ? `Missão **${m.id}** · **${done}/${total}** · **${m.status}**\n` +
        leads.map((l) => `• ${l}`).join('\n')
      : (last && last.resposta) || 'Missão sem passos.';

  return {
    ok: !!(last && last.ok),
    resposta: summary + board,
    acoes: allAcoes,
    mission: m
  };
}

/**
 * Handle mission command inside chat turn.
 * @param {(msg: string) => Promise<void>|void} [onProgress] — pings intermediários (ex.: WA)
 */
async function tryHandleMissionCommand(userId, mensagem, executeAcoes, onProgress = null) {
  const parsed = parseMissionCommand(mensagem);
  if (!parsed) return null;

  if (parsed.cmd === 'create') {
    const m = await startMission(userId, parsed.goal);
    return {
      handled: true,
      resposta: `Missão criada.\n\n${formatMission(m)}\n\nManda **próximo passo** (1) ou **mete marcha** / **executa missão** (batch).`,
      acoes: [],
      provider: 'mission'
    };
  }
  if (parsed.cmd === 'status') {
    const m = await getActiveMission(userId);
    return { handled: true, resposta: formatMission(m), acoes: [], provider: 'mission' };
  }
  if (parsed.cmd === 'list') {
    const list = await listMissions(userId, 5);
    if (!list.length) {
      return { handled: true, resposta: 'Nenhuma missão ainda.', acoes: [], provider: 'mission' };
    }
    const txt = list
      .map((m) => `• **${m.id}** [${m.status}] ${m.goal.slice(0, 60)}`)
      .join('\n');
    return { handled: true, resposta: txt, acoes: [], provider: 'mission' };
  }
  if (parsed.cmd === 'cancel') {
    const m = parsed.id
      ? await getMission(parsed.id, userId)
      : await getActiveMission(userId);
    if (!m) {
      return { handled: true, resposta: 'Nada pra cancelar.', acoes: [], provider: 'mission' };
    }
    await cancelMission(m.id, userId);
    return {
      handled: true,
      resposta: `Missão **${m.id}** cancelada.`,
      acoes: [],
      provider: 'mission'
    };
  }
  if (parsed.cmd === 'advance') {
    let mid = parsed.id || null;
    const active = mid ? null : await getActiveMission(userId);
    if (active && active.status === 'failed') {
      await retryFailedMissionStep(userId, active.id);
      mid = active.id;
    }
    const out = await advanceMission(userId, executeAcoes, mid);
    const board =
      out.mission && !['done', 'cancelled'].includes(out.mission.status)
        ? `\n\n${formatMission(out.mission)}`
        : out.mission && out.mission.status === 'done'
          ? `\n\n${formatMission(out.mission)}`
          : '';
    return {
      handled: true,
      resposta: (out.resposta || '') + board,
      acoes: out.acoes || [],
      provider: 'mission'
    };
  }
  if (parsed.cmd === 'retry') {
    const out = await retryFailedMissionStep(userId, parsed.id || null);
    return {
      handled: true,
      resposta: out.resposta,
      acoes: [],
      provider: 'mission'
    };
  }
  if (parsed.cmd === 'run_all') {
    let mid = parsed.id || null;
    const active = mid ? null : await getActiveMission(userId);
    if (active && active.status === 'failed') {
      await retryFailedMissionStep(userId, active.id);
      mid = active.id;
    }
    const out = await runMissionBatch(userId, executeAcoes, {
      missionId: mid,
      onProgress
    });
    return {
      handled: true,
      resposta: out.resposta,
      acoes: out.acoes || [],
      provider: 'mission'
    };
  }
  return null;
}

/**
 * Após SIM no HITL: marca o passo waiting_approval como done e libera a missão.
 * Retorna canAdvance=true se ainda há passos — o host deve chamar runMissionBatch.
 */
async function resumeMissionAfterApproval(userId, approvalAcoes = []) {
  const mission = await getActiveMission(userId);
  if (!mission || mission.status !== 'waiting_approval') return null;

  const steps = [...(mission.steps || [])];
  const idx = steps.findIndex((s) => s.status === 'waiting_approval');
  if (idx < 0) return null;

  const doneAcao = (approvalAcoes || []).find((a) => a && a.ok && !a.pending_approval);
  const failedAcao = (approvalAcoes || []).find((a) => a && a.ok === false && !a.pending_approval);

  if (failedAcao) {
    steps[idx] = { ...steps[idx], status: 'failed', result: failedAcao };
    await updateMission(mission.id, userId, {
      steps,
      status: 'failed',
      currentStep: idx,
      result: failedAcao
    });
    return {
      text:
        `Missão **${mission.id}** passo ${idx + 1} falhou após SIM: ${failedAcao.erro || 'erro'}.\n` +
        `Manda **retry passo** pra tentar de novo.\n\n` +
        formatMission(await getMission(mission.id, userId)),
      canAdvance: false
    };
  }

  steps[idx] = {
    ...steps[idx],
    status: 'done',
    result: doneAcao || { ok: true, note: 'aprovado via HITL' }
  };
  const more = steps.some((s) => s.status === 'pending');
  await updateMission(mission.id, userId, {
    steps,
    status: more ? 'planned' : 'done',
    currentStep: more ? idx + 1 : steps.length,
    result: more ? null : { ok: true }
  });

  const m2 = await getMission(mission.id, userId);
  return {
    text: more
      ? `Missão **${mission.id}** passo ${idx + 1} confirmado — continuo os próximos.`
      : `Missão **${mission.id}** concluída após confirmação.\n\n${formatMission(m2)}`,
    mission: m2,
    canAdvance: more
  };
}

/** Reabre passo failed / waiting_approval → pending. */
async function retryFailedMissionStep(userId, missionId = null) {
  const mission = missionId
    ? await getMission(missionId, userId)
    : await getActiveMission(userId);
  if (!mission) {
    return { resposta: 'Nenhuma missão pra retry.' };
  }
  const steps = [...(mission.steps || [])];
  const idx = steps.findIndex((s) => s.status === 'failed' || s.status === 'waiting_approval');
  if (idx < 0) {
    return {
      resposta: `Missão **${mission.id}** não tem passo falho.\n\n${formatMission(mission)}`
    };
  }
  const prevErr =
    steps[idx].result && (steps[idx].result.erro || steps[idx].result.error)
      ? String(steps[idx].result.erro || steps[idx].result.error).slice(0, 200)
      : null;
  steps[idx] = { ...steps[idx], status: 'pending', result: null };
  await updateMission(mission.id, userId, {
    steps,
    status: 'planned',
    currentStep: idx,
    result: null
  });
  const hint = await failuresHintForGoal(userId, mission.goal);
  return {
    resposta:
      `Passo ${idx + 1} reaberto` +
      (prevErr ? ` (falha anterior: ${prevErr})` : '') +
      `.\n\n` +
      formatMission(await getMission(mission.id, userId)) +
      (hint ? `\n${hint.trim()}` : '') +
      `\nManda **próximo passo** ou **executa missão**.`
  };
}

module.exports = {
  planFromGoal,
  planFromGoalLLM,
  normalizeSteps,
  parseMissionCommand,
  formatMission,
  formatProgressPing,
  startMission,
  advanceMission,
  runMissionBatch,
  tryHandleMissionCommand,
  resumeMissionAfterApproval,
  retryFailedMissionStep,
  getActiveMission,
  listMissions,
  looksLikeLandingPrep,
  resolveProjectFromText
};
