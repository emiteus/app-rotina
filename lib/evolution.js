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
 * Botões reply (HITL). Fallback → sendText se a API não suportar.
 * Env: JARVIS_HITL_BUTTONS=0 desliga.
 */
async function sendButtons(to, { title, description, footer, buttons }) {
  if (!evolutionReady()) {
    throw new Error('Evolution não configurada');
  }
  if (process.env.JARVIS_HITL_BUTTONS === '0') {
    return sendText(to, [title, description].filter(Boolean).join('\n'));
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

module.exports = {
  evolutionReady,
  normalizeWaId,
  phonesAllowed,
  phoneVariants,
  isPhoneAllowed,
  textoParaWhatsApp,
  sendText,
  sendButtons,
  sendApprovalButtons
};
