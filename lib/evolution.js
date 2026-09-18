/** Cliente Evolution API (sendText) — mesma stack do CineRush. */
function evolutionBase() {
  return String(process.env.EVOLUTION_URL || '').replace(/\/+$/, '');
}

function evolutionReady() {
  return !!(
    process.env.EVOLUTION_URL &&
    process.env.EVOLUTION_API_KEY &&
    process.env.EVOLUTION_INSTANCE
  );
}

/** Normaliza telefone BR → dígitos com país (55…). */
function normalizeWaId(input) {
  if (!input) return null;
  let d = String(input).replace(/\D/g, '');
  if (!d) return null;
  if (d.startsWith('55') && d.length >= 12) return d;
  if (d.length === 10 || d.length === 11) return `55${d}`;
  return d;
}

function phonesAllowed() {
  const raw = process.env.WHATSAPP_ALLOWED_PHONES || '';
  return raw
    .split(/[,;\s]+/)
    .map((p) => normalizeWaId(p))
    .filter(Boolean);
}

/** Variantes BR: com/sem o 9 após o DDD (12 vs 13 dígitos com 55). */
function phoneVariants(phone) {
  const n = normalizeWaId(phone);
  if (!n) return [];
  const set = new Set([n]);
  if (n.startsWith('55') && n.length === 13 && n[4] === '9') {
    set.add(n.slice(0, 4) + n.slice(5)); // 55DD9XXXXXXXX → 55DDXXXXXXXX
  }
  if (n.startsWith('55') && n.length === 12) {
    set.add(n.slice(0, 4) + '9' + n.slice(4)); // 55DDXXXXXXXX → 55DD9XXXXXXXX
  }
  return [...set];
}

function isPhoneAllowed(phone) {
  const variants = phoneVariants(phone);
  if (!variants.length) return false;
  const list = phonesAllowed();
  if (!list.length) return false;
  const allowed = new Set(list.flatMap((a) => phoneVariants(a)));
  return variants.some((v) => allowed.has(v));
}

/** Markdown leve → texto WhatsApp. */
function textoParaWhatsApp(md) {
  return String(md || '')
    .replace(/\*\*(.+?)\*\*/g, '*$1*')
    .replace(/__(.+?)__/g, '*$1*')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 ($2)')
    .trim()
    .slice(0, 4000);
}

/** Remove XML/tool-call leakage do texto final do WA. */
function stripToolLeakage(texto) {
  let s = String(texto || '');
  s = s.replace(/```(?:xml|tool|function)?\s*[\s\S]*?```/gi, ' ');
  s = s.replace(/<function_calls?>[\s\S]*?<\/function_calls?>/gi, ' ');
  s = s.replace(/<\/?function_calls?>/gi, ' ');
  s = s.replace(/<tool_call[\s\S]*?<\/tool_call>/gi, ' ');
  s = s.replace(/<invoke\b[^>]*>[\s\S]*?<\/invoke>/gi, ' ');
  s = s.replace(/\binvoke\s+(?:tool\s+)?[\w_]+\s+with\b[^\n]*/gi, ' ');
  s = s.replace(/\n{3,}/g, '\n\n').trim();
  return s;
}

/**
 * Mostra "digitando…" / "gravando…" no chat (Evolution presence).
 * delayMs = quanto tempo o indicador fica ativo no cliente.
 */
async function sendPresence(to, presence = 'composing', delayMs = 5000) {
  if (!evolutionReady()) return { skipped: true };
  if (process.env.JARVIS_WA_TYPING === '0') return { skipped: true };
  const number = normalizeWaId(to);
  if (!number) return { skipped: true };
  const delay = Math.max(500, Math.min(Number(delayMs) || 5000, 25000));
  const instance = process.env.EVOLUTION_INSTANCE;
  const headers = {
    apikey: process.env.EVOLUTION_API_KEY,
    'Content-Type': 'application/json'
  };
  const attempts = [
    {
      url: `${evolutionBase()}/chat/sendPresence/${instance}`,
      body: { number, options: { delay, presence } }
    },
    {
      url: `${evolutionBase()}/chat/sendPresence/${instance}`,
      body: { number, presence, delay }
    },
    {
      url: `${evolutionBase()}/message/sendPresence/${instance}`,
      body: { number, options: { delay, presence } }
    }
  ];
  for (const a of attempts) {
    try {
      const res = await fetch(a.url, {
        method: 'POST',
        headers,
        body: JSON.stringify(a.body),
        signal: AbortSignal.timeout(8000)
      });
      if (res.ok) return { ok: true };
    } catch (_) {
      /* try next */
    }
  }
  return { ok: false };
}

