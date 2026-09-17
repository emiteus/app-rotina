/** JARVIS public surface — Phase 1–3 */
module.exports = {
  runJarvisTurn: require('./core').runJarvisTurn,
  chamarIA: require('./ai-gateway').chamarIA,
  providerAtivo: require('./ai-gateway').providerAtivo,
  getCachedProjetos: require('./snapshot-cache').getCachedProjetos,
  invalidateProjetosCache: require('./snapshot-cache').invalidateProjetosCache,
  getToolCatalog: require('./tools/registry').getToolCatalog,
  listToolNames: require('./tools/registry').listToolNames,
  runToolBatch: require('./tools').runToolBatch
};
