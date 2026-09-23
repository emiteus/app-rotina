/**
 * Tools tv_* (Fase 3 MCU): TV LG da casa, controlada pelo Jarvis Desktop na rede local.
 * Mesmo caminho das pc_*: servidor limpa os args → /jarvis-device → o PC revalida e fala com a TV.
 * A chave da TV fica só no PC; o servidor nunca vê nem o IP dela.
 */
const TYPES = new Set([
  'tv_status',
  'tv_power',
  'tv_volume',
  'tv_media',
  'tv_key',
  'tv_open_app',
  'tv_input',
  'tv_notify',
  'tv_pair'
]);

// Ligar a TV espera o boot; parear espera alguém aceitar na tela
const TIMEOUTS = { tv_power: 35000, tv_pair: 80000 };

const MEDIA = ['play', 'pause', 'stop', 'rewind', 'fast_forward'];
const MEDIA_ALIASES = {
  play_pause: 'play', continuar: 'play', tocar: 'play', pausar: 'pause', pausa: 'pause', parar: 'stop',
  voltar: 'rewind', retroceder: 'rewind', avancar: 'fast_forward', adiantar: 'fast_forward', fastforward: 'fast_forward'
};

const KEYS = [
  'HOME', 'BACK', 'EXIT', 'UP', 'DOWN', 'LEFT', 'RIGHT', 'ENTER', 'INFO', 'MENU',
  'CHANNELUP', 'CHANNELDOWN', 'RED', 'GREEN', 'YELLOW', 'BLUE'
];
const KEY_ALIASES = {
  inicio: 'HOME', home: 'HOME', voltar: 'BACK', sair: 'EXIT',
  cima: 'UP', baixo: 'DOWN', esquerda: 'LEFT', direita: 'RIGHT',
  ok: 'ENTER', confirmar: 'ENTER', selecionar: 'ENTER', enter: 'ENTER',
  'canal+': 'CHANNELUP', 'canal-': 'CHANNELDOWN', 'proximo canal': 'CHANNELUP', 'canal anterior': 'CHANNELDOWN',
  vermelho: 'RED', verde: 'GREEN', amarelo: 'YELLOW', azul: 'BLUE'
};

const APP_ALIASES = {
  'prime video': 'prime', amazon: 'prime', 'amazon prime': 'prime',
  'disney+': 'disney', 'disney plus': 'disney',
  hbo: 'max', 'hbo max': 'max',
  'globo play': 'globoplay', globo: 'globoplay',
  'you tube': 'youtube', yt: 'youtube',
  browser: 'navegador', internet: 'navegador',
  'tv aberta': 'tv', 'tv ao vivo': 'tv', antena: 'tv', canais: 'tv'
};