/**
 * Mantém "digitando…" vivo enquanto o Jarvis processa (WA some em ~few s).
 * Retorna stop() pra pausar ao enviar a resposta.
 */
function startTypingIndicator(to) {
  let stopped = false;
  let timer = null;
  const pulse = async () => {
    if (stopped) return;
    try {
      await sendPresence(to, 'composing', 8000);
    } catch (_) {
      /* ignore */
    }
    if (!stopped) timer = setTimeout(pulse, 3500);
  };
  pulse();
  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
    sendPresence(to, 'paused', 500).catch(() => {});
  };
}

async function sendText(to, text) {
  if (!evolutionReady()) {
    throw new Error('Evolution não configurada (EVOLUTION_URL/API_KEY/INSTANCE)');
  }
  const number = normalizeWaId(to);
  if (!number) throw new Error('número inválido');
  const body = textoParaWhatsApp(text);
  if (!body) return { skipped: true };

  const url = `${evolutionBase()}/message/sendText/${process.env.EVOLUTION_INSTANCE}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      apikey: process.env.EVOLUTION_API_KEY,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ number, text: body, linkPreview: false }),
    signal: AbortSignal.timeout(20000)
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data?.message || data?.error || `Evolution HTTP ${res.status}`);
  }
  return data;
}

/**
 * Botões reply (HITL). Opt-in: JARVIS_HITL_BUTTONS=1.
 * Default off — WA Web/multi-device não renderiza sendButtons.
 */
async function sendButtons(to, { title, description, footer, buttons }) {
  if (!evolutionReady()) {
    throw new Error('Evolution não configurada');
  }
  if (process.env.JARVIS_HITL_BUTTONS !== '1') {
    const idFromBtn = ((buttons || [])[0]?.id || '').match(/jarvis_sim_([a-f0-9]{6,12})/i);
    const hitlId = idFromBtn ? idFromBtn[1] : '';
    return sendText(
      to,
      [
        title,
        description,
        '',
        hitlId ? `Responde *SIM ${hitlId}* ou *NÃO ${hitlId}*.` : null
      ]
        .filter(Boolean)
        .join('\n')
    );
  }

  const number = normalizeWaId(to);
  if (!number) throw new Error('número inválido');
  const btns = (buttons || []).slice(0, 3).map((b, i) => ({
    type: 'reply',
    displayText: String(b.displayText || b.text || `Opção ${i + 1}`).slice(0, 20),
    id: String(b.id || `btn_${i}`).slice(0, 40)
  }));
  if (!btns.length) return sendText(to, description || title || '');

  const desc = textoParaWhatsApp(description || '');
  const url = `${evolutionBase()}/message/sendButtons/${process.env.EVOLUTION_INSTANCE}`;

  const payloads = [
    {
      number,
      title: String(title || 'Jarvis').slice(0, 60),
      description: desc.slice(0, 900),
      footer: String(footer || 'Jarvis HITL').slice(0, 60),
      buttons: btns
    },
    // Formato alternativo (algumas builds Evolution)
    {
      number,
      buttonMessage: {
        title: String(title || 'Jarvis').slice(0, 60),
        description: desc.slice(0, 900),
        footerText: String(footer || 'Jarvis HITL').slice(0, 60),
        buttons: btns.map((b) => ({
          buttonId: b.id,
          buttonText: { displayText: b.displayText },
          type: 1
        }))
      }
    }
  ];

  let lastErr = null;
  for (const body of payloads) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          apikey: process.env.EVOLUTION_API_KEY,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(20000)
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        console.log(
          JSON.stringify({
            tag: 'jarvis.wa',
            event: 'buttons_sent',
            number,
            buttons: btns.map((b) => b.id)
          })
        );
        return data;
      }
      lastErr = new Error(data?.message || data?.error || `Evolution buttons HTTP ${res.status}`);
    } catch (e) {
      lastErr = e;
    }
  }

  console.log(
    JSON.stringify({
      tag: 'jarvis.wa',
      event: 'buttons_fallback_text',
      error: lastErr && lastErr.message
    })
  );
  const idFromBtn = (btns[0]?.id || '').match(/jarvis_sim_([a-f0-9]{6,12})/i);
  const hitlId = idFromBtn ? idFromBtn[1] : '';
  return sendText(
    to,
    [
      title,
      description,
      '',
      hitlId
        ? `Responde *SIM ${hitlId}* ou *NÃO ${hitlId}*.`
        : 'Responde *SIM <id>* ou *NÃO <id>*.'
    ]
      .filter(Boolean)
      .join('\n')
  );
}

/** HITL: mensagem + botões SIM / NÃO */
async function sendApprovalButtons(to, text, approvalId) {
  const id = approvalId ? String(approvalId).slice(0, 12) : '';
  return sendButtons(to, {
    title: 'Confirmação Jarvis',
    description: textoParaWhatsApp(text || 'Confirma a ação?'),
    footer: id ? `id ${id}` : 'HITL',
    buttons: [
      { id: id ? `jarvis_sim_${id}` : 'jarvis_sim', displayText: 'SIM' },
      { id: id ? `jarvis_nao_${id}` : 'jarvis_nao', displayText: 'NÃO' }
    ]
  });
}

/**
 * Envia áudio/PTT (voice note). Aceita base64 limpo ou data-URL.
 * Tenta payload v2 e v1 da Evolution.
 */
async function sendWhatsAppAudio(to, audioBase64, opts = {}) {
  if (!evolutionReady()) {
    throw new Error('Evolution não configurada (EVOLUTION_URL/API_KEY/INSTANCE)');
  }
  const number = normalizeWaId(to);
  if (!number) throw new Error('número inválido');
  let audio = String(audioBase64 || '').replace(/^data:[^;]+;base64,/, '').replace(/\s+/g, '');
  if (!audio) throw new Error('áudio vazio');

  const delay = Math.max(0, Math.min(Number(opts.delay) || 1200, 15000));
  const instance = process.env.EVOLUTION_INSTANCE;
  const url = `${evolutionBase()}/message/sendWhatsAppAudio/${instance}`;
  const headers = {
    apikey: process.env.EVOLUTION_API_KEY,
    'Content-Type': 'application/json'
  };

  try {
    await sendPresence(to, 'recording', Math.min(delay + 2000, 8000));
  } catch (_) {
    /* ignore */
  }

  const payloads = [
    { number, audio, delay, encoding: true },
    {
      number,
      options: { delay, presence: 'recording', encoding: true },
      audioMessage: { audio }
    }
  ];

  let lastErr = null;
  for (const body of payloads) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(60000)
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        console.log(
          JSON.stringify({
            tag: 'jarvis.wa',
            event: 'audio_sent',
            number,
            bytesApprox: Math.floor((audio.length * 3) / 4)
          })
        );
        return data;
      }
      lastErr = new Error(data?.message || data?.error || `Evolution audio HTTP ${res.status}`);
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error('Evolution audio falhou');
}

module.exports = {
  evolutionReady,
  normalizeWaId,
  phonesAllowed,
  phoneVariants,
  isPhoneAllowed,
  textoParaWhatsApp,
  stripToolLeakage,
  sendPresence,
  startTypingIndicator,
  sendText,
  sendButtons,
  sendApprovalButtons,
  sendWhatsAppAudio
};
