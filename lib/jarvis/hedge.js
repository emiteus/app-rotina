/**
 * Pedido reserva ("hedged request") contra picos de latência do provedor.
 * Medido em 23/09/2026: o mesmo pedido ao Gemini leva ~1,5 s na maioria das vezes e,
 * sem motivo aparente, 13–80 s de vez em quando. Esperar o pico é o que deixa a voz lenta.
 *
 * Começa o 1º; se não voltar em `delayMs` (ou falhar/voltar vazio), começa o próximo em paralelo.
 * O primeiro resultado válido ganha e os outros são cancelados (AbortSignal).
 *
 * @param {Array<(signal: AbortSignal) => Promise<any>>} starters — resultado null/undefined = "não serviu"
 * @param {{ delayMs: number, onHedge?: (index: number) => void }} opts
 * @returns {Promise<any>} resultado do vencedor; rejeita com o último erro se todos falharem (null se só vazios)
 */
function hedge(starters, { delayMs, onHedge = null }) {
  return new Promise((resolve, reject) => {
    const ctrls = [];
    let next = 0;
    let running = 0;
    let settled = false;
    let lastErr = null;
    let timer = null;

    const finish = (fn, v) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      for (const c of ctrls) {
        try {
          c.abort();
        } catch (_) {
          /* já terminou */
        }
      }
      fn(v);
    };

    const launch = () => {
      if (settled || next >= starters.length) return;
      const i = next++;
      if (i > 0 && onHedge) onHedge(i);
      const ctrl = new AbortController();
      ctrls.push(ctrl);
      running += 1;
      clearTimeout(timer);
      if (next < starters.length) timer = setTimeout(launch, delayMs);
      Promise.resolve()
        .then(() => starters[i](ctrl.signal))
        .then(
          (r) => {
            running -= 1;
            if (r !== null && r !== undefined) return finish(resolve, r);
            afterMiss();
          },
          (e) => {
            running -= 1;
            lastErr = e;
            afterMiss();
          }
        );
    };

    // Um falhou: não espera o relógio pra tentar o próximo
    const afterMiss = () => {
      if (settled) return;
      if (next < starters.length) return launch();
      if (running === 0) finish(lastErr ? reject : resolve, lastErr || null);
    };

    if (!starters.length) return resolve(null);
    launch();
  });
}

module.exports = { hedge };
