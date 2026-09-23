/**
 * Roda um "ensure table" uma vez por processo. Antes cada consulta disparava
 * CREATE TABLE/INDEX IF NOT EXISTS (+ ALTER) de novo = idas extras ao banco.
 * Se falhar, a próxima chamada tenta de novo.
 */
function once(fn) {
  let pending = null;
  return function runOnce() {
    if (!pending) {
      pending = Promise.resolve()
        .then(fn)
        .catch((e) => {
          pending = null;
          throw e;
        });
    }
    return pending;
  };
}

module.exports = { once };
