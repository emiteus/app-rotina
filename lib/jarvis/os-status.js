/**
 * OS status / dashboard payload (Phase 11).
 */
function getOsStatus() {
  const { getRegistryStatus } = require('./projects/registry');
  const { getToolCatalog, listToolNames } = require('./tools/registry');
  const { hitlEnabled, approvalThreshold } = require('./permissions/engine');
  const { listAgents } = require('./agents/registry');
  const { getBudgetStatus } = require('./budget');
  const { providerAtivo } = require('./ai-gateway');
  const { DEFAULT_TTL_MS, ASSIST_TTL_MS } = require('./snapshot-cache');

  const tools = getToolCatalog();
  return {
    ok: true,
    name: 'JARVIS OS',
    version: '0.8.0',
    phases: {
      core: true,
      aiGateway: true,
      snapshotCache: true,
      toolRegistry: true,
      contextMemory: true,
      hitl: true,
      projectRegistry: true,
      missions: true,
      multimodal: true,
      agents: true,
      proactive: true,
      polish: true,
      llmPlanner: process.env.JARVIS_LLM_PLANNER !== '0',
      budgetPersist: true,
      assistOsUi: true,
      whisperFallback:
        !!(process.env.OPENAI_API_KEY || process.env.JARVIS_WHISPER_KEY) &&
        process.env.JARVIS_WHISPER !== '0',
      hitlButtons: process.env.JARVIS_HITL_BUTTONS !== '0',
      handlersExtracted: true,
      waMultiUser: true,
      missionBatch: true
    },
    provider: providerAtivo(),
    hitl: hitlEnabled(),
    approvalThreshold: approvalThreshold(),
    cache: {
      projetosMs: DEFAULT_TTL_MS,
      assistMs: ASSIST_TTL_MS
    },
    tools: {
      count: listToolNames().length,
      highRisk: tools.filter((t) => t.needsApproval).map((t) => t.name)
    },
    projects: getRegistryStatus(),
    agents: listAgents(),
    budget: getBudgetStatus(),
    env: {
      hitl: process.env.JARVIS_HITL !== '0',
      proactiveWa: process.env.JARVIS_PROACTIVE_WA !== '0',
      crons: process.env.CRONS_ENABLED !== 'false',
      hitlButtons: process.env.JARVIS_HITL_BUTTONS !== '0',
      whisper: process.env.JARVIS_WHISPER !== '0'
    }
  };
}

module.exports = { getOsStatus };
