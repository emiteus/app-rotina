/**
 * Known ops flag keys + project adapters.
 * Adapters sync live backends; without adapter, store is local-only.
 */

/** Semantic keys shared across projects (adapters map as needed). */
const COMMON_FLAGS = [
  {
    key: 'support_automation',
    label: 'Suporte automático (bot / auto-reply chat)',
    description: 'Pausa respostas automáticas de suporte'
  },
  {
    key: 'access_automation',
    label: 'Geração/provisionamento automático de acessos',
    description: 'Pausa criação automática de contas/acessos'
  },
  {
    key: 'support_email_autoreply',
    label: 'Auto-reply de email de suporte',
    description: 'Pausa resposta automática por email'
  }
];

/** @type {Record<string, { keys: string[], adapter?: string }>} */
const PROJECT_FLAGS = {
  cinerush: {
    keys: ['support_automation', 'access_automation', 'support_email_autoreply'],
    adapter: 'cinerush'
  }
  // Novos projetos: registre keys + adapter opcional.
  // Sem adapter → store local; Jarvis NÃO afirma pause live.
};

function knownKeysFor(projectId) {
  const cfg = PROJECT_FLAGS[projectId];
  if (cfg && cfg.keys && cfg.keys.length) return cfg.keys.slice();
  return COMMON_FLAGS.map((f) => f.key);
}

function flagMeta(key) {
  return COMMON_FLAGS.find((f) => f.key === key) || {
    key,
    label: key,
    description: 'Flag customizada'
  };
}

function adapterNameFor(projectId) {
  return (PROJECT_FLAGS[projectId] && PROJECT_FLAGS[projectId].adapter) || null;
}

function hasLiveAdapter(projectId) {
  return !!adapterNameFor(projectId);
}

module.exports = {
  COMMON_FLAGS,
  PROJECT_FLAGS,
  knownKeysFor,
  flagMeta,
  adapterNameFor,
  hasLiveAdapter
};
