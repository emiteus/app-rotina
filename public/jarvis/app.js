/**
 * Jarvis no celular (Fase 5.5 MCU) — página instalada na tela inicial do iPhone.
 * Pareia com código (igual ao PC), conversa por texto ou "segure pra falar", responde falando
 * e recebe avisos por notificação quando você está longe do PC.
 * O celular nunca executa comando: só conversa. O token fica só neste aparelho.
 */
(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const els = {
    status: $('status'),
    more: $('more'),
    menu: $('menu'),
    pushToggle: $('push-toggle'),
    pushHint: $('push-hint'),
    voiceToggle: $('voice-toggle'),
    forget: $('forget'),
    pair: $('pair'),
    pairForm: $('pair-form'),
    code: $('code'),
    pairBtn: $('pair-btn'),
    pairError: $('pair-error'),
    installTip: $('install-tip'),
    talk: $('talk'),
    log: $('log'),
    reactor: $('reactor'),
    hint: $('hint'),
    composer: $('composer'),
    input: $('input'),
    send: $('send')
  };

  // ---------- armazenamento local (pode falhar em aba privada) ----------
  const store = {
    get(k) {
      try {
        return localStorage.getItem(k);
      } catch (_) {
        return null;
      }
    },
    set(k, v) {
      try {
        if (v == null) localStorage.removeItem(k);
        else localStorage.setItem(k, v);
      } catch (_) {
        /* segue sem guardar */
      }
    }
  };
  const K = { token: 'jarvis.token', voice: 'jarvis.voice', log: 'jarvis.log', push: 'jarvis.push' };

  const standalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;

  // ---------- texto ----------
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  }
  /** **negrito** e `código`, o resto escapado */
  function richText(s) {
    return escapeHtml(s)
      .replace(/\*\*([^*\n]{1,200})\*\*/g, '<strong>$1</strong>')
      .replace(/`([^`\n]{1,200})`/g, '<code>$1</code>');
  }
  /** O que vai pra voz: sem markdown nem emoji de enfeite */
  function speakable(s) {
    return String(s || '')
      .replace(/[*_`#>]/g, '')
      .replace(/\p{Extended_Pictographic}/gu, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  // ---------- conversa na tela ----------
  let history = [];
  try {
    history = JSON.parse(store.get(K.log) || '[]').slice(-40);
  } catch (_) {
    history = [];
  }

  function saveLog() {
    store.set(K.log, JSON.stringify(history.slice(-40)));
  }

  function scrollDown() {
    els.log.scrollTop = els.log.scrollHeight;
  }

  function addLine(kind, text, { keep = true } = {}) {
    const empty = els.log.querySelector('.vazio');
    if (empty) empty.remove();
    const li = document.createElement('li');
    li.className = kind;
    li.innerHTML = richText(text);
    els.log.appendChild(li);
    if (keep && (kind === 'me' || kind === 'jarvis')) {
      history.push({ k: kind, t: String(text).slice(0, 2000) });
      saveLog();
    }
    scrollDown();
    return li;
  }

  function renderHistory() {
    els.log.textContent = '';
    if (!history.length) {
      const li = document.createElement('li');
      li.className = 'vazio';
      li.textContent = 'Segure o reator e fale, ou escreva embaixo.';
      els.log.appendChild(li);
      return;
    }
    for (const h of history) addLine(h.k, h.t, { keep: false });
  }

  function addImages(images) {
    const li = els.log.lastElementChild;
    if (!li || !Array.isArray(images)) return;
    for (const im of images.slice(0, 2)) {
      if (!/^image\/(png|jpeg|webp|gif)$/.test(String(im.mime)) || !/^[A-Za-z0-9+/=]+$/.test(String(im.base64))) continue;
      const img = document.createElement('img');
      img.alt = im.caption || 'Imagem do Jarvis';
      img.src = `data:${im.mime};base64,${im.base64}`;
      li.appendChild(img);
    }
    scrollDown();
  }

  function addApproval(approval) {
    const li = document.createElement('li');
    li.className = 'approval';
    const rot = document.createElement('div');
    rot.className = 'rotulo';
    rot.textContent = 'Precisa do seu ok';
    const acoes = document.createElement('div');
    acoes.className = 'acoes';
    const sim = document.createElement('button');
    sim.type = 'button';
    sim.className = 'sim';
    sim.textContent = 'Pode fazer';
    const nao = document.createElement('button');
    nao.type = 'button';
    nao.textContent = 'Não';
    const answer = (yes) => {
      li.dataset.done = '1';
      sendText(`${yes ? 'SIM' : 'NÃO'} ${approval.id}`, { echo: yes ? 'Pode fazer' : 'Não' });
    };
    sim.addEventListener('click', () => answer(true));
    nao.addEventListener('click', () => answer(false));
    acoes.append(sim, nao);
    li.append(rot, acoes);
    els.log.appendChild(li);
    scrollDown();
  }

  // ---------- reator ----------
  let conn = 'offline'; // offline | connecting | online
  let busy = null; // null | listening | thinking | speaking
  function paint() {
    const state = busy || (conn === 'online' ? 'online' : conn === 'connecting' ? 'connecting' : 'offline');
    els.reactor.dataset.state = state;
    els.status.dataset.state = conn;
    els.status.textContent = conn === 'online' ? 'online' : conn === 'connecting' ? 'conectando' : 'sem conexão';
    const hints = {
      listening: 'Ouvindo… solte pra mandar',
      thinking: 'Pensando…',
      speaking: 'Toque no reator pra parar',
      online: 'Segure pra falar',
      connecting: 'Conectando…',
      offline: 'Sem conexão. Tentando de novo…'
    };
    els.hint.textContent = hints[state];
    els.send.disabled = conn !== 'online';
  }
  function setLevel(v) {
    els.reactor.style.setProperty('--lvl', Math.min(1, v).toFixed(3));
  }

  // ---------- fala ----------
  let voiceOn = store.get(K.voice) !== '0';
  let currentAudio = null;
  let ptVoice = null;
  function pickVoice() {
    const vs = window.speechSynthesis ? speechSynthesis.getVoices() : [];
    ptVoice = vs.find((v) => /pt[-_]BR/i.test(v.lang)) || vs.find((v) => /^pt/i.test(v.lang)) || null;
  }
  if (window.speechSynthesis) {
    pickVoice();
    speechSynthesis.onvoiceschanged = pickVoice;
  }

  function stopSpeaking() {
    if (currentAudio) {
      currentAudio.pause();
      currentAudio = null;
    }
    if (window.speechSynthesis) speechSynthesis.cancel();
    if (busy === 'speaking') {
      busy = null;
      paint();
    }
  }

  function speak(text, audio) {
    if (!voiceOn) return;
    stopSpeaking();
    const done = () => {
      if (busy === 'speaking') {
        busy = null;
        paint();
      }
    };
    if (audio && /^audio\/(mpeg|wav|ogg)$/.test(String(audio.mime)) && /^[A-Za-z0-9+/=]+$/.test(String(audio.base64))) {
      const a = player; // o tocador destravado no primeiro toque
      currentAudio = a;
      a.onended = done;
      a.onerror = () => {
        currentAudio = null;
        speakLocal(text, done);
      };
      a.src = `data:${audio.mime};base64,${audio.base64}`;
      busy = 'speaking';
      paint();
      a.play().catch(() => speakLocal(text, done));
      return;
    }
    speakLocal(text, done);
  }

  function speakLocal(text, done) {
    const t = speakable(text);
    if (!t || !window.speechSynthesis) return done();
    const u = new SpeechSynthesisUtterance(t.slice(0, 900));
    u.lang = 'pt-BR';
    if (ptVoice) u.voice = ptVoice;
    u.rate = 1.05;
    u.onend = done;
    u.onerror = done;
    busy = 'speaking';
    paint();
    speechSynthesis.speak(u);
  }

  // No iPhone o som só sai depois de um toque, e a voz do Jarvis chega segundos depois dele:
  // destrava UM tocador no primeiro toque (com silêncio) e reaproveita ele pra toda voz
  const player = new Audio();
  player.preload = 'auto';
  const SILENCE = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=';
  let unlocked = false;
  function unlockAudio() {
    if (unlocked) return;
    unlocked = true;
    try {
      if (window.speechSynthesis) speechSynthesis.speak(new SpeechSynthesisUtterance(''));
    } catch (_) {
      /* sem voz local */
    }
    player.src = SILENCE;
    player.play().catch(() => {});
  }
  document.addEventListener('touchend', unlockAudio, { once: true, passive: true });
  document.addEventListener('click', unlockAudio, { once: true });

  // ---------- conexão ----------
  let ws = null;
  let token = store.get(K.token);
  let retry = 0;
  let retryTimer = null;
  let vapidKey = null;
  let seq = 0;
  const pending = new Map(); // id -> { voice: bool }
  // Voz do Jarvis (a mesma do WhatsApp) chega depois do texto; sem ela em 27 s, voz do iPhone
  const awaitingAudio = new Map(); // id -> { text, timer }
  function dropAwaitingAudio() {
    for (const w of awaitingAudio.values()) clearTimeout(w.timer);
    awaitingAudio.clear();
  }

  function wsUrl() {
    return `${location.protocol === 'http:' ? 'ws' : 'wss'}://${location.host}/jarvis-device`;
  }

  function connect() {
    clearTimeout(retryTimer);
    if (!token) return;
    if (ws && (ws.readyState === 0 || ws.readyState === 1)) return;
    conn = 'connecting';
    paint();
    let helloSeen = false;
    // Token como subprotocolo (navegador não manda header no WebSocket; na URL ele iria pra log)
    try {
      ws = new WebSocket(wsUrl(), ['jarvis-device', token]);
    } catch (_) {
      return scheduleRetry(false);
    }
    const sock = ws;
    sock.onmessage = (ev) => {
      let m;
      try {
        m = JSON.parse(ev.data);
      } catch (_) {
        return;
      }
      if (m.type === 'hello') {
        helloSeen = true;
        retry = 0;
        conn = 'online';
        vapidKey = m.vapidKey || null;
        paint();
        syncPush();
        return;
      }
      onServer(m);
    };
    sock.onclose = (ev) => {
      if (sock !== ws) return;
      ws = null;
      conn = 'offline';
      if (busy === 'thinking') busy = null;
      paint();
      failPending('A conexão caiu antes da resposta. Manda de novo.');
      if (ev.code === 4001) {
        // Revogado no WhatsApp ("desconecta o celular")
        forget('Este celular foi desconectado. Pra usar de novo, mande "parear celular" no WhatsApp.');
        return;
      }
      if (ev.code === 4000) return; // outra aba/janela deste celular assumiu
      scheduleRetry(helloSeen);
    };
    sock.onerror = () => {
      /* onclose cuida */
    };
  }

  function scheduleRetry(wasOnline) {
    if (!token) return;
    retry = wasOnline ? 1 : retry + 1;
    // Token recusado aparece como falha de conexão: depois de várias seguidas, oferece parear de novo
    if (retry >= 6 && navigator.onLine) {
      els.hint.textContent = 'Não consegui conectar. Se desconectou este celular, pareie de novo pelo menu.';
    }
    const wait = Math.min(30000, 1000 * 2 ** Math.min(retry, 5));
    retryTimer = setTimeout(connect, wait);
  }

  function failPending(msg) {
    if (!pending.size) return;
    pending.clear();
    addLine('erro', msg, { keep: false });
  }

  function send(obj) {
    if (!ws || ws.readyState !== 1) return false;
    ws.send(JSON.stringify(obj));
    return true;
  }

  function onServer(m) {
    if (m.type === 'transcript') {
      addLine('me', m.text || '');
      return;
    }
    if (m.type === 'reply') {
      const p = pending.get(m.id);
      pending.delete(m.id);
      if (busy === 'thinking' && !pending.size) busy = null;
      paint();
      if (m.ignored) return;
      if (m.text) addLine('jarvis', m.text);
      if (m.images) addImages(m.images);
      if (m.approval && m.approval.id) addApproval(m.approval);
      if (p && p.voice && m.text) {
        if (m.audioPending) {
          dropAwaitingAudio();
          const timer = setTimeout(() => {
            awaitingAudio.delete(m.id);
            speak(m.text, null);
          }, 27000);
          awaitingAudio.set(m.id, { text: m.text, timer });
        } else {
          speak(m.text, m.audio);
        }
      }
      return;
    }
    if (m.type === 'reply_audio') {
      const w = awaitingAudio.get(m.id);
      if (!w) return; // já falou com a voz do iPhone ou você cortou
      awaitingAudio.delete(m.id);
      clearTimeout(w.timer);
      speak(w.text, m.audio || null);
      return;
    }
    if (m.type === 'error') {
      if (m.id) pending.delete(m.id);
      if (busy === 'thinking' && !pending.size) busy = null;
      paint();
      addLine('erro', m.message || 'Deu erro aqui. Tenta de novo.', { keep: false });
      return;
    }
    if (m.type === 'notify') {
      addLine('aviso', m.text || '', { keep: false });
      return;
    }
    if (m.type === 'push_state') {
      setPushUi(!!m.on, m.erro ? `Não deu: ${m.erro}.` : null);
    }
  }

  function newId() {
    seq += 1;
    return `m${Date.now().toString(36)}${seq.toString(36)}`;
  }

  function sendText(text, { echo = null } = {}) {
    const t = String(text || '').trim();
    if (!t) return;
    const id = newId();
    if (!send({ type: 'chat', id, text: t.slice(0, 4000) })) {
      addLine('erro', 'Sem conexão agora. Tenta de novo em instantes.', { keep: false });
      return;
    }
    addLine('me', echo || t);
    pending.set(id, { voice: false });
    stopSpeaking();
    dropAwaitingAudio();
    busy = 'thinking';
    paint();
  }

  // ---------- voz: segure pra falar ----------
  const MAX_MS = 60000;
  const MIN_MS = 450;
  let rec = null; // { ctx, stream, node, chunks, rate, t0, timer }

  async function startRec() {
    if (rec || conn !== 'online') return;
    stopSpeaking();
    dropAwaitingAudio(); // falou por cima: a voz atrasada da resposta anterior não toca mais
    unlockAudio();
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true }
      });
    } catch (_) {
      addLine('erro', 'Preciso do microfone. Libere em Ajustes → Safari → Microfone (ou no aviso que aparecer).', { keep: false });
      return;
    }
    const Ctx = window.AudioContext || window.webkitAudioContext;
    const ctx = new Ctx();
    try {
      await ctx.audioWorklet.addModule('rec-worklet.js');
    } catch (_) {
      stream.getTracks().forEach((t) => t.stop());
      ctx.close();
      addLine('erro', 'Este navegador não deixa gravar áudio aqui. Escreva embaixo.', { keep: false });
      return;
    }
    const src = ctx.createMediaStreamSource(stream);
    const node = new AudioWorkletNode(ctx, 'jarvis-rec');
    const r = { ctx, stream, node, chunks: [], rate: ctx.sampleRate, t0: Date.now(), timer: null, released: false };
    node.port.onmessage = (e) => {
      r.chunks.push(e.data.pcm);
      setLevel(e.data.rms * 7);
    };
    src.connect(node);
    // Worklet precisa estar ligado na saída pra rodar (ganho 0 = silêncio)
    const mute = ctx.createGain();
    mute.gain.value = 0;
    node.connect(mute).connect(ctx.destination);
    if (ctx.state === 'suspended') await ctx.resume().catch(() => {});
    rec = r;
    busy = 'listening';
    paint();
    if (navigator.vibrate) navigator.vibrate(10);
    r.timer = setTimeout(() => stopRec(true), MAX_MS);
    // Soltou antes do microfone abrir
    if (releasedEarly) {
      releasedEarly = false;
      stopRec(true);
    }
  }

  function stopRec(sendIt) {
    const r = rec;
    if (!r) return;
    rec = null;
    clearTimeout(r.timer);
    r.stream.getTracks().forEach((t) => t.stop());
    try {
      r.node.disconnect();
    } catch (_) {
      /* já desligado */
    }
    r.ctx.close().catch(() => {});
    setLevel(0);
    busy = null;
    paint();
    const ms = Date.now() - r.t0;
    if (!sendIt) return;
    if (ms < MIN_MS) {
      els.hint.textContent = 'Segure o reator enquanto fala';
      return;
    }
    const wav = encodeWav(downsample(join(r.chunks), r.rate, 16000), 16000);
    const id = newId();
    if (!send({ type: 'voice', id, audio: wav, mime: 'audio/wav' })) {
      addLine('erro', 'Sem conexão agora. Tenta de novo em instantes.', { keep: false });
      return;
    }
    pending.set(id, { voice: true });
    busy = 'thinking';
    paint();
  }

  function join(chunks) {
    let n = 0;
    for (const c of chunks) n += c.length;
    const out = new Float32Array(n);
    let o = 0;
    for (const c of chunks) {
      out.set(c, o);
      o += c.length;
    }
    return out;
  }

  /** Média por janela: 48 kHz → 16 kHz sem serrilhado audível pra fala */
  function downsample(pcm, from, to) {
    if (from === to) return pcm;
    const ratio = from / to;
    const out = new Float32Array(Math.floor(pcm.length / ratio));
    for (let i = 0; i < out.length; i++) {
      const a = Math.floor(i * ratio);
      const b = Math.min(pcm.length, Math.floor((i + 1) * ratio));
      let s = 0;
      for (let j = a; j < b; j++) s += pcm[j];
      out[i] = s / Math.max(1, b - a);
    }
    return out;
  }

  /** WAV PCM 16 bits mono → base64 */
  function encodeWav(pcm, rate) {
    const buf = new ArrayBuffer(44 + pcm.length * 2);
    const v = new DataView(buf);
    const str = (o, s) => {
      for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i));
    };
    str(0, 'RIFF');
    v.setUint32(4, 36 + pcm.length * 2, true);
    str(8, 'WAVE');
    str(12, 'fmt ');
    v.setUint32(16, 16, true);
    v.setUint16(20, 1, true);
    v.setUint16(22, 1, true);
    v.setUint32(24, rate, true);
    v.setUint32(28, rate * 2, true);
    v.setUint16(32, 2, true);
    v.setUint16(34, 16, true);
    str(36, 'data');
    v.setUint32(40, pcm.length * 2, true);
    for (let i = 0; i < pcm.length; i++) {
      const s = Math.max(-1, Math.min(1, pcm[i]));
      v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    }
    const bytes = new Uint8Array(buf);
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  }

  let pressing = false;
  let releasedEarly = false;
  els.reactor.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    if (busy === 'speaking') {
      stopSpeaking();
      return;
    }
    if (conn !== 'online') return;
    pressing = true;
    releasedEarly = false;
    try {
      els.reactor.setPointerCapture(e.pointerId);
    } catch (_) {
      /* ok */
    }
    startRec();
  });
  const release = () => {
    if (!pressing) return;
    pressing = false;
    if (rec) stopRec(true);
    else releasedEarly = true;
  };
  els.reactor.addEventListener('pointerup', release);
  els.reactor.addEventListener('pointercancel', () => {
    pressing = false;
    if (rec) stopRec(false);
  });
  els.reactor.addEventListener('contextmenu', (e) => e.preventDefault());
  // Teclado: espaço/enter segurado também grava
  els.reactor.addEventListener('keydown', (e) => {
    if ((e.key === ' ' || e.key === 'Enter') && !e.repeat && !pressing && conn === 'online') {
      e.preventDefault();
      pressing = true;
      startRec();
    }
  });
  els.reactor.addEventListener('keyup', (e) => {
    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      release();
    }
  });

  els.composer.addEventListener('submit', (e) => {
    e.preventDefault();
    const t = els.input.value;
    els.input.value = '';
    sendText(t);
  });

  // ---------- pareamento ----------
  els.code.addEventListener('input', () => {
    const raw = els.code.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
    els.code.value = raw.length > 4 ? `${raw.slice(0, 4)}-${raw.slice(4)}` : raw;
    els.pairError.textContent = '';
  });

  els.pairForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const code = els.code.value.replace(/[^A-Za-z0-9]/g, '');
    if (code.length !== 8) {
      els.pairError.textContent = 'O código tem 8 letras e números.';
      return;
    }
    els.pairBtn.disabled = true;
    els.pairError.textContent = '';
    try {
      const r = await fetch('/api/jarvis-device/pair', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, name: /iPhone/i.test(navigator.userAgent) ? 'iPhone' : 'Celular', kind: 'phone' }),
        credentials: 'omit',
        cache: 'no-store'
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok || !data.token) {
        els.pairError.textContent = data.erro || 'Não deu certo. Peça outro código e tente de novo.';
        return;
      }
      token = data.token;
      store.set(K.token, token);
      els.code.value = '';
      show();
      connect();
    } catch (_) {
      els.pairError.textContent = 'Sem internet agora. Tente de novo.';
    } finally {
      els.pairBtn.disabled = false;
    }
  });

  function forget(msg) {
    token = null;
    store.set(K.token, null);
    store.set(K.push, null);
    history = [];
    saveLog();
    clearTimeout(retryTimer);
    if (ws) {
      try {
        ws.close();
      } catch (_) {
        /* ok */
      }
      ws = null;
    }
    conn = 'offline';
    unsubscribePush().catch(() => {});
    show();
    if (msg) els.pairError.textContent = msg;
  }

  function show() {
    const paired = !!token;
    els.pair.hidden = paired;
    els.talk.hidden = !paired;
    els.more.hidden = !paired;
    els.installTip.hidden = standalone;
    if (paired) renderHistory();
    paint();
  }

  // ---------- menu ----------
  function toggleMenu(open) {
    const on = open == null ? els.menu.hidden : open;
    els.menu.hidden = !on;
    els.more.setAttribute('aria-expanded', String(on));
  }
  els.more.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleMenu();
  });
  document.addEventListener('click', (e) => {
    if (!els.menu.hidden && !els.menu.contains(e.target)) toggleMenu(false);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') toggleMenu(false);
  });

  els.voiceToggle.setAttribute('aria-checked', String(voiceOn));
  els.voiceToggle.addEventListener('click', () => {
    voiceOn = !voiceOn;
    store.set(K.voice, voiceOn ? '1' : '0');
    els.voiceToggle.setAttribute('aria-checked', String(voiceOn));
    if (!voiceOn) stopSpeaking();
  });

  els.forget.addEventListener('click', () => {
    if (!window.confirm('Desconectar este celular do Jarvis? Pra voltar, precisa de um código novo.')) return;
    toggleMenu(false);
    // Avisa o servidor pra parar os avisos antes de largar o token
    send({ type: 'push_sub', sub: null });
    setTimeout(() => forget(null), 300);
  });

  // ---------- avisos (Web Push) ----------
  const pushSupported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  const PUSH_HINT = els.pushHint.textContent;

  function setPushUi(on, msg) {
    els.pushToggle.setAttribute('aria-checked', String(on));
    store.set(K.push, on ? '1' : null);
    els.pushHint.textContent = msg || PUSH_HINT;
  }

  function b64ToBytes(b64) {
    const pad = '='.repeat((4 - (b64.length % 4)) % 4);
    const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
    return Uint8Array.from(raw, (c) => c.charCodeAt(0));
  }

  async function registration() {
    return navigator.serviceWorker.register('sw.js', { scope: './' });
  }

  async function subscribePush() {
    if (!pushSupported || !standalone) {
      setPushUi(false, 'Pra receber avisos, adicione o Jarvis à Tela de Início (Compartilhar no Safari) e abra pelo ícone.');
      return;
    }
    if (!vapidKey) {
      setPushUi(false, 'Os avisos ainda não estão ligados no servidor.');
      return;
    }
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') {
      setPushUi(false, 'Sem permissão de notificação. Libere em Ajustes → Notificações → Jarvis.');
      return;
    }
    const reg = await registration();
    await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(vapidKey) });
    if (!send({ type: 'push_sub', sub: sub.toJSON() })) setPushUi(false, 'Sem conexão agora. Tente de novo.');
  }

  async function unsubscribePush() {
    if (!pushSupported) return;
    const reg = await navigator.serviceWorker.getRegistration('./');
    const sub = reg && (await reg.pushManager.getSubscription());
    if (sub) await sub.unsubscribe();
  }

  els.pushToggle.addEventListener('click', () => {
    const on = els.pushToggle.getAttribute('aria-checked') === 'true';
    if (on) {
      send({ type: 'push_sub', sub: null });
      unsubscribePush().catch(() => {});
      setPushUi(false);
    } else {
      subscribePush().catch(() => setPushUi(false, 'Não consegui ligar os avisos. Tente de novo.'));
    }
  });

  /** Ao conectar: se os avisos estavam ligados, reenvia a inscrição (o iPhone pode trocar) */
  function syncPush() {
    if (store.get(K.push) !== '1' || !pushSupported || !standalone || !vapidKey) {
      setPushUi(store.get(K.push) === '1');
      return;
    }
    (async () => {
      const reg = await navigator.serviceWorker.getRegistration('./');
      const sub = reg && (await reg.pushManager.getSubscription());
      if (sub) send({ type: 'push_sub', sub: sub.toJSON() });
      else setPushUi(false);
    })().catch(() => {});
  }

  // ---------- ciclo de vida (o iPhone derruba a conexão com o app em segundo plano) ----------
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      if (token && (!ws || ws.readyState > 1)) {
        retry = 0;
        connect();
      }
    } else if (rec) {
      stopRec(false);
    }
  });
  window.addEventListener('online', () => {
    retry = 0;
    connect();
  });

  if (pushSupported && standalone) registration().catch(() => {});
  show();
  connect();
})();
