const cinerush = require('./cinerush');
const approtina = require('./approtina');

/** @type {Record<string, typeof cinerush>} */
const ADAPTERS = {
  cinerush,
  approtina
};

function getAdapter(name) {
  if (!name) return null;
  return ADAPTERS[name] || null;
}

module.exports = { getAdapter, ADAPTERS };
