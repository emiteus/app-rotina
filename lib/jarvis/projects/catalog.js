/**
 * Project catalog (Phase 6) — metadata only; connectors stay in lib/*.js
 */

/** @typedef {{
 *   id: string,
 *   name: string,
 *   aliases: string[],
 *   description: string,
 *   snapshotKey: string|null,
 *   toolPrefixes: string[],
 *   env: string[],
 *   docsUrl: string|null,
 *   connector: string|null,
 *   readyExport: string|null,
 *   snapshotExport: string|null,
 *   ownerOnly: boolean
 * }} ProjectDef */

/** @type {ProjectDef[]} */
const PROJECT_CATALOG = [
  {
    id: 'approtina',
    name: 'App Rotina',
    aliases: ['rotina', 'app rotina', 'approtina', 'atlas', 'hub', 'jarvis'],
    description: 'Hub pessoal — tarefas, finanças, hábitos, metas, agenda',
    snapshotKey: null,
    toolPrefixes: [],
    env: [],
    docsUrl: null,
    connector: null,
    readyExport: null,
    snapshotExport: null,
    ownerOnly: false
  },
  {
    id: 'cinerush',
    name: 'CineRush TV',
    aliases: [
      'cinerush',
      'cine rush',
      'cine',
      'tv',
      'streaming',
      'havok',
      'kirvano',
      'chatwoot',
      'assinante',
      'assinantes'
    ],
    description: 'Streaming + Chatwoot suporte; ops via ADMIN_OPS_KEY',
    snapshotKey: 'cinerush',
    toolPrefixes: ['cinerush_', 'chatwoot_'],
    env: ['CINERUSH_BACKEND_URL', 'CINERUSH_OPS_KEY'],
    docsUrl: null,
    connector: '../../cinerush',
    readyExport: 'cinerushReady',
    snapshotExport: 'getCinerushSnapshot',
    ownerOnly: true
  },
  {
    id: 'attracione',
    name: 'Attracione',
    aliases: ['attracione', 'attra', 'comp', 'competicao', 'competição', 'ranking', 'coleta'],
    description: 'Competições / coleta / ranking (X-Scraper-Token)',
    snapshotKey: 'attracione',
    toolPrefixes: ['attracione_'],
    env: ['ATTRACIONE_URL', 'ATTRACIONE_SCRAPER_TOKEN'],
    docsUrl: 'https://www.attracionecomp.com.br',
    connector: '../../attracione',
    readyExport: 'attracioneReady',
    snapshotExport: 'getAttracioneSnapshot',
    ownerOnly: true
  },
  {
    id: 'socialhub',
    name: 'SocialHub',
    aliases: ['socialhub', 'social hub', 'teushub', 'posts', 'agendar post', 'instagram'],
    description: 'Agendamento e publicação de posts (OPS/CRON)',
    snapshotKey: 'socialhub',
    toolPrefixes: ['socialhub_'],
    env: ['SOCIALHUB_URL', 'SOCIALHUB_OPS_KEY'],
    docsUrl: 'https://teushub.online',
    connector: '../../socialhub',
    readyExport: 'socialhubReady',
    snapshotExport: 'getSocialhubSnapshot',
    ownerOnly: true
  },
  {
    id: 'clipper',
    name: 'Clipper (Vortex)',
    aliases: ['clipper', 'vortex', 'clip', 'clips'],
    description: 'Clips no PC local via túnel (CLIPPER_API_URL)',
    snapshotKey: 'clipper',
    toolPrefixes: ['clipper_'],
    env: ['CLIPPER_API_URL', 'CLIPPER_API_KEY'],
    docsUrl: null,
    connector: '../../clipper',
    readyExport: 'clipperReady',
    snapshotExport: 'getClipperSnapshot',
    ownerOnly: true
  },
  {
    id: 'cinerush_editor',
    name: 'CineRush Editor (massa)',
    aliases: ['editor video', 'editor em massa', 'video editor', 'editor cinerush'],
    description: 'Editor de vídeo em massa — ainda NÃO ligado ao Jarvis hub',
    snapshotKey: null,
    toolPrefixes: [],
    env: [],
    docsUrl: null,
    connector: null,
    readyExport: null,
    snapshotExport: null,
    ownerOnly: true,
    wired: false
  },
  {
    id: 'evolution',
    name: 'WhatsApp (Evolution)',
    aliases: ['whatsapp', 'wa', 'evolution', 'zap'],
    description: 'Canal WhatsApp — instância Evolution separada',
    snapshotKey: null,
    toolPrefixes: [],
    env: ['EVOLUTION_URL', 'EVOLUTION_API_KEY', 'EVOLUTION_INSTANCE'],
    docsUrl: null,
    connector: null,
    readyExport: null,
    snapshotExport: null,
    ownerOnly: true
  }
];

module.exports = { PROJECT_CATALOG };
