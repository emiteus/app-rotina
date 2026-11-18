/**
 * Tools home_* — luzes da casa (Tuya / Neo Avant) pelo Jarvis Desktop.
 */
const TYPES = new Set(['home_status', 'home_sync', 'home_light']);
const TIMEOUTS = { home_sync: 50000, home_light: 35000, home_status: 50000 };

const fold = (s) =>
  String(s || '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .trim();

const CORES = new Set([
  'vermelho', 'laranja', 'amarelo', 'verde', 'ciano', 'azul', 'roxo', 'rosa', 'magenta', 'branco'
]);

function cleanArgs(tipo, acao) {
  if (tipo === 'home_status' || tipo === 'home_sync') return {};
  const out = {};
  if (acao.nome || acao.name) out.nome = String(acao.nome || acao.name).slice(0, 60);
  if (acao.id) out.id = String(acao.id).slice(0, 64);
  const op = fold(acao.acao || acao.action || '');
  const map = {
    ligar: 'on',
    liga: 'on',
    on: 'on',
    desligar: 'off',
    desliga: 'off',
    off: 'off',
    set: 'set',
    cor: 'set',
    brilho: 'set'
  };
  if (op && map[op]) out.acao = map[op];
  else if (acao.cor != null || acao.brilho != null || acao.temp != null) out.acao = 'set';
  else throw new Error('acao: on | off | set');

  if (acao.cor != null) {
    const cor = fold(acao.cor);
    if (CORES.has(cor)) out.cor = cor;
    else if (/^#?[0-9a-f]{6}$/i.test(String(acao.cor).trim())) out.cor = String(acao.cor).trim();
    else throw new Error('cor inválida');
  }
  if (acao.brilho != null) {
    const b = Number(acao.brilho);
    if (!Number.isFinite(b) || b < 0 || b > 100) throw new Error('brilho 0–100');
    out.brilho = Math.round(b);
  }
  if (acao.temp != null) {
    const t = Number(acao.temp);
    if (!Number.isFinite(t) || t < 0 || t > 100) throw new Error('temp 0–100');
    out.temp = Math.round(t);
  }
  return out;
}

function summarize(tipo, args, r = {}) {
  if (tipo === 'home_sync') {
    const n = (r.luzes && r.luzes.length) || 0;
    return n ? `Sincronizei a casa: ${n} lâmpada(s).` : 'Sincronizei, mas não achei lâmpada na conta Tuya.';
  }
  if (tipo === 'home_status') {
    if (!r.conectado) return 'A casa ainda não está conectada neste PC (Ajustes → Casa).';
    const luzes = r.luzes || [];
    if (!luzes.length) return 'Conta Tuya conectada, mas sem lâmpadas — diga "sincroniza a casa".';
    return `Lâmpadas: ${luzes.map((l) => l.nome).join(', ')}.`;
  }
  if (tipo === 'home_light') {
    const nome = r.nome || args.nome || 'lâmpada';
    if (args.acao === 'on') return `Liguei a ${nome}.`;
    if (args.acao === 'off') return `Apaguei a ${nome}.`;
    const bits = [];
    if (args.cor) bits.push(args.cor);
    if (args.brilho != null) bits.push(`brilho ${args.brilho}%`);
    if (args.temp != null) bits.push(`temperatura ${args.temp}`);
    return bits.length ? `${nome}: ${bits.join(', ')}.` : `Ajustei a ${nome}.`;
  }
  return 'Feito na casa.';
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
    const erro = /nenhum PC/.test(r.erro || '')
      ? 'a casa é controlada pelo Jarvis Desktop, e nenhum PC está online agora'
      : r.erro || 'falhou na casa';
    return { tipo, ok: false, erro, uncertain: r.uncertain || undefined };
  }
  const out = { tipo, ok: true, ...args, texto: summarize(tipo, args, r.result || {}), device: r.deviceId };
  if (tipo === 'home_status' || tipo === 'home_sync') out.status = r.result;
  return out;
}

module.exports = { handle, TYPES };
