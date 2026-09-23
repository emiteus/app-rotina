/**
 * Usage / cost budget (Phase 11+) — memory + Postgres daily rollup.
 * Grava INCREMENTOS (não o total em memória): processo principal e workers (fork)
 * sobrescreviam a contagem um do outro. Total é relido do banco a cada 60s.
 */
const { get, run } = require('./host').requireLib('db');

const dayKey = () => new Date().toISOString().slice(0, 10);

let state = {
  day: dayKey(),
  calls: 0,
  promptTokens: 0,
  outputTokens: 0,
  fallbacks: 0,
  errors: 0
};
let hydrated = false;
let hydratedAt = 0;
let flushTimer = null;
const REHYDRATE_MS = 60 * 1000;
const FIELDS = ['calls', 'promptTokens', 'outputTokens', 'fallbacks', 'errors'];
const COLS = {
  calls: 'calls',
  promptTokens: 'prompt_tokens',
  outputTokens: 'output_tokens',
  fallbacks: 'fallbacks',
  errors: 'errors'
};

function emptyDeltas() {
  return { calls: 0, promptTokens: 0, outputTokens: 0, fallbacks: 0, errors: 0 };
}
/** Uso deste processo ainda não gravado no banco. */
let deltas = emptyDeltas();

async function ensureBudgetTable() {
  await run(`
    CREATE TABLE IF NOT EXISTS jarvis_budget_daily (
      day TEXT PRIMARY KEY,
      calls INT NOT NULL DEFAULT 0,
      prompt_tokens INT NOT NULL DEFAULT 0,
      output_tokens INT NOT NULL DEFAULT 0,
      fallbacks INT NOT NULL DEFAULT 0,
      errors INT NOT NULL DEFAULT 0,
      atualizado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
}

function roll() {
  const d = dayKey();
  if (state.day !== d) {
    state = {
      day: d,
      calls: 0,
      promptTokens: 0,
      outputTokens: 0,
      fallbacks: 0,
      errors: 0
    };
    deltas = emptyDeltas();
    hydrated = false;
  }
}

async function ensureHydrated() {
  roll();
  // Relê periodicamente: workers gravam uso direto no banco
  if (hydrated && Date.now() - hydratedAt < REHYDRATE_MS) return;
  try {
    await ensureBudgetTable();
    const row = await get(`SELECT * FROM jarvis_budget_daily WHERE day = $1`, [state.day]);
    // total = banco (todos os processos) + o que este processo ainda não gravou
    for (const f of FIELDS) {
      state[f] = (row ? Number(row[COLS[f]]) || 0 : 0) + deltas[f];
    }
  } catch (e) {
    console.error('[jarvis.budget] hydrate', e.message);
  }
  hydrated = true;
  hydratedAt = Date.now();
}

async function flushToDb() {
  roll();
  const pending = deltas;
  if (!FIELDS.some((f) => pending[f])) return;
  deltas = emptyDeltas();
  try {
    await ensureBudgetTable();
    await run(
      `INSERT INTO jarvis_budget_daily
         (day, calls, prompt_tokens, output_tokens, fallbacks, errors, atualizado_em)
       VALUES ($1,$2,$3,$4,$5,$6,CURRENT_TIMESTAMP)
       ON CONFLICT (day) DO UPDATE SET
         calls = jarvis_budget_daily.calls + EXCLUDED.calls,
         prompt_tokens = jarvis_budget_daily.prompt_tokens + EXCLUDED.prompt_tokens,
         output_tokens = jarvis_budget_daily.output_tokens + EXCLUDED.output_tokens,
         fallbacks = jarvis_budget_daily.fallbacks + EXCLUDED.fallbacks,
         errors = jarvis_budget_daily.errors + EXCLUDED.errors,
         atualizado_em = CURRENT_TIMESTAMP`,
      [
        state.day,
        pending.calls,
        pending.promptTokens,
        pending.outputTokens,
        pending.fallbacks,
        pending.errors
      ]
    );
  } catch (e) {
    // Devolve pro próximo flush em vez de perder
    for (const f of FIELDS) deltas[f] += pending[f];
    console.error('[jarvis.budget] flush', e.message);
  }
}

function scheduleFlush() {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    flushToDb().catch(() => {});
  }, 1500);
}

function recordUsage(meta = {}) {
  roll();
  const bump = (f, n) => {
    state[f] += n;
    deltas[f] += n;
  };
  if (meta.event === 'fallback') {
    bump('fallbacks', 1);
    scheduleFlush();
    return;
  }
  bump('calls', 1);
  if (meta.error) bump('errors', 1);
  const prompt =
    meta.promptTokens ?? meta.inputTokens ?? meta.promptTokenCount ?? 0;
  const out =
    meta.candidatesTokens ?? meta.outputTokens ?? meta.candidatesTokenCount ?? 0;
  bump('promptTokens', Number(prompt) || 0);
  bump('outputTokens', Number(out) || 0);
  scheduleFlush();
}

function getBudgetStatus() {
  roll();
  const maxCalls = Number(process.env.JARVIS_DAILY_CALL_BUDGET) || 0;
  const maxTokens = Number(process.env.JARVIS_DAILY_TOKEN_BUDGET) || 0;
  const totalTokens = state.promptTokens + state.outputTokens;
  return {
    day: state.day,
    calls: state.calls,
    promptTokens: state.promptTokens,
    outputTokens: state.outputTokens,
    totalTokens,
    fallbacks: state.fallbacks,
    errors: state.errors,
    persisted: hydrated,
    budget: {
      maxCalls: maxCalls || null,
      maxTokens: maxTokens || null,
      callsExceeded: maxCalls > 0 && state.calls >= maxCalls,
      tokensExceeded: maxTokens > 0 && totalTokens >= maxTokens
    }
  };
}

function budgetAllowsCall() {
  const b = getBudgetStatus();
  if (b.budget.callsExceeded || b.budget.tokensExceeded) return false;
  return true;
}

module.exports = {
  recordUsage,
  getBudgetStatus,
  budgetAllowsCall,
  ensureHydrated,
  flushToDb,
  ensureBudgetTable
};
