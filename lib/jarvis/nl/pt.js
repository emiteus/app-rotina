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
      'pausar',
      'desligar',
      'desliga',
      'desativar',
      'desative',
      'suspender',
      'suspende',
      'cancelar',
      'cancela'
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

module.exports = {
  hasWholeWord,
  hasAnyWholeWord,
  hasStopOrNegationIntent,
  hasCreateIntent
};
