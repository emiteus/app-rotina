/**
 * Tools pc_* (Fase 2.6/2.7 MCU): a nuvem decide, o PC executa.
 * O comando vai pelo canal /jarvis-device pro Jarvis Desktop do próprio usuário,
 * que tem a SUA lista de tools aceitas e valida os argumentos de novo.
 * Arquivos (2.7): só leitura no PC; a resposta sai do modelo com o conteúdo isolado como CONTEÚDO EXTERNO.
 */
const TYPES = new Set([
  'pc_status',
  'pc_volume',
  'pc_media',
  'pc_open_app',
  'pc_close_app',
  'pc_lock',
  'pc_screenshot',
  'pc_screen_look',
  'pc_close_tab',
  'pc_spotify_play',
  'pc_spotify_now',
  'pc_youtube_play',
  'pc_open_url',
  'pc_files_list',
  'pc_files_search',
  'pc_files_read',
  'pc_open_path',
  'pc_download'
]);

// Spotify pode ter que abrir o app; busca de arquivo varre pastas
const TIMEOUTS = { pc_download: 15 * 60 * 1000, pc_spotify_play: 30000, pc_files_search: 25000, pc_youtube_play: 25000, pc_screen_look: 20000 };

const APPS = [
  'spotify', 'chrome', 'vscode', 'explorer', 'notepad', 'calculadora', 'whatsapp', 'discord', 'obs', 'terminal',
  'cursor', 'opera', 'steam', 'cs2'
];
const APP_ALIASES = {
  'vs code': 'vscode', code: 'vscode', 'visual studio code': 'vscode',
  calculator: 'calculadora', calc: 'calculadora',
  'bloco de notas': 'notepad', notas: 'notepad',
  'explorador': 'explorer', 'explorador de arquivos': 'explorer', arquivos: 'explorer',
  'google chrome': 'chrome', navegador: 'chrome',
  zap: 'whatsapp', 'whats app': 'whatsapp',
  cmd: 'terminal', powershell: 'terminal', 'prompt': 'terminal',
  'cursor ai': 'cursor', 'opera gx': 'opera', 'navegador opera': 'opera',
  'counter strike': 'cs2', 'counter-strike': 'cs2', 'counter strike 2': 'cs2', 'cs 2': 'cs2', cs: 'cs2', csgo: 'cs2', 'cs go': 'cs2'
};

// "abre o youtube" → URL. Outro domínio qualquer vira https://dominio
const SITES = {
  youtube: 'https://www.youtube.com',
  gmail: 'https://mail.google.com',
  email: 'https://mail.google.com',
  drive: 'https://drive.google.com',
  'google drive': 'https://drive.google.com',
  agenda: 'https://calendar.google.com',
  'google agenda': 'https://calendar.google.com',
  google: 'https://www.google.com',
  netflix: 'https://www.netflix.com',
  instagram: 'https://www.instagram.com',
  tiktok: 'https://www.tiktok.com',
  twitter: 'https://x.com',
  x: 'https://x.com',
  facebook: 'https://www.facebook.com',
  github: 'https://github.com',
  chatgpt: 'https://chatgpt.com',
  claude: 'https://claude.ai',
  'whatsapp web': 'https://web.whatsapp.com',
  notion: 'https://www.notion.so',
  railway: 'https://railway.com/dashboard',
  twitch: 'https://www.twitch.tv',
  'mercado livre': 'https://www.mercadolivre.com.br',
  'app rotina': 'https://app-rotina-production-f84e.up.railway.app'
};

