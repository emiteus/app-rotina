/**
 * OpenAI como reserva (voz e ouvir): sem crédito/chave recusada → pula ela por 10 min,
 * pra cada pedido não pagar a ida e volta de um "sem crédito".
 * Compartilhado entre a voz (tts.js) e o ouvir (ingress.js).
 */
const COOLDOWN_MS = 10 * 60 * 1000;
let downUntil = 0;

function openaiKey() {
  return process.env.OPENAI_API_KEY || process.env.JARVIS_WHISPER_KEY || null;
}

function isDown(now = Date.now()) {
  return now < downUntil;
}

/** Marca fora por 10 min se a resposta for de crédito/limite/chave. */
function noteHttpFailure(status, body = '') {
  if (status === 429 || status === 401 || /insufficient_quota|credit/i.test(String(body))) {
    downUntil = Date.now() + COOLDOWN_MS;
    return true;
  }
  return false;
}

function available() {
  return !!openaiKey() && !isDown();
}

function _reset() {
  downUntil = 0;
}

module.exports = { openaiKey, isDown, noteHttpFailure, available, COOLDOWN_MS, _reset };
