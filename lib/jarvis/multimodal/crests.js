/**
 * @deprecated Use multimodal/visual-assets.js — resolução genérica via Commons search.
 * Mantido como fachada pra não quebrar requires antigos.
 */
const {
  parseReplacePair,
  searchCommonsAsset,
  fetchCommonsFile,
  resolveVisualAssets,
  scoreCommonsTitle,
  normText
} = require('./visual-assets');

/** @deprecated */
function parseCrestSwapRequest(mensagem) {
  const pair = parseReplacePair(mensagem);
  if (!pair) return null;
  return {
    left: { name: pair.left, key: normText(pair.left) },
    right: { name: pair.right, key: normText(pair.right) },
    raw: pair.raw,
    unresolved: false
  };
}

/** @deprecated — sem catálogo; só ecoa o nome. */
function lookupCrest(rawName) {
  const name = String(rawName || '').trim();
  if (!name) return null;
  return { name, key: normText(name), file: null };
}

async function resolveCrestAssets(mensagem) {
  const out = await resolveVisualAssets(mensagem);
  return {
    swap: out.pair
      ? {
          left: { name: out.pair.left },
          right: { name: out.pair.right },
          raw: out.pair.raw,
          unresolved: !!out.unresolved
        }
      : null,
    assets: out.assets || []
  };
}

module.exports = {
  parseCrestSwapRequest,
  lookupCrest,
  resolveCrestAssets,
  parseReplacePair,
  searchCommonsAsset,
  fetchCommonsFile,
  resolveVisualAssets,
  scoreCommonsTitle,
  normText,
  /** removido de propósito — sem gambiarra de catálogo */
  CREST_BY_ALIAS: Object.freeze({})
};
