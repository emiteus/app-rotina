/** JARVIS public surface — Phase 1–6 */
module.exports = {
  runJarvisTurn: require('./core').runJarvisTurn,
  chamarIA: require('./ai-gateway').chamarIA,
  providerAtivo: require('./ai-gateway').providerAtivo,
  getCachedProjetos: require('./snapshot-cache').getCachedProjetos,
  getCachedAssistSnap: require('./snapshot-cache').getCachedAssistSnap,
  invalidateProjetosCache: require('./snapshot-cache').invalidateProjetosCache,
  invalidateAssistCache: require('./snapshot-cache').invalidateAssistCache,
  getToolCatalog: require('./tools/registry').getToolCatalog,
  listToolNames: require('./tools/registry').listToolNames,
  runToolBatch: require('./tools').runToolBatch,
  packContext: require('./context/pack').packContext,
  detectIntent: require('./context/intent').detectIntent,
  hitlEnabled: require('./permissions/engine').hitlEnabled,
  parseApprovalReply: require('./permissions/engine').parseApprovalReply,
  tryHandleApprovalReply: require('./permissions/engine').tryHandleApprovalReply,
  getRegistryStatus: require('./projects/registry').getRegistryStatus,
  resolveProject: require('./projects/registry').resolveProject,
  resolveProjectsFromMessage: require('./projects/registry').resolveProjectsFromMessage,
  loadAllProjectSnapshots: require('./projects/registry').loadAllProjectSnapshots
};
