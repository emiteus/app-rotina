/**
 * Voice continuous session — after audio in/out, keep TTS on for a while.
 * Env: JARVIS_VOICE_CONTINUOUS=1 (default on if TTS auto/always)
 */
/** @type {Map<string, number>} */
const sessions = new Map();

function continuousEnabled() {
  const v = String(process.env.JARVIS_VOICE_CONTINUOUS || '1').trim();
  if (v === '0' || v === 'off' || v === 'false') return false;
  return true;
}

function ttlMs() {
  const n = Number(process.env.JARVIS_VOICE_SESSION_TTL_MS || 10 * 60 * 1000);
  return Number.isFinite(n) && n >= 30_000 ? n : 10 * 60 * 1000;
}

function touchVoiceSession(userId) {
  if (!userId || !continuousEnabled()) return;
  sessions.set(String(userId), Date.now());
  if (sessions.size > 500) {
    const cutoff = Date.now() - ttlMs();
    for (const [k, ts] of sessions) {
      if (ts < cutoff) sessions.delete(k);
    }
  }
}

function isVoiceSessionActive(userId) {
  if (!userId || !continuousEnabled()) return false;
  const ts = sessions.get(String(userId));
  if (!ts) return false;
  if (Date.now() - ts > ttlMs()) {
    sessions.delete(String(userId));
    return false;
  }
  return true;
}

function clearVoiceSession(userId) {
  if (userId) sessions.delete(String(userId));
}

module.exports = {
  continuousEnabled,
  touchVoiceSession,
  isVoiceSessionActive,
  clearVoiceSession,
  ttlMs
};
