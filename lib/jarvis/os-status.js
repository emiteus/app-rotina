/**
 * OS status / dashboard payload (Phase 11).
 */
const fs = require('fs');
const path = require('path');

function readPackageVersion() {
  try {
    const candidates = [
      path.join(__dirname, 'VERSION'),
      path.join(__dirname, '..', 'package.json'),
      path.join(__dirname, '..', '..', 'package.json')
    ];
    for (const p of candidates) {
      if (!fs.existsSync(p)) continue;
      if (p.endsWith('VERSION')) {
        return fs.readFileSync(p, 'utf8').trim() || '0.0.0';
      }
      const j = JSON.parse(fs.readFileSync(p, 'utf8'));
      if (j.version) return j.version;
    }
  } catch {
    /* ignore */
  }
  return '0.0.0';
}

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
    version: readPackageVersion(),
    home: process.env.JARVIS_HOME || 'R:\\Projetos\\Jarvis',
    host: 'approtina',
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
      visionV2: true,
      agents: true,
      proactive: true,
      polish: true,
      llmPlanner: process.env.JARVIS_LLM_PLANNER !== '0',
      budgetPersist: true,
      assistOsUi: true,
      whisperFallback:
        !!(process.env.OPENAI_API_KEY || process.env.JARVIS_WHISPER_KEY) &&
        process.env.JARVIS_WHISPER !== '0',
      hitlButtons: process.env.JARVIS_HITL_BUTTONS === '1',
      handlersExtracted: true,
      handlersByDomain: true,
      waMultiUser: true,
      missionBatch: true,
      assistDashboard: true,
      cinerushEditor: true,
      hitlChannelBound: true,
      hostBridge: true,
      projectMemory: true,
      opsHonesty: true,
      cutflixConnector: true,
      ecosystemIngest: true,
      projectBriefs: true,
      receita30d: true,
      missionHitlResume: true,
      projetoMilhao: true
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
      hitl: hitlEnabled() && !!require('./permissions/engine').hitlAppliesToChannel('web'),
      hitlWhatsapp: process.env.JARVIS_HITL_WHATSAPP === '1',
      proactiveWa: process.env.JARVIS_PROACTIVE_WA !== '0',
      railwayWatch: process.env.JARVIS_RAILWAY_WATCH !== '0',
      crons: process.env.CRONS_ENABLED !== 'false',
      hitlButtons: process.env.JARVIS_HITL_BUTTONS === '1',
      whisper: process.env.JARVIS_WHISPER !== '0'
    }
  };
}

module.exports = { getOsStatus };
