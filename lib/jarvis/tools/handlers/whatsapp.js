/**
 * WhatsApp via Evolution — texto e arquivo (PC → WA).
 * Destino: dono (whitelist) ou alias em WHATSAPP_CONTACTS / WHATSAPP_GROUPS.
 * wa_send_owner = atalho que força o número do dono.
 */
const TYPES = new Set(['wa_send', 'wa_send_owner', 'wa_send_file']);
const MAX_CHARS = 1500;
const FETCH_TIMEOUT_MS = 90000;

const IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp']);
const VIDEO_EXT = new Set(['.mp4', '.mov', '.webm', '.m4v']);
const AUDIO_EXT = new Set(['.ogg', '.opus', '.mp3', '.m4a', '.wav']);

function extOf(name) {
  const m = String(name || '').toLowerCase().match(/(\.[a-z0-9]{1,8})$/);
  return m ? m[1] : '';
}

function mediaTypeFor(fileName, mime) {
  const e = extOf(fileName);
  if (IMAGE_EXT.has(e) || /^image\//i.test(mime || '')) return 'image';
  if (VIDEO_EXT.has(e) || /^video\//i.test(mime || '')) return 'video';
  if (AUDIO_EXT.has(e) || /^audio\//i.test(mime || '')) return 'audio';
  return 'document';
}

async function ensureOwner(ctx) {
  const { requireLib } = require('../../host');
  const { isPlanoOwnerUserId } = requireLib('plano-owner');
  return !!(await isPlanoOwnerUserId(ctx.userId));
}

function resolveDest(para, { forceOwner } = {}) {
  const { requireLib } = require('../../host');
  const { resolveWaDestination, phonesAllowed } = requireLib('evolution');
  if (forceOwner) {
    const phones = phonesAllowed();
    if (!phones.length) {
      return { ok: false, erro: 'nenhum número liberado (WHATSAPP_ALLOWED_PHONES)' };
    }
    return { ok: true, to: phones[0], label: 'você' };
  }
  return resolveWaDestination(para);
}

async function sendTextTo(dest, texto) {
  const { requireLib } = require('../../host');
  const { evolutionReady, sendText } = requireLib('evolution');
  if (!evolutionReady()) {
    return { ok: false, erro: 'WhatsApp do Jarvis (Evolution) não está pronto agora' };
  }
  await sendText(dest.to, texto);
  return { ok: true };
}

async function handleSendText(acao, ctx, { forceOwner } = {}) {
  const tipo = acao.tipo;
  if (!(await ensureOwner(ctx))) {
    return { tipo, ok: false, erro: 'só owner' };
  }
  const texto = String(acao.texto || acao.mensagem || acao.body || '')
    .replace(/\r\n/g, '\n')
    .trim()
    .slice(0, MAX_CHARS);
  if (texto.length < 2) {
    return { tipo, ok: false, erro: 'falta o texto pra mandar no WhatsApp' };
  }
  const dest = resolveDest(acao.para || acao.destino || acao.to, { forceOwner });
  if (!dest.ok) return { tipo, ok: false, erro: dest.erro };
  try {
    const r = await sendTextTo(dest, texto);
    if (!r.ok) return { tipo, ok: false, erro: r.erro };
    console.log(
      JSON.stringify({
        tag: 'jarvis.wa',
        event: 'send_text',
        userId: ctx.userId,
        chars: texto.length,
        para: dest.label
      })
    );
    const quem = dest.label === 'você' ? 'seu WhatsApp' : `WhatsApp de ${dest.label}`;
    return { tipo, ok: true, chars: texto.length, para: dest.label, texto: `Mandei no ${quem}.` };
  } catch (e) {
    return {
      tipo,
      ok: false,
      erro: String(e.message || e).slice(0, 200) || 'não consegui enviar no WhatsApp'
    };
  }
}

async function handleSendFile(acao, ctx) {
  const tipo = 'wa_send_file';
  if (!(await ensureOwner(ctx))) {
    return { tipo, ok: false, erro: 'só owner' };
  }
  const arquivo = String(acao.arquivo || acao.path || acao.caminho || '').trim();
  if (arquivo.length < 2) {
    return { tipo, ok: false, erro: 'falta o caminho do arquivo no PC' };
  }
  const dest = resolveDest(acao.para || acao.destino || acao.to);
  if (!dest.ok) return { tipo, ok: false, erro: dest.erro };

  const { requireLib } = require('../../host');
  const { evolutionReady, sendWhatsAppMedia } = requireLib('evolution');
  if (!evolutionReady()) {
    return { tipo, ok: false, erro: 'WhatsApp do Jarvis (Evolution) não está pronto agora' };
  }

  const { requestTool } = require('../../devices/gateway');
  const fetched = await requestTool(
    ctx.userId,
    'pc_files_fetch',
    { arquivo },
    { timeoutMs: FETCH_TIMEOUT_MS }
  );
  if (!fetched.ok) {
    return {
      tipo,
      ok: false,
      erro: fetched.erro || 'não consegui ler o arquivo no PC (PC online?)'
    };
  }
  const f = fetched.result || {};
  if (!f.base64) {
    return { tipo, ok: false, erro: 'o PC não mandou o arquivo' };
  }

  const fileName = String(f.fileName || f.name || 'arquivo').slice(0, 180);
  const mime = f.mime || 'application/octet-stream';
  const mediatype = mediaTypeFor(fileName, mime);
  const caption = String(acao.legenda || acao.caption || '')
    .trim()
    .slice(0, 900);

  try {
    await sendWhatsAppMedia(dest.to, f.base64, {
      mediatype,
      mime,
      fileName,
      caption
    });
    console.log(
      JSON.stringify({
        tag: 'jarvis.wa',
        event: 'send_file',
        userId: ctx.userId,
        fileName,
        mediatype,
        para: dest.label,
        bytes: f.size || null
      })
    );
    const quem = dest.label === 'você' ? 'seu WhatsApp' : `WhatsApp de ${dest.label}`;
    return {
      tipo,
      ok: true,
      arquivo: f.display || arquivo,
      para: dest.label,
      texto: `Mandei **${fileName}** no ${quem}.`
    };
  } catch (e) {
    return {
      tipo,
      ok: false,
      erro: String(e.message || e).slice(0, 200) || 'não consegui enviar o arquivo no WhatsApp'
    };
  }
}

async function handle(acao, ctx) {
  const tipo = acao && acao.tipo;
  if (!TYPES.has(tipo)) return null;
  if (tipo === 'wa_send_file') return handleSendFile(acao, ctx);
  if (tipo === 'wa_send_owner') return handleSendText(acao, ctx, { forceOwner: true });
  return handleSendText(acao, ctx, { forceOwner: false });
}

module.exports = {
  TYPES,
  handle,
  MAX_CHARS,
  mediaTypeFor,
  resolveDest
};
