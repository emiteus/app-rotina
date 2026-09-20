/**
 * Landing page copy outline — brief → copy de cliente (LLM + fallback afiado).
 */
const { getBrief } = require('../projects/briefs');

/** Ruído de engenharia que não deve ir pro hero de marketing. */
const TECH_NOISE =
  /\b(monorepo|pnpm|npm|yarn|docker(\s+compose)?|postgres(ql)?|redis|minio|bullmq|prisma|express|react|fastapi|ffmpeg|groq|gemini|railway|hetzner|supabase|typescript|nodejs?|commonjs|playwright|electron|expo|webhook|ops[_ ]?key|health|cutflix_status|jarvis|api_url|stack|worker|upload\/?url)\b/gi;

/** Pitches curados — copy de cliente, não stack. */
const PITCH_PRESETS = {
  cutflix:
    'Do template ao Instagram: corte, preview e publique com IA — sem editar na mão.',
  cinerush: 'IPTV pro cliente final: venda, provisionamento e suporte num fluxo só.',
  cinerush_editor: 'Cortes em massa com templates e fila — prontos pra postar.',
  socialhub: 'Agende e publique em YouTube, Instagram, Facebook e TikTok num lugar só.',
  attracione: 'Competição de cortes com ranking e coleta de views de verdade.',
  clipper: 'Clipagem ao vivo de várias streams — capture o momento sem perder o jogo.',
  projeto_milhao: 'Operação de conteúdo Instagram com ritmo e fechamento diário.',
  app_prime: 'Treino e dieta com IA — plano personalizado do quiz ao app.',
  calow: 'Treino e dieta com IA — plano personalizado do quiz ao app.',
  jarvis: 'Seu hub operacional: missões, projetos e WhatsApp num cérebro só.',
  approtina: 'Rotina, finanças e assistente no mesmo dashboard.'
};

const HEADLINE_PRESETS = {
  cutflix: 'Corte e publique vídeos com IA',
  cinerush: 'IPTV pronto pro seu cliente',
  cinerush_editor: 'Cortes em massa, prontos pra postar',
  socialhub: 'Agende posts em todas as redes',
  attracione: 'Competição de cortes com ranking real',
  clipper: 'Clippe o momento em todas as streams',
  projeto_milhao: 'Conteúdo Instagram no ritmo certo',
  app_prime: 'Treino e dieta com IA',
  jarvis: 'Seu assistente operacional',
  approtina: 'Rotina e finanças no piloto'
};

function resolveProjectId(acao) {
  return String(acao.project || acao.project_id || acao.projeto || '').trim().toLowerCase() || null;
}

function briefContext(projectId) {
  const b = getBrief(projectId);
  if (!b) {
    return {
      name: projectId || 'produto',
      brief: '',
      urls: [],
      stackHint: '',
      aliases: []
    };
  }
  return {
    name: b.name || projectId,
    brief: b.brief || '',
    urls: Array.isArray(b.urls) ? b.urls : [],
    stackHint: b.stackHint || '',
    aliases: Array.isArray(b.aliases) ? b.aliases : []
  };
}

/**
 * Limpa resto do goal ("do cutflix", "pra milhão") depois de tirar "prepara landing".
 */
function cleanLandingTopic(raw, projectId, ctx) {
  let t = String(raw || '').trim();
  const names = [projectId, ctx && ctx.name, ...((ctx && ctx.aliases) || [])]
    .filter(Boolean)
    .map((x) => String(x).toLowerCase());
  for (const n of names) {
    const esc = n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    t = t.replace(new RegExp(`\\b${esc}\\b`, 'gi'), ' ');
  }
  t = t
    .replace(/\b(do|da|de|dos|das|pro|pra|para|o|a|um|uma)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (t.length < 3 || /^[-–—]+$/.test(t)) return '';
  return t.slice(0, 80);
}

function scrubTech(text) {
  return String(text || '')
    .replace(/\([^)]*\)/g, ' ')
    .replace(TECH_NOISE, ' ')
    .replace(/\s*[+,|/]\s*/g, ' ')
    .replace(/\s*\.\s*\./g, '. ')
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([.,;:])/g, '$1')
    .replace(/^[.,;:\s]+|[.,;:\s]+$/g, '')
    .trim();
}

