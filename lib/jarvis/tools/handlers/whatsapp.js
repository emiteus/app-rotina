/**
 * WhatsApp via Evolution — texto e arquivo (PC → WA).
 * Destinos: dono, contatos/grupos do env, ou aprendidos (jarvis_wa_contacts).
 */
const TYPES = new Set([
  'wa_send',
  'wa_send_owner',
  'wa_send_file',
  'wa_contact_set',
  'wa_contact_list',
  'wa_contact_forget'
]);
const MAX_CHARS = 1500;
const FETCH_TIMEOUT_MS = 90000;
const MAX_FOLDER_FILES = 15;

const IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp']);
const VIDEO_EXT = new Set(['.mp4', '.mov', '.webm', '.m4v']);
const AUDIO_EXT = new Set(['.ogg', '.opus', '.mp3', '.m4a', '.wav']);
const SKIP_SEND_EXT = new Set(['.lnk', '.url', '.exe', '.bat', '.cmd', '.ps1', '.msi', '.dll', '.sys']);

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

async function resolveDest(ctx, para, { forceOwner, phoneHint } = {}) {
  const contacts = require('../../memory/wa-contacts');
  if (forceOwner) {
    return contacts.resolveDestination(ctx.userId, 'eu');
  }
  return contacts.resolveDestination(ctx.userId, para, { phoneHint, remember: true });
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
  const dest = await resolveDest(ctx, acao.para || acao.destino || acao.to, {
    forceOwner,
    phoneHint: acao.numero || acao.phone || acao.telefone || null
  });
  if (!dest.ok) return { tipo, ok: false, erro: dest.erro };

  try {
    const { requireLib } = require('../../host');
    const { evolutionReady, sendText } = requireLib('evolution');
    if (!evolutionReady()) {
      return { tipo, ok: false, erro: 'WhatsApp do Jarvis (Evolution) não está pronto agora' };
    }
    await sendText(dest.to, texto);
    console.log(
      JSON.stringify({
        tag: 'jarvis.wa',
        event: 'send_text',
        userId: ctx.userId,
        chars: texto.length,
        para: dest.label,
        learned: !!dest.learned
      })
    );
    const quem = dest.label === 'você' ? 'seu WhatsApp' : `WhatsApp de ${dest.label}`;
    let msg = `Mandei no ${quem}.`;
    if (dest.textoExtra) msg = `${msg} ${dest.textoExtra}`;
    return { tipo, ok: true, chars: texto.length, para: dest.label, texto: msg };
  } catch (e) {
    return {
      tipo,
      ok: false,
      erro: String(e.message || e).slice(0, 200) || 'não consegui enviar no WhatsApp'
    };
  }
}

function joinPcPath(pastaDisplay, name) {
  const base = String(pastaDisplay || '')
    .replace(/[/\\]+$/, '')
    .trim();
  const n = String(name || '').trim();
  if (!base) return n;
  return `${base}\\${n}`;
}

/** "desktop/pasta 1" (erro comum) → "desktop/1" */
function normalizeFolderHint(raw) {
  return String(raw || '')
    .trim()
    .replace(/\\/g, '/')
    .replace(/\/pasta\s+/gi, '/')
    .replace(/\/+$/, '');
}

async function sendFetchedMedia(dest, f, caption) {
  const { requireLib } = require('../../host');
  const { sendWhatsAppMedia } = requireLib('evolution');
  const fileName = String(f.fileName || f.name || 'arquivo').slice(0, 180);
  const mime = f.mime || 'application/octet-stream';
  const mediatype = mediaTypeFor(fileName, mime);
  await sendWhatsAppMedia(dest.to, f.base64, {
    mediatype,
    mime,
    fileName,
    caption: caption || ''
  });
  return { fileName, mediatype, bytes: f.size || null, display: f.display };
}