const fold = (s) =>
  String(s || '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .trim();

function cleanArgs(tipo, acao) {
  const op = fold(acao.acao || acao.action);
  if (tipo === 'tv_power') {
    const v = { ligar: 'on', liga: 'on', desligar: 'off', desliga: 'off' }[op] || op;
    if (!['on', 'off'].includes(v)) throw new Error('acao: on | off');
    return { acao: v };
  }
  if (tipo === 'tv_volume') {
    if (!['up', 'down', 'mute', 'unmute', 'set'].includes(op)) throw new Error('acao: up | down | mute | unmute | set');
    const out = { acao: op };
    if (op === 'set') {
      const n = Number(acao.nivel ?? acao.level);
      if (!Number.isFinite(n) || n < 0 || n > 100) throw new Error('nivel 0–100');
      out.nivel = Math.round(n);
    }
    if (op === 'up' || op === 'down') {
      const p = Number(acao.passos ?? acao.steps ?? 3);
      out.passos = Math.max(1, Math.min(20, Math.round(Number.isFinite(p) ? p : 3)));
    }
    return out;
  }
  if (tipo === 'tv_media') {
    const v = MEDIA_ALIASES[op] || op;
    if (!MEDIA.includes(v)) throw new Error(`acao: ${MEDIA.join(' | ')}`);
    return { acao: v };
  }
  if (tipo === 'tv_key') {
    const raw = String(acao.tecla || acao.key || '').trim();
    const k = KEY_ALIASES[fold(raw)] || raw.toUpperCase();
    if (!KEYS.includes(k)) throw new Error(`tecla: ${KEYS.join(', ')}`);
    return { tecla: k };
  }
  if (tipo === 'tv_open_app') {
    const raw = fold(acao.app || acao.nome || acao.name).replace(/\s+/g, ' ');
    const app = APP_ALIASES[raw] || raw;
    if (!/^[\p{L}\p{N} +.&'!-]{1,40}$/u.test(app)) throw new Error('nome de app inválido');
    return { app };
  }
  if (tipo === 'tv_input') {
    const m = fold(acao.entrada || acao.input).match(/^hdmi[\s_-]*([1-4])$/);
    if (!m) throw new Error('entrada: hdmi1…hdmi4');
    return { entrada: `HDMI_${m[1]}` };
  }
  if (tipo === 'tv_notify') {
    const t = String(acao.texto || acao.text || '').replace(/[\u0000-\u001f]/g, ' ').trim();
    if (!t) throw new Error('texto vazio');
    return { texto: t.slice(0, 200) };
  }
  return {};
}

function summarize(tipo, args, r = {}) {
  if (tipo === 'tv_power') {
    if (r.already) return args.acao === 'on' ? 'A TV já está ligada.' : 'A TV já está desligada.';
    return args.acao === 'on' ? 'Liguei a TV.' : 'Desliguei a TV.';
  }
  if (tipo === 'tv_volume') {
    const nivel = Number.isFinite(r.volume) ? ` (${r.volume})` : '';
    return {
      set: `Volume da TV em ${args.nivel}.`,
      mute: 'TV no mudo.',
      unmute: 'Tirei a TV do mudo.',
      up: `Aumentei o volume da TV${nivel}.`,
      down: `Baixei o volume da TV${nivel}.`
    }[args.acao];
  }
  if (tipo === 'tv_media') {
    return { play: 'Play na TV.', pause: 'Pausei a TV.', stop: 'Parei a TV.', rewind: 'Voltando na TV.', fast_forward: 'Avançando na TV.' }[args.acao];
  }
  if (tipo === 'tv_key') return `Apertei ${args.tecla} no controle da TV.`;
  if (tipo === 'tv_open_app') return `Abri ${r.app || args.app} na TV.`;
  if (tipo === 'tv_input') return `TV na entrada ${args.entrada.replace('_', ' ')}.`;
  if (tipo === 'tv_notify') return 'Mandei o aviso pra tela da TV.';
  if (tipo === 'tv_pair') return `TV conectada: ${r.name || 'TV LG'}.`;
  if (tipo === 'tv_status') {
    if (!r.paired) return 'Nenhuma TV conectada ao PC ainda. Com ela ligada, diga "conecta na TV".';
    if (!r.on) return `A ${r.name || 'TV'} está desligada.`;
    const parts = [];
    if (r.app) parts.push(`em ${r.app}`);
    if (Number.isFinite(r.volume)) parts.push(`volume ${r.volume}${r.mute ? ' (mudo)' : ''}`);
    return `A ${r.name || 'TV'} está ligada${parts.length ? `, ${parts.join(', ')}` : ''}.`;
  }
  return 'Feito na TV.';
}

async function handle(acao, ctx) {
  const tipo = acao && acao.tipo;
  if (!TYPES.has(tipo)) return null;
  let args;
  try {
    args = cleanArgs(tipo, acao);
  } catch (e) {
    return { tipo, ok: false, erro: e.message };
  }
  const { requestTool } = require('../../devices/gateway');
  const r = await requestTool(ctx.userId, tipo, args, TIMEOUTS[tipo] ? { timeoutMs: TIMEOUTS[tipo] } : undefined);
  if (!r.ok) {
    const erro = /nenhum PC/.test(r.erro || '') ? 'a TV é controlada pelo Jarvis Desktop, e nenhum PC está online agora' : r.erro || 'falhou na TV';
    return { tipo, ok: false, erro, uncertain: r.uncertain || undefined };
  }
  const out = { tipo, ok: true, ...args, texto: summarize(tipo, args, r.result || {}), device: r.deviceId };
  if (tipo === 'tv_status') out.status = r.result;
  return out;
}

module.exports = { TYPES, handle, cleanArgs, summarize };