/** Frase de valor pro cliente a partir do brief (sem stack). */
function customerPitch(brief, name, projectId) {
  const id = String(projectId || '').toLowerCase();
  if (PITCH_PRESETS[id]) return PITCH_PRESETS[id];
  if (/cutflix/i.test(name)) return PITCH_PRESETS.cutflix;

  let s = scrubTech(brief);
  s = s.split(/\.\s+(?:Jarvis|Concorrente|Pasta|NÃO|Acesso)/i)[0] || s;
  s = s.replace(/^[^:]+:\s*/i, '').trim();
  s = scrubTech(s);

  if (s.length < 24 || looksLikeEngineerDump(s)) {
    return `${name}: menos trabalho manual, mais resultado publicado.`;
  }
  if (s.length > 140) s = s.slice(0, 137) + '…';
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function defaultHeadline(name, topic, projectId) {
  const id = String(projectId || '').toLowerCase();
  if (topic) {
    const t = topic.charAt(0).toUpperCase() + topic.slice(1);
    return `${name}: ${t}`.slice(0, 60);
  }
  if (HEADLINE_PRESETS[id]) return HEADLINE_PRESETS[id];
  if (/cutflix/i.test(name)) return HEADLINE_PRESETS.cutflix;
  return `${name} — comece em minutos`;
}

function looksLikeEngineerDump(texto) {
  const s = String(texto || '');
  const hits = (s.match(TECH_NOISE) || []).length;
  return (
    hits >= 2 ||
    /cutflix_status|Docker Compose|Monorepo|worker\s*\+/i.test(s) ||
    /\.\s*\.\s*hoje/i.test(s)
  );
}

/** Outline de marketing — usado quando LLM falha ou não há key. */
function formatLandingCopyFallback({ projectId, topic, ctx, llmError }) {
  const name = ctx.name || projectId || 'Produto';
  const site = ctx.urls[0] || '';
  const focus = cleanLandingTopic(topic, projectId, ctx);
  const pitch = customerPitch(ctx.brief, name, projectId);
  const headline = defaultHeadline(name, focus, projectId);
  const errNote = llmError
    ? `_Fallback (LLM: ${String(llmError).slice(0, 80)})._`
    : `_Fallback local (sem LLM ou LLM falhou)._`;

  return (
    `*Outline landing — ${name}*\n\n` +
    `*Hero*\n` +
    `• Headline: ${headline}\n` +
    `• Sub: ${pitch}\n` +
    `• CTA primário: Começar agora\n` +
    `• CTA secundário: Ver como funciona\n\n` +
    `*Seções*\n` +
    `1. *Problema* — Horas perdidas editando/publicando na mão; ferramentas espalhadas; resultado inconsistente.\n` +
    `2. *Solução* — ${name} centraliza o fluxo: ${pitch}\n` +
    `3. *Como funciona* — 1) Envie o material  2) A IA processa  3) Revise e publique\n` +
    `4. *Prova* — Feito pra quem já opera conteúdo em volume (templates + preview + publicação).\n` +
    `5. *CTA final* — ${headline} — clique e teste.\n\n` +
    (site ? `_Site atual: ${site}_\n` : '') +
    errNote
  );
}

function formatLandingCopyFromJson(data, { projectId, ctx }) {
  const name = (data && data.product) || ctx.name || projectId || 'Produto';
  const hero = (data && data.hero) || {};
  const sections = Array.isArray(data && data.sections) ? data.sections : [];
  const notes = Array.isArray(data && data.notes) ? data.notes : [];

  let md = `*Outline landing — ${name}*\n\n`;
  md += `*Hero*\n`;
  if (hero.headline) md += `• Headline: ${String(hero.headline).slice(0, 120)}\n`;
  if (hero.sub) md += `• Sub: ${String(hero.sub).slice(0, 200)}\n`;
  if (hero.cta_primary) md += `• CTA: ${String(hero.cta_primary).slice(0, 80)}\n`;
  if (hero.cta_secondary) md += `• CTA 2: ${String(hero.cta_secondary).slice(0, 80)}\n`;

  if (sections.length) {
    md += `\n*Seções*\n`;
    sections.slice(0, 6).forEach((s, i) => {
      const title = String((s && (s.title || s.heading)) || `Seção ${i + 1}`).slice(0, 80);
      const body = String((s && (s.body || s.copy || s.bullets)) || '')
        .replace(/\s+/g, ' ')
        .slice(0, 180);
      const bullets = Array.isArray(s && s.items)
        ? s.items
            .slice(0, 4)
            .map((x) => String(x).slice(0, 100))
            .join(' · ')
        : '';
      md += `${i + 1}. *${title}* — ${body || bullets || '…'}\n`;
    });
  }

  if (notes.length) {
    md += `\n*Notas*\n`;
    notes.slice(0, 4).forEach((n) => {
      md += `• ${String(n).slice(0, 140)}\n`;
    });
  }

  if (ctx.urls && ctx.urls[0]) md += `\n_Site: ${ctx.urls[0]}_\n`;
  return md.trim();
}

/** Extrai/repara JSON truncado do LLM (Gemini corta string no meio). */
function parseLandingJson(raw) {
  let s = String(raw || '')
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  if (!s) throw new Error('LLM vazio');

  const tryParse = (x) => {
    const o = JSON.parse(x);
    if (!o || typeof o !== 'object') throw new Error('JSON não-objeto');
    return o;
  };

  try {
    return tryParse(s);
  } catch (_) {
    /* repair below */
  }

  // Pega do primeiro { ao fim
  const start = s.indexOf('{');
  if (start >= 0) s = s.slice(start);

  // Fecha string aberta + brackets/braces
  let repaired = s;
  let qOpen = false;
  let qEsc = false;
  for (const ch of repaired) {
    if (qOpen) {
      if (qEsc) qEsc = false;
      else if (ch === '\\') qEsc = true;
      else if (ch === '"') qOpen = false;
    } else if (ch === '"') qOpen = true;
  }
  if (qOpen) repaired += '"';
  const opens = { '{': 0, '[': 0 };
  let inStr = false;
  let esc = false;
  for (const ch of repaired) {
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === '{') opens['{']++;
    else if (ch === '}') opens['{']--;
    else if (ch === '[') opens['[']++;
    else if (ch === ']') opens['[']--;
  }
  while (opens['['] > 0) {
    repaired += ']';
    opens['[']--;
  }
  while (opens['{'] > 0) {
    repaired += '}';
    opens['{']--;
  }

  try {
    return tryParse(repaired);
  } catch (_) {
    /* regex hero fallback */
  }

  // Último recurso: só o hero via regex
  const headline = (s.match(/"headline"\s*:\s*"((?:\\.|[^"\\])*)"/) || [])[1];
  const sub = (s.match(/"sub"\s*:\s*"((?:\\.|[^"\\])*)"/) || [])[1];
  const cta1 = (s.match(/"cta_primary"\s*:\s*"((?:\\.|[^"\\])*)"/) || [])[1];
  const cta2 = (s.match(/"cta_secondary"\s*:\s*"((?:\\.|[^"\\])*)"/) || [])[1];
  const product = (s.match(/"product"\s*:\s*"((?:\\.|[^"\\])*)"/) || [])[1];
  if (headline || sub) {
    return {
      product: product || undefined,
      hero: {
        headline: headline ? JSON.parse(`"${headline}"`) : undefined,
        sub: sub ? JSON.parse(`"${sub}"`) : undefined,
        cta_primary: cta1 ? JSON.parse(`"${cta1}"`) : 'Começar agora',
        cta_secondary: cta2 ? JSON.parse(`"${cta2}"`) : 'Ver como funciona'
      },
      sections: [],
      notes: ['JSON truncado — hero recuperado; seções do fallback se vazias']
    };
  }
  throw new Error('JSON irreparável');
}

