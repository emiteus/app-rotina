/**
 * Tool Registry API (Phase 3).
 */
const {
  TOOL_DEFS,
  needsApproval,
  MAX_TOOLS_PER_TURN,
  DEFAULT_TIMEOUT_MS
} = require('./definitions');

function getTool(name) {
  if (!name) return null;
  return TOOL_DEFS[String(name)] || null;
}

function hasTool(name) {
  return !!getTool(name);
}

function listToolNames() {
  return Object.keys(TOOL_DEFS).sort();
}

/** Catalog for planners / status — no secrets */
function getToolCatalog() {
  return listToolNames().map((name) => {
    const t = TOOL_DEFS[name];
    return {
      name,
      risk: t.risk,
      timeoutMs: t.timeoutMs,
      ownerOnly: !!t.ownerOnly,
      mutatesProjetos: !!t.mutatesProjetos,
      needsApproval: needsApproval(t.risk),
      description: t.description
    };
  });
}

function resolveToolMeta(name) {
  const t = getTool(name);
  if (t) {
    return {
      name,
      registered: true,
      risk: t.risk,
      timeoutMs: t.timeoutMs || DEFAULT_TIMEOUT_MS,
      ownerOnly: !!t.ownerOnly,
      mutatesProjetos: !!t.mutatesProjetos,
      needsApproval: needsApproval(t.risk),
      description: t.description
    };
  }
  return {
    name: name || 'desconhecido',
    registered: false,
    risk: 'medium',
    timeoutMs: DEFAULT_TIMEOUT_MS,
    ownerOnly: false,
    mutatesProjetos: false,
    needsApproval: false,
    description: 'tipo não registrado'
  };
}

module.exports = {
  getTool,
  hasTool,
  listToolNames,
  getToolCatalog,
  resolveToolMeta,
  needsApproval,
  MAX_TOOLS_PER_TURN,
  DEFAULT_TIMEOUT_MS,
  TOOL_DEFS
};
