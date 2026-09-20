const cinerush = require('./cinerush');

/** @type {Record<string, typeof cinerush>} */
const ADAPTERS = {
  cinerush
};

function getAdapter(name) {
  if (!name) return null;
  return ADAPTERS[name] || null;
}

module.exports = { getAdapter, ADAPTERS };
