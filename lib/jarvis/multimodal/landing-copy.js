/**
 * Landing page copy outline — brief → copy de cliente (LLM + fallback afiado).
 */
const { getBrief } = require('../projects/briefs');

/** Ruído de engenharia que não deve ir pro hero de marketing. */
const TECH_NOISE =
  /\b(monorepo|pnpm|npm|yarn|docker(\s+compose)?|postgres|postgresql|redis|minio|bullmq|prisma|express|react|fastapi|ffmpeg|groq|gemini|railway|hetzner|supabase|typescript|nodejs?|commonjs|playwright|electron|expo|webhook|ops[_ ]?key|health|cutflix_status|jarvis|api_url|stack)\b/gi;

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

/** Frase de valor pro cliente a partir do brief (sem stack). */
function customerPitch(brief, name) {
  let s = String(brief || '')
    .replace(/\([^)]*\)/g, ' ')
    .replace(TECH_NOISE, ' ')
    .replace(/\s*[—–-]\s*/g, '. ')
    .replace(/\s+/g, ' ')
    .trim();
  // Pega o pedaço mais "produto" (antes de "Jarvis" / "Concorrente" / pasta)
  s = s.split(/\.\s+(?:Jarvis|Concorrente|Pasta|NÃO|Acesso)/i)[0] || s;
  s = s.replace(/^[^:]+:\s*/i, '').trim();
  if (s.length < 20) {
    return `${name}: produto digital — proposta de valor em uma frase.`;
  }
  // Preferir trecho com verbo de benefício
  const m = s.match(
    /(?:automação|automatiza|templates?|publica|corte|cortes|vídeo|video|IA|assinante|ranking|agend)[\s\S]{10,140}/i
  );
  let pitch = (m ? m[0] : s).replace(/\s+/g, ' ').trim();
  pitch = pitch.replace(/[.,;:\s]+$/g, '');
  if (pitch.length > 140) pitch = pitch.slice(0, 137) + '…';
  // Capitaliza
  return pitch.charAt(0).toUpperCase() + pitch.slice(1);
}

function defaultHeadline(name, topic) {
  if (topic) {
    const t = topic.charAt(0).toUpperCase() + topic.slice(1);
    return `${name}: ${t}`.slice(0, 60);
  }
  // Headlines por produto conhecido
  const presets = {
    cutflix: 'Corte e publique vídeos com IA',
    cinerush: 'IPTV pronto pro seu cliente',
    cinerush_editor: 'Cortes em massa, prontos pra postar',
    socialhub: 'Agende posts em todas as redes',
    attracione: 'Competição de cortes com ranking real',
    calow: 'Treino e dieta com IA',
    app_prime: 'Treino e dieta com IA'
  };
  const id = String(name || '')
    .toLowerCase()
    .replace(/\s+/g, '_');
  if (presets.cutflix && /cutflix/i.test(name)) return presets.cutflix;
  if (presets[id]) return presets[id];
  return `${name} — comece em minutos`;
}

/** Outline de marketing — usado quando LLM falha ou não há key. */
function formatLandingCopyFallback({ projectId, topic, ctx }) {
  const name = ctx.name || projectId || 'Produto';
  const site = ctx.urls[0] || '';
  const focus = cleanLandingTopic(topic, projectId, ctx);
  const pitch = customerPitch(ctx.brief, name);
  const headline = defaultHeadline(name, focus);

  return (
    `*Outline landing — ${name}*\n\n` +
    `*Hero*\n` +
    `• Headline: ${headline}\n` +
    `• Sub: ${pitch}\n` +
    `• CTA primário: Começar agora\n` +
    `• CTA secundário: Ver como funciona\n\n` +
    `*Seções*\n` +
    `1. *Problema* — Horas perdidas editando/publicando na mão; ferramenta espalhada; resultado inconsistente.\n` +
    `2. *Solução* — ${name} centraliza o fluxo: ${pitch.slice(0, 100)}\n` +
    `3. *Como funciona* — 1) Envie o material  2) A IA processa  3) Revise e publique\n` +
    `4. *Prova* — Feito pra quem já opera conteúdo em volume (templates + preview + publicação).\n` +
    `5. *CTA final* — ${headline} — clique e teste.\n\n` +
    (site ? `_Site atual: ${site}_\n` : '') +
    `_Fallback local (sem LLM ou LLM falhou)._`
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

function looksLikeEngineerDump(texto) {
  const s = String(texto || '');
  const hits = (s.match(TECH_NOISE) || []).length;
  return hits >= 3 || /cutflix_status|Docker Compose|Monorepo/i.test(s);
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

  const canLlm = !!(process.env.GEMINI_API_KEY || process.env.ANTHROPIC_API_KEY);

  if (canLlm) {
    try {
      const { chamarIA } = require('../ai-gateway');
      const { texto: raw } = await chamarIA({
        system: `Você é copywriter de landing SaaS (PT-BR). Escreve pra CLIENTE FINAL, não pra dev.
Devolva APENAS JSON:
{"product":"nome","hero":{"headline":"","sub":"","cta_primary":"","cta_secondary":""},"sections":[{"title":"","body":"","items":["..."]}],"notes":["..."]}
Regras obrigatórias:
- Headline ≤ 10 palavras, benefício, sem nome técnico de stack
- Sub ≤ 20 palavras, benefício (o que o usuário GANHA)
- PROIBIDO no hero: monorepo, Docker, Postgres, Redis, FFmpeg, Groq, pnpm, health, API
- Traduza o brief técnico em benefício (ex.: "worker FFmpeg" → "corta e processa vídeo automático")
- 4–5 seções com body concreto (não placeholders tipo "dor que o produto resolve")
- CTAs em português`,
        user:
          `Produto id: ${projectId}\n` +
          `Nome comercial: ${briefCtx.name}\n` +
          `Brief interno (traduza pra marketing): ${briefCtx.brief}\n` +
          `URL: ${(briefCtx.urls && briefCtx.urls[0]) || '—'}\n` +
          `Ângulo extra: ${topic || 'landing de conversão'}\n` +
          (hints ? `Hints: ${hints}\n` : ''),
        maxTokens: 1000,
        jsonMode: true,
        timeout: 28000
      });
      const cleaned = String(raw || '')
        .replace(/^```(?:json)?\s*/i, '')
        .replace(/\s*```$/, '')
        .trim();
      outline = JSON.parse(cleaned);
      texto = formatLandingCopyFromJson(outline, { projectId, ctx: briefCtx });
      source = 'llm';
      if (looksLikeEngineerDump(texto)) {
        console.warn(
          JSON.stringify({
            tag: 'jarvis.creative',
            event: 'landing_copy_llm_too_tech',
            projectId
          })
        );
        texto = null;
        outline = null;
        source = 'fallback';
      }
    } catch (e) {
      console.warn(
        JSON.stringify({
          tag: 'jarvis.creative',
          event: 'landing_copy_llm_fail',
          erro: String((e && e.message) || e).slice(0, 160)
        })
      );
    }
  }

  if (!texto) {
    texto = formatLandingCopyFallback({ projectId, topic, ctx: briefCtx });
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
    saved,
    texto: texto.slice(0, 2500),
    outline: outline || null
  };
}

module.exports = {
  generateLandingCopy,
  formatLandingCopyFallback,
  formatLandingCopyFromJson,
  briefContext,
  cleanLandingTopic,
  customerPitch,
  defaultHeadline
};
