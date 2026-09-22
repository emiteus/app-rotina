/**
 * Matching de NL em português — genérico.
 * Em JS, \b trata ç/ã/õ como "não-letra", então \bgera\b casa dentro de "geração".
 */

function escapeRe(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Palavra inteira com letras Unicode (não quebra em ç/ã). */
function hasWholeWord(text, word) {
  const w = escapeRe(String(word || '').trim());
  if (!w) return false;
  return new RegExp(`(?:^|[^\\p{L}\\p{N}_])${w}(?:$|[^\\p{L}\\p{N}_])`, 'iu').test(
    String(text || '')
  );
}

function hasAnyWholeWord(text, words) {
  return (words || []).some((w) => hasWholeWord(text, w));
}

/**
 * Intent de negar / parar / desligar (genérico — não é de um produto).
 */
function hasStopOrNegationIntent(mensagem) {
  const t = String(mensagem || '');
  if (
    hasAnyWholeWord(t, [
      'pause',
      'pausa',
      'pausar',
      'desligar',
      'desliga',
      'desativar',
      'desative',
      'suspender',
      'suspende',
      'cancelar',
      'cancela',
      'parar',
      'pare'
    ])
  ) {
    return true;
  }
  if (/\bn[aã]o\s+(vamos|quero|preciso|pe[cç]o|pe[cç]a)\b/i.test(t)) return true;
  if (/\bn[aã]o\s+vamos\s+mais\b/i.test(t)) return true;
  if (/\bsem\s+mais\b/i.test(t)) return true;
  if (/\bparar\s+de\b/i.test(t)) return true;
  return false;
}

/**
 * Intent afirmativo de criar/gerar algo (evita stem "gera" ⊂ "geração").
 */
function hasCreateIntent(mensagem) {
  const t = String(mensagem || '');
  if (hasStopOrNegationIntent(t)) return false;
  // Substantivo "geração" / "criação" sozinhos não são pedido de criar
  if (hasWholeWord(t, 'geração') || hasWholeWord(t, 'geracao')) {
    if (!hasAnyWholeWord(t, ['criar', 'gerar', 'crie', 'cadastre', 'cadastrar'])) {
      return false;
    }
  }
  if (hasAnyWholeWord(t, ['criar', 'gerar', 'crie', 'cadastrar', 'cadastre'])) return true;
  if (/\b(novo\s+acesso|acesso\s+novo|assinante\s+novo)\b/i.test(t)) return true;
  if (/\bgera(?:r)?\s+(?:um\s+)?acesso\b/i.test(t)) return true;
  if (/\bcria(?:r)?\s+(?:um\s+)?acesso\b/i.test(t)) return true;
  return false;
}

/**
 * Intent de confirmar pagamento de conta/despesa (não "me confirma pfv").
 */
function hasConfirmPaymentIntent(mensagem) {
  const t = String(mensagem || '');
  if (/\b(?:j[aá]\s+)?paguei\b/i.test(t)) return true;
  if (/\bconfirm[ao]\s+pagamento\b/i.test(t)) return true;
  if (
    /\bconfirm[ao]\s+(?:a\s+|o\s+)?(conta|boleto|fatura|despesa)\b/i.test(t)
  ) {
    return true;
  }
  // "me confirma" / "confirma pfv" / "confirma quando estiver" = discurso, não finança
  if (/\bme\s+confirma\b/i.test(t)) return false;
  if (/\bconfirm[ao]\s+(pfv|por\s+favor|a[ií]|isso|quando|assim|que|pra\s+mim)\b/i.test(t)) {
    return false;
  }
  return false;
}

/**
 * Pedido só de status/confirmação ("me confirma pfv", "já pausou?", "tá desligado?").
 * NÃO é pedido de mutar (pause/ligar) — use get/list, não set.
 */
function looksLikeStatusConfirmOnly(mensagem) {
  const t = String(mensagem || '').trim();
  if (!t) return false;
  if (hasStopOrNegationIntent(t)) return false;
  if (
    hasAnyWholeWord(t, [
      'pausar',
      'pause',
      'desligar',
      'desliga',
      'desativar',
      'ligar',
      'retomar',
      'reativar',
      'ativar'
    ])
  ) {
    return false;
  }
  if (/\bme\s+confirma\b/i.test(t)) return true;
  if (/\bconfirm[ao]\s+(pfv|por\s+favor|a[ií]|isso|quando|assim|pra\s+mim)\b/i.test(t)) {
    return true;
  }
  if (/\bassim\s+que\s+estiver\b/i.test(t)) return true;
  if (/\bj[aá]\s+(est[aá]|ficou|pausad|desligad|parad)/i.test(t)) return true;
  if (/\b(t[aá]|est[aá])\s+(tudo\s+)?(pausad|desligad|parad)/i.test(t)) return true;
  if (/\bconfirm[ao]\s+(o\s+)?(status|estado|se\s+)/i.test(t)) return true;
  return false;
}

/**
 * Extrai título pra confirmar_despesa a partir de pedido claro de pagamento.
 * @returns {string|null}
 */
function extractConfirmExpenseTitle(mensagem) {
  const t = String(mensagem || '').trim();
  if (!hasConfirmPaymentIntent(t)) return null;
  const mPago =
    t.match(/\b(?:j[aá]\s+)?paguei\s+(?:a\s+|o\s+)?(.+?)(?:\s+hoje|\s+ontem)?$/i) ||
    t.match(/\bconfirm[ao]\s+pagamento\s+(?:d[aeo]\s+)?(.+)$/i) ||
    t.match(/\bconfirm[ao]\s+(?:a\s+|o\s+)?(?:conta|boleto|fatura|despesa)\s+(.+)$/i);
  if (!mPago) return null;
  const titulo = String(mPago[1] || '')
    .replace(/[.!?]+$/, '')
    .replace(/\b(pfv|por\s+favor)\b/gi, '')
    .trim();
  if (titulo.length < 2 || titulo.length > 80) return null;
  if (/^(pfv|por\s+favor|a[ií]|isso|quando|assim)$/i.test(titulo)) return null;
  return titulo;
}

module.exports = {
  hasWholeWord,
  hasAnyWholeWord,
  hasStopOrNegationIntent,
  hasCreateIntent,
  hasConfirmPaymentIntent,
  looksLikeStatusConfirmOnly,
  extractConfirmExpenseTitle
};

