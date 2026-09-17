/** JARVIS public surface — Phase 1–2 */
module.exports = {
  runJarvisTurn: require('./core').runJarvisTurn,
  chamarIA: require('./ai-gateway').chamarIA,
  providerAtivo: require('./ai-gateway').providerAtivo,
  getCachedProjetos: require('./snapshot-cache').getCachedProjetos,
  invalidateProjetosCache: require('./snapshot-cache').invalidateProjetosCache
};
