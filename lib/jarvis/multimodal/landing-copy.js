/**
 * Landing page copy outline — brief + LLM (fallback determinístico sem API).
 */
const { getBrief } = require('../projects/briefs');

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
      stackHint: ''
    };
  }
  return {
    name: b.name || projectId,
    brief: b.brief || '',
    urls: Array.isArray(b.urls) ? b.urls : [],
    stackHint: b.stackHint || ''
  };
}

/** Outline mínimo a partir do brief — smoke / sem API key. */
function formatLandingCopyFallback({ projectId, topic, ctx }) {
  const name = ctx.name || projectId || 'Produto';
  const site = ctx.urls[0] || '';
  const focus = String(topic || name).trim().slice(0, 80);
  const gist = String(ctx.brief || '')
    .replace(/\s+/g, ' ')
    .slice(0, 220);

  return (
    `*Outline landing — ${name}*\n\n` +
    `*Hero*\n` +
    `• Headline: ${name} — ${focus}\n` +
    `• Sub: ${gist || 'Proposta de valor em uma frase (refine com o brief).'}\n` +
    `• CTA primário: Começar agora\n` +
    `• CTA secundário: Ver como funciona\n\n` +
    `*Seções*\n` +
    `1. Problema — dor que o produto resolve\n` +
    `2. Solução — o que ${name} faz em 3 bullets\n` +
    `3. Como funciona — 3 passos\n` +
    `4. Prova / diferencial — stack ou resultado\n` +
    `5. CTA final — repetir oferta\n\n` +
    (site ? `_Site atual: ${site}_\n` : '') +
    `_Gerado do brief (sem LLM). Rode de novo com API pra copy mais afiada._`
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

async function generateLandingCopy(acao, ctxUser) {
  const projectId = resolveProjectId(acao);
  if (!projectId) {
    return {
      tipo: 'creative_landing_copy',
      ok: false,
      erro: 'Falta project (ex.: cutflix)'
    };
  }

  const topic = String(acao.topic || acao.focus || acao.assunto || '').trim().slice(0, 120);
  const hints = String(acao.hints || acao.context || acao.contexto || '').trim().slice(0, 800);
  const briefCtx = briefContext(projectId);

  let texto = null;
  let source = 'fallback';
  let outline = null;

  const canLlm =
    process.env.GEMINI_API_KEY || process.env.ANTHROPIC_API_KEY
      ? true
      : false;

  if (canLlm) {
    try {
      const { chamarIA } = require('../ai-gateway');
      const { texto: raw } = await chamarIA({
        system: `Você escreve outline de landing page (PT-BR) pra WhatsApp.
Devolva APENAS JSON:
{"product":"nome","hero":{"headline":"","sub":"","cta_primary":"","cta_secondary":""},"sections":[{"title":"","body":"","items":["..."]}],"notes":["..."]}
Regras:
- Máx 5 seções; copy concreta, sem enrolação
- Headline ≤ 12 palavras; sub ≤ 25 palavras
- Use o brief do produto; não invente features que contradigam o brief
- CTAs em português`,
        user:
          `Produto id: ${projectId}\n` +
          `Nome: ${briefCtx.name}\n` +
          `Brief: ${briefCtx.brief}\n` +
          `Stack: ${briefCtx.stackHint || '—'}\n` +
          `URL: ${(briefCtx.urls && briefCtx.urls[0]) || '—'}\n` +
          `Foco/tópico: ${topic || briefCtx.name}\n` +
          (hints ? `Hints extras: ${hints}\n` : ''),
        maxTokens: 900,
        jsonMode: true,
        timeout: 25000
      });
      const cleaned = String(raw || '')
        .replace(/^```(?:json)?\s*/i, '')
        .replace(/\s*```$/, '')
        .trim();
      outline = JSON.parse(cleaned);
      texto = formatLandingCopyFromJson(outline, { projectId, ctx: briefCtx });
      source = 'llm';
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
  briefContext
};