async function handleSendFolder(acao, ctx, pastaRaw, dest) {
  const tipo = 'wa_send_file';
  const pasta = normalizeFolderHint(pastaRaw);
  if (pasta.length < 2) {
    return { tipo, ok: false, erro: 'falta a pasta no PC' };
  }
  const { requestTool } = require('../../devices/gateway');
  const listed = await requestTool(
    ctx.userId,
    'pc_files_list',
    { pasta },
    { timeoutMs: 30000 }
  );
  if (!listed.ok) {
    return {
      tipo,
      ok: false,
      erro: listed.erro || 'não consegui listar a pasta no PC (PC online?)'
    };
  }
  const info = listed.result || {};
  const items = (info.items || []).filter(
    (it) =>
      it &&
      !it.dir &&
      it.name &&
      !SKIP_SEND_EXT.has(extOf(it.name)) &&
      (it.size == null || it.size > 0)
  );
  if (!items.length) {
    return {
      tipo,
      ok: false,
      erro: `a pasta ${info.pasta || pasta} não tem arquivo pra mandar`
    };
  }
  const batch = items.slice(0, MAX_FOLDER_FILES);
  const caption = String(acao.legenda || acao.caption || '')
    .trim()
    .slice(0, 900);
  const okNames = [];
  const erros = [];
  for (const it of batch) {
    const arquivo = joinPcPath(info.pasta || pasta, it.name);
    const fetched = await requestTool(
      ctx.userId,
      'pc_files_fetch',
      { arquivo },
      { timeoutMs: FETCH_TIMEOUT_MS }
    );
    if (!fetched.ok || !(fetched.result && fetched.result.base64)) {
      erros.push(`${it.name}: ${fetched.erro || 'falhou'}`);
      continue;
    }
    try {
      const sent = await sendFetchedMedia(
        dest,
        fetched.result,
        okNames.length === 0 ? caption : ''
      );
      okNames.push(sent.fileName);
      console.log(
        JSON.stringify({
          tag: 'jarvis.wa',
          event: 'send_file',
          userId: ctx.userId,
          fileName: sent.fileName,
          mediatype: sent.mediatype,
          para: dest.label,
          bytes: sent.bytes,
          pasta: info.pasta || pasta
        })
      );
    } catch (e) {
      erros.push(`${it.name}: ${String(e.message || e).slice(0, 80)}`);
    }
  }
  const quem = dest.label === 'você' ? 'seu WhatsApp' : `WhatsApp de ${dest.label}`;
  if (!okNames.length) {
    return {
      tipo,
      ok: false,
      erro: `não consegui mandar nada de ${info.pasta || pasta}: ${erros[0] || 'erro'}`,
      para: dest.label
    };
  }
  let msg = `Mandei ${okNames.length} arquivo${okNames.length > 1 ? 's' : ''} de **${info.pasta || pasta}** no ${quem}`;
  if (okNames.length <= 3) msg += ` (${okNames.join(', ')})`;
  msg += '.';
  if (items.length > MAX_FOLDER_FILES) {
    msg += ` (limitei a ${MAX_FOLDER_FILES}; a pasta tem ${items.length})`;
  }
  if (erros.length) msg += ` ${erros.length} falhou.`;
  if (dest.textoExtra) msg = `${msg} ${dest.textoExtra}`;
  return {
    tipo,
    ok: true,
    pasta: info.pasta || pasta,
    enviados: okNames.length,
    para: dest.label,
    texto: msg
  };
}

