/**
 * Infer ops_flag_* actions from NL — any project with known keys.
 * Prefer real pause/resume over memory notes.
 */
const {
  hasStopOrNegationIntent,
  hasAnyWholeWord,
  looksLikeStatusConfirmOnly
} = require('../../nl/pt');
const { resolveProject, resolveProjectsFromMessage } = require('../../projects/registry');
const { knownKeysFor, PROJECT_FLAGS } = require('./registry');

function wantsResume(mensagem) {
  const t = String(mensagem || '');
  return (
    hasAnyWholeWord(t, [
      'retomar',
      'retoma',
      'reativar',
      'reativa',
      'religa',
      'religar',
      'voltar',
      'liga',
      'ligar',
      'ativar',
      'ative'
    ]) || /\b(liga|ativa|retoma)\s+(as\s+)?automa/i.test(t)
  );
}

function resolveTargetProject(mensagem) {
  const hits = resolveProjectsFromMessage(mensagem) || [];
  for (const id of hits) {
    if (PROJECT_FLAGS[id]) return id;
  }
  // Free-form aliases not always in message resolver
  const p =
    resolveProject(mensagem) ||
    (/\b(cine\s*rush|cinerush|cinehub|havok|chatwoot|kirvano)\b/i.test(mensagem)
      ? resolveProject('cinerush')
      : null);
  if (p && PROJECT_FLAGS[p.id]) return p.id;
  if (/\b(cine\s*rush|cinerush|cinehub|havok|chatwoot)\b/i.test(mensagem)) {
    return 'cinerush';
  }
  return null;
}

/**
 * Which flag keys the message mentions. Empty = all known for project
 * when message talks about "automações" generically.
 */
function pickKeys(mensagem, projectId) {
  const t = String(mensagem || '').toLowerCase();
  const known = knownKeysFor(projectId);
  const picked = new Set();

  const supportChat = /\b(suporte|conversas?|chatwoot|bot\b|atendimento)\b/i.test(t);
  const supportEmail =
    /\b(e-?mail|autoreply|auto-?reply)\b/i.test(t) ||
    /\benvio\s+de\s+acessos?\s+(no\s+|por\s+)?e-?mail\b/i.test(t) ||
    /\be-?mail\s+de\s+suporte\b/i.test(t);
  const access =
    /\b(gera[cç][aã]o|provision|havok|cinehub|acessos?)\b/i.test(t) ||
    /\bgera[cç][aã]o\s+de\s+acessos?\b/i.test(t);

  if (supportChat && known.includes('support_automation')) {
    picked.add('support_automation');
  }
  if (supportEmail && known.includes('support_email_autoreply')) {
    picked.add('support_email_autoreply');
  }
  // "envio de acessos no email" after provision = access pipeline + cred email
  if (
    /\benvio\s+de\s+acessos?\b/i.test(t) &&
    known.includes('access_automation')
  ) {
    picked.add('access_automation');
  }
  if (access && known.includes('access_automation')) {
    picked.add('access_automation');
  }

  // "pause as automações" / "tudo" / plural sem detalhe → todas
  const allHint =
    /\bautoma/i.test(t) ||
    /\btudo\b/i.test(t) ||
    /\btodas?\b/i.test(t) ||
    /\bpaus[ae].{0,40}(cine|havok|suporte|acesso)/i.test(t);

  if (!picked.size && allHint) {
    return known.slice();
  }
  // Pediu pause de suporte E acessos sem citar email → inclui email de suporte
  // (pacote "automações de suporte" costuma abranger chat+email)
  if (
    picked.has('support_automation') &&
    !picked.has('support_email_autoreply') &&
    known.includes('support_email_autoreply') &&
    /\bautoma/i.test(t)
  ) {
    picked.add('support_email_autoreply');
  }
  return [...picked];
}

/**
 * @returns {Array<{tipo:string, project:string, key:string, enabled:boolean, note?:string}>}
 */
function inferOpsFlagActionsFromMessage(mensagem) {
  const t = String(mensagem || '').trim();
  if (!t) return [];
  if (looksLikeStatusConfirmOnly(t)) return [];

  const resume = wantsResume(t);
  const stop = hasStopOrNegationIntent(t);
  if (!resume && !stop) return [];
  // Resume without "automação/flag" noise — still ok if project+ligar

  const projectId = resolveTargetProject(t);
  if (!projectId) return [];

  // Must look like ops pause/resume, not generic "não vamos mais" about something else
  const opsContext =
    /\b(automa|flag|suporte|acesso|provision|havok|chatwoot|cinehub|bot|e-?mail)\b/i.test(
      t
    );
  if (!opsContext) return [];

  const keys = pickKeys(t, projectId);
  if (!keys.length) return [];

  // stop wins over resume if both appear
  const wantEnabled = stop ? false : true;
  const note = wantEnabled ? 'Retomado via Jarvis' : 'Pausado via Jarvis';

  return keys.map((key) => ({
    tipo: 'ops_flag_set',
    project: projectId,
    key,
    enabled: wantEnabled,
    note
  }));
}

module.exports = {
  inferOpsFlagActionsFromMessage,
  pickKeys,
  resolveTargetProject,
  wantsResume
};
