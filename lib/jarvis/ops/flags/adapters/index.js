const cinerush = require('./cinerush');
const approtina = require('./approtina');
const socialhub = require('./socialhub');

/** @type {Record<string, typeof cinerush>} */
const ADAPTERS = {
  cinerush,
  approtina,
  socialhub
};

function getAdapter(name) {
  if (!name) return null;
  return ADAPTERS[name] || null;
}

module.exports = { getAdapter, ADAPTERS };
