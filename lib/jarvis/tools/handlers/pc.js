/**
 * Tools pc_* (Fase 2.6 MCU): a nuvem decide, o PC executa.
 * O comando vai pelo canal /jarvis-device pro Jarvis Desktop do próprio usuário,
 * que tem a SUA lista de tools aceitas e valida os argumentos de novo.
 */
const TYPES = new Set([
  'pc_status',
  'pc_volume',
  'pc_media',
  'pc_open_app',
  'pc_close_app',
  'pc_lock',
  'pc_screenshot'
]);

const APPS = [
  'spotify', 'chrome', 'vscode', 'explorer', 'notepad', 'calculadora', 'whatsapp', 'discord', 'obs', 'terminal'
];
const APP_ALIASES = {
  'vs code': 'vscode', code: 'vscode', 'visual studio code': 'vscode',
  calculator: 'calculadora', calc: 'calculadora',
  'bloco de notas': 'notepad', notas: 'notepad',
  'explorador': 'explorer', 'explorador de arquivos': 'explorer', arquivos: 'explorer',
  'google chrome': 'chrome', navegador: 'chrome',
  zap: 'whatsapp', 'whats app': 'whatsapp',
  cmd: 'terminal', powershell: 'terminal', 'prompt': 'terminal'
};

function normApp(v) {
  const k = String(v || '').toLowerCase().trim();
  const a = APP_ALIASES[k] || k;
  return APPS.includes(a) ? a : null;
}

/** Args limpos por tool — o que não bater vira erro aqui, antes de sair pro PC. */
function cleanArgs(tipo, acao) {
  if (tipo === 'pc_volume') {
    const op = String(acao.acao || acao.action || '').toLowerCase();
    if (!['up', 'down', 'mute', 'unmute', 'set'].includes(op)) throw new Error('acao: up | down | mute | unmute | set');
    const out = { acao: op };
    if (op === 'set') {
      const n = Number(acao.nivel ?? acao.level);
      if (!Number.isFinite(n) || n < 0 || n > 100) throw new Error('nivel 0–100');
      out.nivel = Math.round(n);
    }
    if (op === 'up' || op === 'down') {
      const p = Number(acao.passos ?? acao.steps ?? 5);
      out.passos = Math.max(1, Math.min(25, Math.round(Number.isFinite(p) ? p : 5)));
    }
    return out;
  }
  if (tipo === 'pc_media') {
    const op = String(acao.acao || acao.action || '').toLowerCase();
    if (!['play_pause', 'next', 'previous', 'stop'].includes(op)) throw new Error('acao: play_pause | next | previous | stop');
    return { acao: op };
  }
  if (tipo === 'pc_open_app' || tipo === 'pc_close_app') {
    const app = normApp(acao.app || acao.nome || acao.name);
    if (!app) throw new Error(`app fora da lista liberada (${APPS.join(', ')})`);
    return { app };
  }
  return {};
}

function summarize(tipo, args, result) {
  if (tipo === 'pc_volume') {
    return args.acao === 'set'
      ? `Volume do PC em ${args.nivel}%.`
      : args.acao === 'mute'
        ? 'PC no mudo.'
        : args.acao === 'unmute'
          ? 'Tirei o PC do mudo.'
          : args.acao === 'up'
            ? 'Aumentei o volume do PC.'
            : 'Baixei o volume do PC.';
  }
  if (tipo === 'pc_media') {
    return { play_pause: 'Play/pause no PC.', next: 'Próxima faixa.', previous: 'Faixa anterior.', stop: 'Parei a mídia.' }[args.acao];
  }
  if (tipo === 'pc_open_app') return `Abri ${args.app} no PC.`;
  if (tipo === 'pc_close_app') return `Fechei ${args.app} no PC.`;
  if (tipo === 'pc_lock') return 'Tela do PC bloqueada.';
  if (tipo === 'pc_screenshot') return 'Print da tela do PC.';
  if (tipo === 'pc_status' && result) {
    const r = result;
    const parts = [];
    if (r.memUsedPct != null) parts.push(`memória ${r.memUsedPct}%`);
    if (r.uptimeH != null) parts.push(`ligado há ${r.uptimeH}h`);
    if (r.battery) parts.push(`bateria ${r.battery.percent}%${r.battery.charging ? ' (carregando)' : ''}`);
    return `PC ${r.host || ''}: ${parts.join(', ') || 'ok'}.`.replace('PC :', 'PC:');
  }
  return 'Feito no PC.';
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
  const r = await requestTool(ctx.userId, tipo, args);
  if (!r.ok) return { tipo, ok: false, erro: r.erro || 'falhou no PC', uncertain: r.uncertain || undefined };
  const out = { tipo, ok: true, ...args, texto: summarize(tipo, args, r.result), device: r.deviceId };
  if (tipo === 'pc_status') out.status = r.result;
  if (tipo === 'pc_screenshot' && r.result && r.result.image_base64) {
    out.image_base64 = r.result.image_base64;
    out.mime = r.result.mime || 'image/png';
    out.caption = 'Tela do PC';
  }
  return out;
}

module.exports = { TYPES, APPS, handle, cleanArgs, normApp };
