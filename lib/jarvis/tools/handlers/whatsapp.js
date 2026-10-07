/**
 * Entrega sob pedido pro WhatsApp do dono (Evolution).
 * Diferente do ping proativo: não depende de JARVIS_PROACTIVE_WA / flag proactive_wa.
 * Destino = só phonesAllowed() — nunca número arbitrário.
 */
const TYPES = new Set(['wa_send_owner']);
const MAX_CHARS = 1500;

async function handle(acao, ctx) {
  const tipo = acao && acao.tipo;
  if (!TYPES.has(tipo)) return null;

  const { requireLib } = require('../../host');
  const { isPlanoOwnerUserId } = requireLib('plano-owner');
  if (!(await isPlanoOwnerUserId(ctx.userId))) {
    return { tipo, ok: false, erro: 'só owner' };
  }

  const texto = String(acao.texto || acao.mensagem || acao.body || '')
    .replace(/\r\n/g, '\n')
    .trim()
    .slice(0, MAX_CHARS);
  if (texto.length < 2) {
    return { tipo, ok: false, erro: 'falta o texto pra mandar no WhatsApp' };
  }

  try {
    const { evolutionReady, sendText, phonesAllowed } = requireLib('evolution');
    if (!evolutionReady()) {
      return {
        tipo,
        ok: false,
        erro: 'WhatsApp do Jarvis (Evolution) não está pronto agora'
      };
    }
    const phones = phonesAllowed();
    if (!phones.length) {
      return {
        tipo,
        ok: false,
        erro: 'nenhum número liberado no WhatsApp (WHATSAPP_ALLOWED_PHONES)'
      };
    }
    await sendText(phones[0], texto);
    console.log(
      JSON.stringify({
        tag: 'jarvis.wa',
        event: 'send_owner',
        userId: ctx.userId,
        chars: texto.length,
        phone: `…${String(phones[0]).slice(-4)}`
      })
    );
    return {
      tipo,
      ok: true,
      chars: texto.length,
      texto: 'Mandei no seu WhatsApp.'
    };
  } catch (e) {
    return {
      tipo,
      ok: false,
      erro: String(e.message || e).slice(0, 200) || 'não consegui enviar no WhatsApp'
    };
  }
}

module.exports = { TYPES, handle, MAX_CHARS };
