/**
 * Vigia de "está no ar?" (24/09/2026: a Hetzner suspendeu a VPS por pagamento pendente às 04:00 e
 * ninguém soube até a tarde — o WhatsApp do Jarvis e o cinerush.app ficaram fora o dia todo).
 * Cron de 5 min: testa cada endereço; 2 falhas seguidas = fora do ar → aviso (voz no PC /
 * notificação no celular, porque o WhatsApp pode ser justamente o que caiu). Lembra a cada 3 h e
 * avisa quando volta.
 */
const FAILS_TO_ALERT = 2;
const REMIND_MS = 3 * 60 * 60 * 1000;
const TIMEOUT_MS = 10000;

/** name -> { fails, down, alertedAt } (em memória: reinício do servidor zera, no pior caso repete 1 aviso) */
const state = new Map();

function targets() {
  const list = [];
  const evo = String(process.env.EVOLUTION_URL || '').trim();
  if (evo) list.push({ key: 'whatsapp', name: 'o WhatsApp do Jarvis', url: evo, host: 'vps' });
  const cr = String(process.env.JARVIS_UPTIME_CINERUSH_URL || 'https://cinerush.app/').trim();
  if (cr && process.env.JARVIS_UPTIME_CINERUSH !== '0') list.push({ key: 'cinerush', name: 'o cinerush.app', url: cr, host: 'vps' });
  // Attracione roda em outro projeto do Railway: aviso próprio, não entra no "VPS inteira"
  const at = String(process.env.JARVIS_UPTIME_ATTRACIONE_URL || 'https://www.attracionecomp.com.br/').trim();
  if (at && process.env.JARVIS_UPTIME_ATTRACIONE !== '0') list.push({ key: 'attracione', name: 'o site do Attracione', url: at, host: 'railway' });
  return list;
}

/** No ar = respondeu qualquer coisa abaixo de 500 dentro do prazo. */
async function isUp(url, fetchImpl = fetch) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const r = await fetchImpl(url, { method: 'GET', redirect: 'manual', signal: ctrl.signal });
    return r.status < 500;
  } catch (_) {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * @returns {Promise<Array<{ level: 'warn', type: string, text: string, speech: string }>>}
 */
async function checkUptime({ fetchImpl = fetch, now = Date.now, list = targets() } = {}) {
  if (process.env.JARVIS_UPTIME_WATCH === '0' || !list.length) return [];
  const t = now();
  const results = await Promise.all(list.map(async (x) => ({ ...x, up: await isUp(x.url, fetchImpl) })));

  const newlyDown = [];
  const remind = [];
  const back = [];
  for (const r of results) {
    const s = state.get(r.key) || { fails: 0, down: false, alertedAt: 0 };
    if (r.up) {
      if (s.down) back.push(r);
      state.set(r.key, { fails: 0, down: false, alertedAt: 0 });
      continue;
    }
    s.fails += 1;
    if (!s.down && s.fails >= FAILS_TO_ALERT) {
      s.down = true;
      s.alertedAt = t;
      newlyDown.push(r);
    } else if (s.down && t - s.alertedAt >= REMIND_MS) {
      s.alertedAt = t;
      remind.push(r);
    }
    state.set(r.key, s);
  }

  const notes = [];
  const allVps = list.filter((x) => x.host === 'vps');
  const downNow = [...newlyDown, ...remind];
  if (downNow.length) {
    const vpsInteira =
      allVps.length > 1 && allVps.every((x) => (state.get(x.key) || {}).down) && downNow.some((x) => x.host === 'vps');
    const lembrete = !newlyDown.length;
    if (vpsInteira) {
      notes.push({
        level: 'warn',
        type: 'uptime_vps_down',
        text:
          `⚠️ ${lembrete ? 'A VPS da Hetzner continua fora do ar' : 'A VPS da Hetzner está fora do ar'}: o WhatsApp do Jarvis e o cinerush.app estão sem acesso. ` +
          'Vale olhar o painel da Hetzner (pagamento pendente ou bloqueio).',
        speech: `${lembrete ? 'A VPS da Hetzner continua fora do ar.' : 'A VPS da Hetzner caiu.'} O WhatsApp e o CineRush estão sem acesso. Vale olhar o painel da Hetzner.`
      });
    }
    // Fora da VPS (ex.: Attracione no Railway) sempre tem aviso próprio
    for (const r of vpsInteira ? downNow.filter((x) => x.host !== 'vps') : downNow) {
      notes.push({
        level: 'warn',
        type: `uptime_${r.key}_down`,
        text: `⚠️ ${r.name.replace(/^o /, 'O ')} ${lembrete ? 'continua' : 'está'} fora do ar.`,
        speech: `${r.name.replace(/^o /, 'O ')} ${lembrete ? 'continua' : 'está'} fora do ar.`
      });
    }
  }
  if (back.length) {
    const nomes = back.map((r) => r.name).join(' e ');
    notes.push({
      level: 'warn',
      type: 'uptime_back',
      text: `✅ Voltou: ${nomes}.`,
      speech: `Boa notícia: ${nomes} ${back.length > 1 ? 'voltaram' : 'voltou'}.`
    });
  }
  return notes;
}

function _reset() {
  state.clear();
}

module.exports = { checkUptime, isUp, targets, FAILS_TO_ALERT, REMIND_MS, _reset };