const fold = (s) =>
  String(s || '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .trim();

function normApp(v) {
  const k = String(v || '').toLowerCase().trim();
  const a = APP_ALIASES[k] || k;
  return APPS.includes(a) ? a : null;
}

function siteUrl(v) {
  const raw = String(v || '').trim();
  const k = fold(raw).replace(/^(o|a|site d[oa])\s+/, '');
  if (SITES[k]) return SITES[k];
  let href = raw;
  if (!/^[a-z][a-z0-9+.-]*:/i.test(href)) {
    if (!/^[\w-]+(\.[\w-]+)+(\/\S*)?$/.test(href)) throw new Error('site não reconhecido: mande o endereço (ex.: youtube.com)');
    href = `https://${href}`;
  }
  let u;
  try {
    u = new URL(href);
  } catch {
    throw new Error('URL inválida');
  }
  if (!/^https?:$/.test(u.protocol)) throw new Error('só abro links http/https');
  if (u.username || u.password) throw new Error('URL com usuário/senha não');
  return u.href;
}

function texto(v, max, campo) {
  const t = String(v || '').replace(/[\x00-\x1f]/g, ' ').trim();
  if (!t) throw new Error(`${campo} vazio`);
  return t.slice(0, max);
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
  if (tipo === 'pc_spotify_play') {
    const t = fold(acao.tipo_busca || acao.categoria || acao.kind || '').replace(/\s+/g, '_');
    const map = {
      musica: 'track', track: 'track', artista: 'artist', artist: 'artist', album: 'album', playlist: 'playlist',
      curtidas: 'curtidas', favoritas: 'curtidas', liked: 'curtidas', liked_songs: 'curtidas',
      mais_ouvidas: 'mais_ouvidas', mais_tocadas: 'mais_ouvidas', top: 'mais_ouvidas'
    };
    const tp = map[t] || 'auto';
    if (tp === 'curtidas' || tp === 'mais_ouvidas') return { busca: '', tipo: tp };
    return { busca: texto(acao.busca || acao.query || acao.q, 120, 'busca'), tipo: tp };
  }
  if (tipo === 'pc_youtube_play') return { busca: texto(acao.busca || acao.query || acao.q, 120, 'busca') };
  if (tipo === 'pc_open_url') return { url: siteUrl(acao.url || acao.site) };
  if (tipo === 'pc_files_list') return { pasta: texto(acao.pasta || acao.path, 300, 'pasta') };
  if (tipo === 'pc_files_search') {
    const out = { nome: texto(acao.nome || acao.name, 80, 'nome') };
    if (acao.pasta) out.pasta = texto(acao.pasta, 300, 'pasta');
    return out;
  }
  if (tipo === 'pc_files_read') return { arquivo: texto(acao.arquivo || acao.path, 300, 'arquivo') };
  if (tipo === 'pc_open_path') return { caminho: texto(acao.caminho || acao.path || acao.pasta, 300, 'caminho') };
  if (tipo === 'pc_download') {
    // Links soltos, lista ou texto com links (share do Kwai/Instagram vem com legenda junto)
    const bruto = [acao.urls, acao.url, acao.links, acao.link].flat().filter(Boolean).join(' ');
    const urls = [...new Set((bruto.match(/https?:\/\/[^\s<>"']+/g) || []).map((u) => u.replace(/[),.;\]]+$/, '')))].slice(0, 20);
    if (!urls.length) throw new Error('manda o link do vídeo/arquivo');
    const out = { urls, formato: /mp3|audio|áudio|musica|música/i.test(String(acao.formato || '')) ? 'mp3' : 'mp4' };
    if (acao.nome) out.nome = texto(acao.nome, 120, 'nome');
    if (acao.pasta) out.pasta = texto(acao.pasta, 300, 'pasta');
    return out;
  }
  // A pergunta fica no servidor: o PC só manda o print
  if (tipo === 'pc_screen_look') return {};
  if (tipo === 'pc_close_tab') {
    const aba = String(acao.aba || acao.titulo || acao.site || acao.nome || '').trim();
    // "fecha essa aba" chegava como aba "aba"/"essa" e ele procurava uma aba com esse nome (25/09)
    if (!aba || /^(a\s+)?(essa|esta|isso|atual|aqui|aba|essa\s+aba|esta\s+aba|aba\s+atual|this|current)$/i.test(aba)) {
      return { aba: '@atual' };
    }
    return { aba: texto(aba, 80, 'aba') };
  }
  return {};
}

const kb = (n) => (n == null ? '' : n < 1024 ? `${n} B` : n < 1048576 ? `${Math.round(n / 1024)} KB` : `${(n / 1048576).toFixed(1)} MB`);
const dia = (iso) => (iso ? new Date(iso).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : '');

/** Dados do PC em texto (vão pro modelo como CONTEÚDO EXTERNO, nunca como instrução). */
function filesDigest(tipo, r) {
  if (tipo === 'pc_files_list') {
    const lines = (r.items || []).map((i) => `${i.dir ? '[pasta] ' : ''}${i.name}${i.dir ? '' : ` (${kb(i.size)}, ${dia(i.mtime)})`}`);
    return `Pasta ${r.pasta}: ${r.total} itens${r.truncated ? ' (mostrando 200)' : ''}\n${lines.join('\n')}`;
  }
  if (tipo === 'pc_files_search') {
    const lines = (r.hits || []).map((h) => `${h.dir ? '[pasta] ' : ''}${h.path}${h.dir ? '' : ` (${kb(h.size)}, ${dia(h.mtime)})`}`);
    return `Busca "${r.nome}" em ${r.pasta}: ${lines.length} resultado(s)${r.incomplete ? ' (busca parcial)' : ''}\n${lines.join('\n')}`;
  }
  return `Arquivo ${r.arquivo} (${kb(r.size)}, ${dia(r.mtime)})${r.truncated ? ' (trecho inicial)' : ''}\n${r.content || ''}`;
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
  if (tipo === 'pc_close_tab' && result) return `Fechei a aba "${String(result.titulo || args.aba).replace(/ [-–—] (Google Chrome|Opera|Microsoft​? Edge|Brave|Mozilla Firefox)$/i, '')}".`;
  if (tipo === 'pc_spotify_play' && result) {
    if (result.tipo === 'curtidas' || result.tipo === 'mais_ouvidas') {
      return `Tocando ${result.nome} no Spotify (${result.total} músicas), começando por ${result.primeira}.`;
    }
    const what = { artist: 'o artista ', album: 'o álbum ', playlist: 'a playlist ' }[result.tipo] || '';
    return `Tocando ${what}${result.nome} no Spotify.`;
  }
  if (tipo === 'pc_spotify_now' && result) {
    if (!result.nome) return 'Nada tocando no Spotify agora.';
    return `${result.tocando ? 'Tocando' : 'Pausado'}: ${result.nome} — ${result.artistas}.`;
  }
  if (tipo === 'pc_youtube_play' && result) {
    return result.video ? `Abri no YouTube: ${result.titulo || args.busca}.` : `Abri a busca "${args.busca}" no YouTube.`;
  }
  if (tipo === 'pc_open_url') return `Abri ${new URL(args.url).hostname.replace(/^www\./, '')} no navegador.`;
  if (tipo === 'pc_open_path' && result) return `Abri ${result.caminho}.`;
  if (tipo === 'pc_download' && result) {
    const ok = result.baixados || [];
    const ruim = result.falhas || [];
    const lista = ok.slice(0, 8).map((b) => `• ${b.titulo}`).join('\n');
    return (
      (ok.length ? `Baixei ${ok.length} em ${result.pasta}:\n${lista}` : 'Não baixei nada.') +
      (ruim.length ? `\n${ruim.length} não deu: ${ruim.slice(0, 5).map((f) => `${f.erro}`).join('; ')}` : '')
    );
  }

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
  const r = await requestTool(ctx.userId, tipo, args, TIMEOUTS[tipo] ? { timeoutMs: TIMEOUTS[tipo] } : undefined);
  if (!r.ok) return { tipo, ok: false, erro: r.erro || 'falhou no PC', uncertain: r.uncertain || undefined };

  // Fase 5.4: olha a tela e responde a pergunta (o print não entra na conversa)
  if (tipo === 'pc_screen_look') {
    const img = r.result || {};
    if (!img.image_base64) return { tipo, ok: false, erro: 'o PC não mandou o print da tela' };
    const look = ctx.lookAtScreen || require('../../multimodal/screen-look').lookAtScreen;
    const texto = await look({ base64: img.image_base64, mime: img.mime, pergunta: acao.pergunta || acao.question }).catch(() => null);
    if (!texto) return { tipo, ok: false, erro: 'não consegui entender a tela agora' };
    return { tipo, ok: true, texto, device: r.deviceId };
  }

  if (/^pc_files_/.test(tipo)) {
    const { isolatedAnswer } = require('./data-answer');
    const texto = await isolatedAnswer({
      pergunta: acao.pergunta || acao.question,
      digest: filesDigest(tipo, r.result || {}),
      source: 'pc',
      what: 'arquivos do PC do usuário',
      chamarIA: ctx.chamarIA
    });
    return { tipo, ok: true, ...args, texto, device: r.deviceId };
  }

  const out = { tipo, ok: true, ...args, texto: summarize(tipo, args, r.result), device: r.deviceId };
  if (tipo === 'pc_status') out.status = r.result;
  if (tipo === 'pc_screenshot' && r.result && r.result.image_base64) {
    out.image_base64 = r.result.image_base64;
    out.mime = r.result.mime || 'image/png';
    out.caption = 'Tela do PC';
  }
  return out;
}

module.exports = { TYPES, APPS, handle, cleanArgs, normApp, siteUrl, filesDigest };
