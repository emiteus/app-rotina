/**
 * Gateway WebSocket do Jarvis Desktop (Fase 2 MCU) — path /jarvis-device.
 * O PC conecta DE DENTRO PRA FORA (sem abrir porta) com o token do pareamento.
 *
 * Protocolo (JSON):
 *  PC → nuvem: { type:'chat', id, text } · { type:'voice', id, audio (base64 WAV 16 kHz), mime }
 *              { type:'tool_result', id, ok, result?, erro? } · { type:'ping' }
 *  nuvem → PC: { type:'hello', deviceId, name } · { type:'transcript', id, text }
 *              { type:'reply', id, text, approval?, images?, audio? }
 *              { type:'tool', id, tool, args } (só tools pc_*, tv_* e soc_* registradas)
 *              { type:'error', id?, message } · { type:'pong' } · { type:'notify', text }
 */
const store = require('./store');

const PATH = '/jarvis-device';
const MAX_TEXT = 4000;
const RATE_PER_MIN = 20;
const HEARTBEAT_MS = 30 * 1000;
const MAX_IMAGE_B64 = 4 * 1024 * 1024;
const MAX_VOICE_BYTES = 3 * 1024 * 1024; // ~90 s de WAV 16 kHz mono
const VOICE_TTS_BUDGET_MS = 12000; // passou disso, o PC fala com a voz local do Windows

/** Transcrição: mesma ordem do WhatsApp (Gemini, depois Whisper). */
async function transcribe(base64, mime) {
  const ingress = require('../multimodal/ingress');
  try {
    const t = await ingress.geminiUnderstand({ kind: 'audio', base64, mime });
    if (t && String(t).trim()) return String(t).trim();
  } catch (_) {
    /* tenta o Whisper */
  }
  try {
    const t = await ingress.whisperTranscribe(base64, mime);
    if (t && String(t).trim()) return String(t).trim();
  } catch (_) {
    /* sem transcrição */
  }
  return null;
}

/** A transcrição fala com o Jarvis? (grafias que o STT usa pro "Jarvis" dito em português) */
function mentionsJarvis(text) {
  const t = String(text || '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase();
  return /\b(d?jarv[ie]s|jarvi|jarvas|javis|jervis|jarbas|garvis|charvis|xarvis|jarves)\b/.test(t);
}

/** deviceId -> ws (uma conexão ativa por aparelho) */
const connections = new Map();
/** id -> { resolve, timer, deviceId } — comandos pc_* esperando o PC responder */
const toolWaits = new Map();
let toolSeq = 0;
const TOOL_TIMEOUT_MS = 15000;

function bearer(req) {
  const h = String((req.headers && req.headers.authorization) || '');
  const m = h.match(/^Bearer\s+(\S+)$/i);
  return m ? m[1] : null;
}

function send(ws, msg) {
  if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg));
}

/** Resposta do turno → payload enxuto pro PC. */
function replyPayload(id, out) {
  const acoes = (out && out.acoes) || [];
  const pending = acoes.find((a) => a && a.pending_approval);
  const images = acoes
    .filter((a) => a && a.ok && a.image_base64 && String(a.image_base64).length <= MAX_IMAGE_B64)
    .slice(0, 2)
    .map((a) => ({ mime: a.mime || 'image/png', base64: a.image_base64, caption: a.caption || null }));
  return {
    type: 'reply',
    id,
    // Marcadores de CONTEÚDO EXTERNO ficam no histórico; na tela e na fala, não
    text: String((out && out.resposta) || '')
      .replace(/\[\/?CONTEÚDO EXTERNO[^\]]*\]\n?/g, '')
      .trim(),
    approval: pending
      ? { id: pending.approval_id, tipos: [...new Set(acoes.filter((a) => a.pending_approval).map((a) => a.tipo))] }
      : null,
    images: images.length ? images : undefined
  };
}

/**
 * @param {{ runTurn?: Function }} [deps] — injetável pra teste; padrão = core.runJarvisTurn
 */
