/**
 * Usage / cost budget tracker (Phase 11 polish).
 * In-memory daily counters — reset at UTC day change.
 */
const dayKey = () => new Date().toISOString().slice(0, 10);

let state = {
  day: dayKey(),
  calls: 0,
  promptTokens: 0,
  outputTokens: 0,
  fallbacks: 0,
  errors: 0
};

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
  }
}

function recordUsage(meta = {}) {
  roll();
  state.calls += 1;
  if (meta.event === 'fallback') state.fallbacks += 1;
  if (meta.error) state.errors += 1;
  const prompt =
    meta.promptTokens ?? meta.inputTokens ?? meta.promptTokenCount ?? 0;
  const out =
    meta.candidatesTokens ?? meta.outputTokens ?? meta.candidatesTokenCount ?? 0;
  state.promptTokens += Number(prompt) || 0;
  state.outputTokens += Number(out) || 0;
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
  budgetAllowsCall
};