function mergeOutlineWithFallback(outline, { projectId, topic, ctx }) {
  const fbPitch = customerPitch(ctx.brief, ctx.name, projectId);
  const fbHeadline = defaultHeadline(ctx.name, topic, projectId);
  const hero = { ...(outline && outline.hero) };
  if (!hero.headline) hero.headline = fbHeadline;
  if (!hero.sub) hero.sub = fbPitch;
  if (!hero.cta_primary) hero.cta_primary = 'Começar agora';
  if (!hero.cta_secondary) hero.cta_secondary = 'Ver como funciona';

  let sections = Array.isArray(outline && outline.sections) ? outline.sections : [];
  if (!sections.length) {
    sections = [
      { title: 'Problema', body: 'Horas perdidas editando/publicando na mão; ferramentas espalhadas.' },
      { title: 'Solução', body: fbPitch },
      { title: 'Como funciona', body: '1) Envie o material  2) A IA processa  3) Revise e publique' },
      { title: 'Prova', body: 'Feito pra quem já opera conteúdo em volume.' },
      { title: 'CTA final', body: `${hero.headline} — clique e teste.` }
    ];
  }
  return {
    product: (outline && outline.product) || ctx.name || projectId,
    hero,
    sections,
    notes: Array.isArray(outline && outline.notes) ? outline.notes : []
  };
}