function createGateway(deps = {}) {
  const runTurn = deps.runTurn || ((opts) => require('../core').runJarvisTurn(opts));
  const stt = deps.transcribe || transcribe;
  const tts =
    deps.synthesize ||
    ((text) =>
      require('../multimodal/tts').synthesizeSpeech(text, {
        force: true,
        timeoutMs: VOICE_TTS_BUDGET_MS,
        providers: ['openai'],
        voice: process.env.JARVIS_DESKTOP_VOICE || 'onyx',
        geminiVoice: process.env.JARVIS_DESKTOP_GEMINI_VOICE || 'Charon'
      }));

  async function authenticate(req) {
    const token = bearer(req);
    if (!token) return null;
    try {
      return await store.authenticateToken(token);
    } catch (e) {
      console.error('[jarvis.device] auth:', e.message);
      return null;
    }
  }

  function onConnection(ws, device) {
    const prev = connections.get(device.id);
    if (prev && prev !== ws) {
      try {
        prev.close(4000, 'nova conexão do mesmo aparelho');
      } catch (_) {
        /* ignore */
      }
    }
    connections.set(device.id, ws);
    ws.jarvisDevice = device;

    let conversaId = device.conversaId;
    let chain = Promise.resolve();
    const hits = [];
    let alive = true;

    const beat = setInterval(() => {
      if (!alive) {
        ws.terminate();
        return;
      }
      alive = false;
      try {
        ws.ping();
      } catch (_) {
        /* ignore */
      }
    }, HEARTBEAT_MS);
    ws.on('pong', () => {
      alive = true;
    });

    send(ws, { type: 'hello', deviceId: device.id, name: device.name });
    console.log(JSON.stringify({ tag: 'jarvis.device', event: 'online', deviceId: device.id, userId: device.userId }));

    ws.on('message', (raw) => {
      alive = true;
      let msg;
      try {
        msg = JSON.parse(raw);
      } catch {
        send(ws, { type: 'error', message: 'JSON inválido' });
        return;
      }
      if (!msg || typeof msg !== 'object') return;
      if (msg.type === 'ping') {
        send(ws, { type: 'pong' });
        return;
      }
      if (msg.type === 'tool_result') {
        // Só aceita resposta de comando que ESTE aparelho recebeu
        const w = toolWaits.get(String(msg.id || ''));
        if (!w || w.deviceId !== device.id) return;
        toolWaits.delete(w.id);
        clearTimeout(w.timer);
        w.resolve({
          ok: msg.ok === true,
          result: msg.result && typeof msg.result === 'object' ? msg.result : {},
          erro: msg.ok === true ? undefined : String(msg.erro || 'falhou no PC').slice(0, 300)
        });
        return;
      }
      ws.lastActive = Date.now();
      if (msg.type !== 'chat' && msg.type !== 'voice') {
        send(ws, { type: 'error', id: msg.id, message: `tipo não suportado: ${String(msg.type).slice(0, 30)}` });
        return;
      }
      const id = String(msg.id || '').slice(0, 64) || null;
      const isVoice = msg.type === 'voice';
      const text = isVoice ? '' : String(msg.text || '').trim();
      let audio = null;
      if (isVoice) {
        audio = String(msg.audio || '');
        const mime = String(msg.mime || 'audio/wav');
        if (!/^audio\/(wav|x-wav|webm|ogg)$/.test(mime) || !/^[A-Za-z0-9+/=]+$/.test(audio)) {
          return send(ws, { type: 'error', id, message: 'áudio inválido' });
        }
        if ((audio.length * 3) / 4 > MAX_VOICE_BYTES) {
          return send(ws, { type: 'error', id, message: 'áudio longo demais' });
        }
        audio = { base64: audio, mime, weak: msg.weak === true };
      } else {
        if (!text) return send(ws, { type: 'error', id, message: 'mensagem vazia' });
        if (text.length > MAX_TEXT) return send(ws, { type: 'error', id, message: 'mensagem longa demais' });
      }

      const now = Date.now();
      while (hits.length && now - hits[0] > 60000) hits.shift();
      if (hits.length >= RATE_PER_MIN) {
        return send(ws, { type: 'error', id, message: 'muitas mensagens em 1 minuto — espera um pouco' });
      }
      hits.push(now);

      // Um turno por vez por aparelho (mesma regra do WhatsApp)
      chain = chain
        .then(async () => {
          let message = text;
          // Tempo de cada etapa da voz (pra achar demora com número, não no chute)
          const t0 = Date.now();
          const timing = {};
          if (audio) {
            const heard = await stt(audio.base64, audio.mime);
            timing.sttMs = Date.now() - t0;
            // Ativação fraca ("Jarvis" em português pontua baixo no modelo inglês): só segue se o nome
            // estiver na transcrição. TV/conversa que disparou por engano some sem resposta.
            if (heard && audio.weak && !mentionsJarvis(heard)) {
              console.log(JSON.stringify({ tag: 'jarvis.voice', event: 'weak_ignored', deviceId: device.id, sttMs: timing.sttMs }));
              send(ws, { type: 'reply', id, text: '', ignored: true });
              return;
            }
            if (!heard) {
              send(ws, { type: 'error', id, message: 'Não entendi o áudio. Fala de novo ou digita.' });
              return;
            }
            // Mostra na tela o que foi entendido antes da resposta chegar
            send(ws, { type: 'transcript', id, text: heard });
            message = `[Áudio transcrito]: ${heard}`;
          }
          const tTurn = Date.now();
          const out = await runTurn({
            userId: device.userId,
            message,
            conversaId,
            historico: [],
            channel: 'desktop'
          });
          timing.turnMs = Date.now() - tTurn;
          if (out && out.conversa_id && out.conversa_id !== conversaId) {
            conversaId = out.conversa_id;
            store.setDeviceConversa(device.id, conversaId).catch(() => {});
          }
          const payload = replyPayload(id, out);
          if (audio && payload.text) {
            // Voz entra, voz sai. Sem áudio a tempo → o PC fala com a voz do Windows
            const tTts = Date.now();
            const speech = await tts(payload.text).catch(() => null);
            timing.ttsMs = Date.now() - tTts;
            if (speech && speech.base64) payload.audio = { mime: speech.mime, base64: speech.base64 };
          }
          send(ws, payload);
          if (audio) {
            console.log(
              JSON.stringify({
                tag: 'jarvis.voice',
                event: 'timing',
                deviceId: device.id,
                audioKb: Math.round((String(audio.base64).length * 0.75) / 1024),
                ...timing,
                totalMs: Date.now() - t0,
                spoke: payload.audio ? 'server' : 'pc'
              })
            );
          }
        })
        .catch((err) => {
          console.error('[jarvis.device] turn:', err.message);
          send(ws, {
            type: 'error',
            id,
            message:
              err.status === 429 ? String(err.message) : 'Tive um problema aqui. Tenta de novo em instantes.'
          });
        });
    });

    ws.on('close', () => {
      clearInterval(beat);
      // Comando pendente pra este PC: responde "caiu" em vez de esperar o timeout
      for (const w of [...toolWaits.values()]) {
        if (w.deviceId !== device.id) continue;
        toolWaits.delete(w.id);
        clearTimeout(w.timer);
        w.resolve({ ok: false, erro: 'o PC desconectou antes de responder' });
      }
      if (connections.get(device.id) === ws) connections.delete(device.id);
      console.log(JSON.stringify({ tag: 'jarvis.device', event: 'offline', deviceId: device.id }));
    });
    ws.on('error', (e) => console.error('[jarvis.device] ws:', e.message));
  }

  return { path: PATH, authenticate, onConnection };
}