async function handleSendFile(acao, ctx) {
  const tipo = 'wa_send_file';
  if (!(await ensureOwner(ctx))) {
    return { tipo, ok: false, erro: 'só owner' };
  }
  const pastaArg = String(acao.pasta || '').trim();
  let arquivo = String(acao.arquivo || acao.path || acao.caminho || '').trim();
  if (!pastaArg && arquivo.length < 2) {
    return { tipo, ok: false, erro: 'falta o caminho do arquivo ou pasta no PC' };
  }
  const dest = await resolveDest(ctx, acao.para || acao.destino || acao.to, {
    phoneHint: acao.numero || acao.phone || acao.telefone || null
  });
  if (!dest.ok) return { tipo, ok: false, erro: dest.erro };

  const { requireLib } = require('../../host');
  const { evolutionReady } = requireLib('evolution');
  if (!evolutionReady()) {
    return { tipo, ok: false, erro: 'WhatsApp do Jarvis (Evolution) não está pronto agora' };
  }

  if (pastaArg) {
    return handleSendFolder(acao, ctx, pastaArg, dest);
  }

  // Sem extensão / "desktop/1" → tenta como pasta primeiro
  const asFolder =
    !/\.[a-z0-9]{2,8}$/i.test(arquivo) || /^pasta\b/i.test(arquivo);
  if (asFolder) {
    const folderTry = await handleSendFolder(acao, ctx, arquivo, dest);
    if (folderTry.ok) return folderTry;
    // se listou e estava vazia/erro claro de pasta, não tenta como arquivo
    if (folderTry.erro && /não tem arquivo|listar a pasta/i.test(folderTry.erro)) {
      return folderTry;
    }
  }

  const { requestTool } = require('../../devices/gateway');
  let fetched = await requestTool(
    ctx.userId,
    'pc_files_fetch',
    { arquivo },
    { timeoutMs: FETCH_TIMEOUT_MS }
  );
  // Modelo às vezes manda "desktop/pasta 1" em vez de "desktop/1"
  if (!fetched.ok && /não existe|nao existe/i.test(String(fetched.erro || ''))) {
    const alt = normalizeFolderHint(arquivo);
    if (alt !== arquivo) {
      const asDir = await handleSendFolder(acao, ctx, alt, dest);
      if (asDir.ok || (asDir.erro && /não tem arquivo/i.test(asDir.erro))) return asDir;
      fetched = await requestTool(
        ctx.userId,
        'pc_files_fetch',
        { arquivo: alt },
        { timeoutMs: FETCH_TIMEOUT_MS }
      );
    }
  }
  if (!fetched.ok) {
    if (/pasta|diret[oó]rio|directory/i.test(String(fetched.erro || ''))) {
      return handleSendFolder(acao, ctx, arquivo, dest);
    }
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

  const caption = String(acao.legenda || acao.caption || '')
    .trim()
    .slice(0, 900);

  try {
    const sent = await sendFetchedMedia(dest, f, caption);
    console.log(
      JSON.stringify({
        tag: 'jarvis.wa',
        event: 'send_file',
        userId: ctx.userId,
        fileName: sent.fileName,
        mediatype: sent.mediatype,
        para: dest.label,
        bytes: sent.bytes
      })
    );
    const quem = dest.label === 'você' ? 'seu WhatsApp' : `WhatsApp de ${dest.label}`;
    let msg = `Mandei **${sent.fileName}** no ${quem}.`;
    if (dest.textoExtra) msg = `${msg} ${dest.textoExtra}`;
    return {
      tipo,
      ok: true,
      arquivo: sent.display || arquivo,
      para: dest.label,
      texto: msg
    };
  } catch (e) {
    return {
      tipo,
      ok: false,
      erro: String(e.message || e).slice(0, 200) || 'não consegui enviar o arquivo no WhatsApp'
    };
  }
}

async function handleContact(acao, ctx) {
  const tipo = acao.tipo;
  if (!(await ensureOwner(ctx))) {
    return { tipo, ok: false, erro: 'só owner' };
  }
  const contacts = require('../../memory/wa-contacts');
  const { requireLib } = require('../../host');
  const { normalizeWaId } = requireLib('evolution');

  if (tipo === 'wa_contact_list') {
    const rows = await contacts.list(ctx.userId);
    if (!rows.length) {
      return {
        tipo,
        ok: true,
        texto: 'Nenhum contato guardado ainda. Diz "o zap do João é 55…" que eu anoto.'
      };
    }
    const lines = rows.map((r) => {
      const dest =
        r.kind === 'group' || /@g\.us$/i.test(r.dest)
          ? r.dest
          : `…${String(r.dest).replace(/\D/g, '').slice(-4)}`;
      return `• **${r.alias}** (${r.kind}) → ${dest}`;
    });
    return { tipo, ok: true, contatos: rows, texto: `Contatos no WhatsApp:\n${lines.join('\n')}` };
  }

  if (tipo === 'wa_contact_forget') {
    const alias = acao.alias || acao.nome || acao.para;
    const gone = await contacts.forget(ctx.userId, alias);
    if (!gone) return { tipo, ok: false, erro: `não achei contato "${alias}"` };
    return { tipo, ok: true, texto: `Esqueci o zap de **${gone.alias}**.` };
  }

  // wa_contact_set
  const alias = acao.alias || acao.nome || acao.para;
  let dest = String(acao.numero || acao.phone || acao.telefone || acao.dest || '').trim();
  const kind = /@g\.us$/i.test(dest) || acao.kind === 'group' ? 'group' : 'contact';
  if (kind === 'contact') {
    dest = normalizeWaId(dest);
    if (!dest) return { tipo, ok: false, erro: 'número inválido' };
  }
  try {
    const saved = await contacts.upsert(ctx.userId, alias, dest, { kind });
    return {
      tipo,
      ok: true,
      ...saved,
      texto: `Guardei **${saved.alias}** → posso mandar no zap dele sem você cadastrar de novo.`
    };
  } catch (e) {
    return { tipo, ok: false, erro: String(e.message || e).slice(0, 160) };
  }
}

async function handle(acao, ctx) {
  const tipo = acao && acao.tipo;
  if (!TYPES.has(tipo)) return null;
  if (tipo === 'wa_send_file') return handleSendFile(acao, ctx);
  if (tipo === 'wa_send_owner') return handleSendText(acao, ctx, { forceOwner: true });
  if (tipo === 'wa_send') return handleSendText(acao, ctx, { forceOwner: false });
  return handleContact(acao, ctx);
}

module.exports = {
  TYPES,
  handle,
  MAX_CHARS,
  mediaTypeFor
};