async function generateLandingCopy(acao, ctxUser) {
  const projectId = resolveProjectId(acao);
  if (!projectId) {
    return {
      tipo: 'creative_landing_copy',
      ok: false,
      erro: 'Falta project (ex.: cutflix)'
    };
  }

  const briefCtx = briefContext(projectId);
  const topicRaw = String(acao.topic || acao.focus || acao.assunto || '').trim().slice(0, 120);
  const topic = cleanLandingTopic(topicRaw, projectId, briefCtx);
  const hints = String(acao.hints || acao.context || acao.contexto || '').trim().slice(0, 800);

  let texto = null;
  let source = 'fallback';
  let outline = null;
  let llmError = null;

  const canLlm = !!(process.env.GEMINI_API_KEY || process.env.ANTHROPIC_API_KEY);

  if (canLlm) {
    try {
      const { chamarIA } = require('../ai-gateway');
      const { texto: raw } = await chamarIA({
        system: `Copywriter SaaS PT-BR. Só JSON válido e CURTO (cabe em 600 tokens).
Schema:
{"product":"","hero":{"headline":"","sub":"","cta_primary":"","cta_secondary":""},"sections":[{"title":"","body":""}]}
Regras:
- 4 seções max; body ≤ 20 palavras cada
- headline ≤ 8 palavras; sub ≤ 18 palavras
- Zero stack (Docker/FFmpeg/pnpm/API/worker)
- Benefício pro cliente; CTAs em PT`,
        user:
          `id=${projectId}\n` +
          `nome=${briefCtx.name}\n` +
          `brief=${String(briefCtx.brief).slice(0, 400)}\n` +
          `pitch=${customerPitch(briefCtx.brief, briefCtx.name, projectId)}\n` +
          `url=${(briefCtx.urls && briefCtx.urls[0]) || ''}\n` +
          `angulo=${topic || 'conversão'}\n` +
          (hints ? `hints=${hints.slice(0, 200)}\n` : ''),
        maxTokens: 700,
        jsonMode: true,
        timeout: 28000
      });
      const parsed = parseLandingJson(raw);
      outline = mergeOutlineWithFallback(parsed, {
        projectId,
        topic,
        ctx: briefCtx
      });
      texto = formatLandingCopyFromJson(outline, { projectId, ctx: briefCtx });
      source = 'llm';
      if (looksLikeEngineerDump(texto)) {
        llmError = 'output muito técnico';
        texto = null;
        outline = null;
        source = 'fallback';
      }
    } catch (e) {
      llmError = String((e && e.message) || e).slice(0, 120);
      console.warn(
        JSON.stringify({
          tag: 'jarvis.creative',
          event: 'landing_copy_llm_fail',
          erro: llmError
        })
      );
    }
  } else {
    llmError = 'sem GEMINI/ANTHROPIC key neste processo';
  }

  if (!texto) {
    texto = formatLandingCopyFallback({
      projectId,
      topic,
      ctx: briefCtx,
      llmError
    });
    source = 'fallback';
  }

  let saved = false;
  if (ctxUser && ctxUser.userId) {
    try {
      const { upsertProjectMemory } = require('../memory/projects');
      await upsertProjectMemory(ctxUser.userId, {
        project_id: projectId,
        nota: `Landing outline: ${(outline && outline.hero && outline.hero.headline) || topic || briefCtx.name}`.slice(
          0,
          200
        ),
        extras: {
          last_landing_copy: {
            at: new Date().toISOString(),
            source,
            llmError: llmError || null,
            preview: texto.slice(0, 600),
            outline: outline || null
          }
        }
      });
      saved = true;
    } catch (_) {
      /* optional */
    }
  }

  return {
    tipo: 'creative_landing_copy',
    ok: true,
    project: projectId,
    source,
    llmError: llmError || null,
    saved,
    texto: texto.slice(0, 2500),
    outline: outline || null
  };
}

module.exports = {
  generateLandingCopy,
  formatLandingCopyFallback,
  formatLandingCopyFromJson,
  parseLandingJson,
  briefContext,
  cleanLandingTopic,
  customerPitch,
  defaultHeadline,
  PITCH_PRESETS
};