/**
 * Manda uma tool pc_* pro PC do usuário e espera o resultado.
 * Vários PCs online → o que conversou por último. Nunca executa em PC de outro usuário.
 * @returns {Promise<{ ok: boolean, result?: object, erro?: string, deviceId?: string }>}
 */
function requestTool(userId, tool, args = {}, { timeoutMs = TOOL_TIMEOUT_MS } = {}) {
  const mine = [...connections.values()].filter(
    (ws) => ws.jarvisDevice && ws.jarvisDevice.userId === String(userId) && ws.readyState === 1
  );
  if (!mine.length) {
    return Promise.resolve({ ok: false, erro: 'nenhum PC com o Jarvis Desktop online agora' });
  }
  mine.sort((a, b) => (b.lastActive || 0) - (a.lastActive || 0));
  const ws = mine[0];
  const id = `t${Date.now().toString(36)}${(toolSeq++).toString(36)}`;
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      toolWaits.delete(id);
      resolve({ ok: false, erro: 'o PC não respondeu a tempo', uncertain: true });
    }, timeoutMs);
    toolWaits.set(id, {
      id,
      deviceId: ws.jarvisDevice.id,
      timer,
      resolve: (r) => resolve({ ...r, deviceId: ws.jarvisDevice.id })
    });
    send(ws, { type: 'tool', id, tool, args });
  });
}

/** Revogou → derruba a conexão na hora. */
function disconnectDevice(deviceId, reason = 'aparelho revogado') {
  const ws = connections.get(deviceId);
  if (!ws) return false;
  try {
    ws.close(4001, reason);
  } catch (_) {
    /* ignore */
  }
  connections.delete(deviceId);
  return true;
}

/** Aviso proativo pros PCs online do usuário (Fase 5 usa). */
function notifyUserDevices(userId, text) {
  let n = 0;
  for (const ws of connections.values()) {
    if (ws.jarvisDevice && ws.jarvisDevice.userId === String(userId)) {
      send(ws, { type: 'notify', text: String(text || '') });
      n += 1;
    }
  }
  return n;
}

function onlineDeviceIds(userId = null) {
  return [...connections.values()]
    .filter((ws) => ws.jarvisDevice && (!userId || ws.jarvisDevice.userId === String(userId)))
    .map((ws) => ws.jarvisDevice.id);
}

module.exports = {
  mentionsJarvis,
  PATH,
  createGateway,
  replyPayload,
  disconnectDevice,
  notifyUserDevices,
  requestTool,
  onlineDeviceIds
};
