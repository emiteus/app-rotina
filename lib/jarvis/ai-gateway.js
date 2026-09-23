/**
 * AI Gateway (Phase 2) — provider selection, Gemini→Anthropic fallback, usage log.
 * Mantém a mesma API que routes/ia.js esperava de chamarIA.
 */
const axios = require('axios');

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_MODEL = 'claude-haiku-4-5-20251001';

// 2.5/2.0 desligados pelo Google (404 "no longer available", 2026-09-23) — mesmo aparecendo
// no ListModels. Rode scripts/check-models.js pra conferir quais respondem de verdade.
const GEMINI_MODELS = [
  'gemini-3.5-flash',
  'gemini-3.5-flash-lite',
  'gemini-flash-lite-latest',
  'gemini-flash-latest'
];
const GEMINI_MODEL = GEMINI_MODELS[0];

function geminiUrl(model) {
  return `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
}

function providerPreferido() {
  if (process.env.GEMINI_API_KEY) return 'gemini';
  if (process.env.ANTHROPIC_API_KEY) return 'anthropic';
  return null;
}

/** Alias histórico usado em /api/ia/status */
function providerAtivo() {
  return providerPreferido();
}

function isTimeoutErr(err) {
  const code = err.code || err.cause?.code;
  const msg = String(err.message || '');
  return code === 'ECONNABORTED' || code === 'ETIMEDOUT' || /timeout/i.test(msg);
}

function modeloSaturado(err) {
  if (isTimeoutErr(err)) return true;
  const raw = err.response?.data?.error?.message || err.message || '';
  const status = err.response?.status;
  return (
    status === 404 ||
    status === 429 ||
    status === 503 ||
    /high demand|overloaded|unavailable|resource.?exhausted|no longer available|not found/i.test(
      raw
    )
  );
}

function mensagemGemini(err) {
  const raw = err.response?.data?.error?.message || err.message || '';
  const status = err.response?.status;
  if (isTimeoutErr(err)) {
    return 'A IA demorou demais pra responder. Tenta de novo — pedidos tipo “muda categoria X pra Y” costumam ir mais rápido agora.';
  }
  const saturado =
    status === 429 ||
    status === 503 ||
    /high demand|overloaded|unavailable|resource.?exhausted/i.test(raw);
  if (saturado) {
    return process.env.ANTHROPIC_API_KEY
      ? 'O Gemini está saturado e o fallback também falhou. Tenta de novo em alguns segundos.'
      : 'O Gemini está saturado agora. Tenta de novo em alguns segundos.';
  }
  return raw || 'Falha ao falar com a IA.';
}

function montarHistorico(historico, user) {
  const msgs = [];
  if (Array.isArray(historico)) {
    for (const m of historico.slice(-10)) {
      const role = m.role === 'assistant' ? 'assistant' : 'user';
      const content = String(m.content || '').trim();
      if (!content) continue;
      msgs.push({ role, content: content.slice(0, 4000) });
    }
  }
  msgs.push({ role: 'user', content: String(user || '') });
  return msgs;
}

function logUsage(meta) {
  try {
    require('./budget').recordUsage(meta);
  } catch (_) { /* ignore */ }
  console.log(
    JSON.stringify({
      tag: 'jarvis.ai',
      ...meta
    })
  );
}

async function chamarGemini({ body, timeout, models = GEMINI_MODELS }) {
  let ultimo = null;
  for (const model of models) {
    try {
      const t0 = Date.now();
      const resp = await axios.post(
        geminiUrl(model),
        body,
        {
          // chave no header, não na URL (URL aparece em log de erro/proxy)
          headers: {
            'content-type': 'application/json',
            'x-goog-api-key': process.env.GEMINI_API_KEY
          },
          timeout
        }
      );
      const texto = (resp.data?.candidates?.[0]?.content?.parts?.[0]?.text || '').trim();
      const usage = resp.data?.usageMetadata || null;
      logUsage({
        provider: 'gemini',
        model,
        durationMs: Date.now() - t0,
        promptTokens: usage?.promptTokenCount ?? null,
        candidatesTokens: usage?.candidatesTokenCount ?? null,
        totalTokens: usage?.totalTokenCount ?? null
      });
      return { texto, usage, provider: 'gemini', model };
    } catch (err) {
      ultimo = err;
      // Timeout = lentidão geral: tentar o próximo Gemini com o timeout inteiro de novo
      // levava o turno a ~2 min. Sobe pro chamarIA decidir o fallback (Anthropic).
      if (isTimeoutErr(err)) throw err;
      if (modeloSaturado(err)) continue;
      throw err;
    }
  }
  throw ultimo;
}

async function chamarAnthropic({ system, msgs, maxTokens, timeout }) {
  const t0 = Date.now();
  const resp = await axios.post(
    ANTHROPIC_URL,
    {
      model: ANTHROPIC_MODEL,
      max_tokens: maxTokens,
      system,
      messages: msgs.map((m) => ({ role: m.role, content: m.content }))
    },
    {
      headers: {
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json'
      },
      timeout
    }
  );
  const texto = (resp.data?.content?.[0]?.text || '').trim();
  const usage = resp.data?.usage || null;
  logUsage({
    provider: 'anthropic',
    model: ANTHROPIC_MODEL,
    durationMs: Date.now() - t0,
    inputTokens: usage?.input_tokens ?? null,
    outputTokens: usage?.output_tokens ?? null
  });
  return { texto, usage, provider: 'anthropic', model: ANTHROPIC_MODEL };
}

/**
 * Chama Gemini (preferido) com fallback automático para Anthropic se as duas keys existirem.
 */
async function chamarIA({
  system,
  user,
  historico,
  maxTokens = 300,
  jsonMode = false,
  timeout = 20000
}) {
  const { budgetAllowsCall, getBudgetStatus, ensureHydrated } = require('./budget');
  await ensureHydrated();
  if (!budgetAllowsCall()) {
    const b = getBudgetStatus();
    const err = new Error(
      `Orçamento diário do Jarvis esgotado (${b.calls} calls / ${b.totalTokens} tokens).`
    );
    err.status = 429;
    throw err;
  }

  const hasGemini = !!process.env.GEMINI_API_KEY;
  const hasAnthropic = !!process.env.ANTHROPIC_API_KEY;
  if (!hasGemini && !hasAnthropic) {
    throw new Error('Nenhuma API key configurada (GEMINI_API_KEY ou ANTHROPIC_API_KEY).');
  }

  const msgs = montarHistorico(historico, user);

  if (hasGemini) {
    const contents = msgs.map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }]
    }));
    const body = {
      systemInstruction: { parts: [{ text: system }] },
      contents,
      generationConfig: {
        temperature: 0.5,
        maxOutputTokens: maxTokens,
        ...(jsonMode ? { responseMimeType: 'application/json' } : {})
      }
    };
    try {
      return await chamarGemini({ body, timeout });
    } catch (err) {
      if (hasAnthropic && (modeloSaturado(err) || isTimeoutErr(err))) {
        console.log(
          JSON.stringify({
            tag: 'jarvis.ai',
            event: 'fallback',
            from: 'gemini',
            to: 'anthropic',
            reason: err.message || 'saturated'
          })
        );
        try {
          require('./budget').recordUsage({ event: 'fallback' });
        } catch (_) { /* ignore */ }
        return chamarAnthropic({ system, msgs, maxTokens, timeout });
      }
      throw err;
    }
  }

  return chamarAnthropic({ system, msgs, maxTokens, timeout });
}

module.exports = {
  chamarIA,
  providerAtivo,
  providerPreferido,
  mensagemGemini,
  isTimeoutErr,
  modeloSaturado,
  GEMINI_MODEL,
  GEMINI_MODELS,
  ANTHROPIC_MODEL,
  geminiUrl
};
