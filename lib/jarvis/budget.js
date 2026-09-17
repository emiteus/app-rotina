/**
 * Usage / cost budget (Phase 11+) — memory + Postgres daily rollup.
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
let flushTimer = null;

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
    hydrated = false;
  }
}

async function ensureHydrated() {
  roll();
  if (hydrated) return;
  try {
    await ensureBudgetTable();
    const row = await get(`SELECT * FROM jarvis_budget_daily WHERE day = $1`, [state.day]);
    if (row) {
      state.calls = Number(row.calls) || 0;
      state.promptTokens = Number(row.prompt_tokens) || 0;
      state.outputTokens = Number(row.output_tokens) || 0;
      state.fallbacks = Number(row.fallbacks) || 0;
      state.errors = Number(row.errors) || 0;
    }
  } catch (e) {
    console.error('[jarvis.budget] hydrate', e.message);
  }
  hydrated = true;
}

async function flushToDb() {
  roll();
  try {
    await ensureBudgetTable();
    await run(
      `INSERT INTO jarvis_budget_daily
         (day, calls, prompt_tokens, output_tokens, fallbacks, errors, atualizado_em)
       VALUES ($1,$2,$3,$4,$5,$6,CURRENT_TIMESTAMP)
       ON CONFLICT (day) DO UPDATE SET
         calls = EXCLUDED.calls,
         prompt_tokens = EXCLUDED.prompt_tokens,
         output_tokens = EXCLUDED.output_tokens,
         fallbacks = EXCLUDED.fallbacks,
         errors = EXCLUDED.errors,
         atualizado_em = CURRENT_TIMESTAMP`,
      [
        state.day,
        state.calls,
        state.promptTokens,
        state.outputTokens,
        state.fallbacks,
        state.errors
      ]
    );
  } catch (e) {
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
  if (meta.event === 'fallback') {
    state.fallbacks += 1;
    scheduleFlush();
    return;
  }
  state.calls += 1;
  if (meta.error) state.errors += 1;
  const prompt =
    meta.promptTokens ?? meta.inputTokens ?? meta.promptTokenCount ?? 0;
  const out =
    meta.candidatesTokens ?? meta.outputTokens ?? meta.candidatesTokenCount ?? 0;
  state.promptTokens += Number(prompt) || 0;
  state.outputTokens += Number(out) || 0;
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
