/**
 * Briefs curados do ecossistema R:\Projetos — ciência operacional do Mateus.
 * Complementa o ingest automático (README/package). Atualize aqui quando um
 * projeto mudar de papel de verdade.
 *
 * Chave = id do knowledge/catalog (slug).
 */
/** @type {Record<string, {
 *   name: string,
 *   aliases?: string[],
 *   brief: string,
 *   people?: string[],
 *   stackHint?: string,
 *   wiredNote?: string
 * }>} */
const PROJECT_BRIEFS = {
  approtina: {
    name: 'App Rotina (Approtina)',
    aliases: ['rotina', 'atlas', 'hub', 'app rotina'],
    brief:
      'Host pessoal no Railway: tarefas, finanças (Open Finance), hábitos, metas, agenda, Assist e canal WhatsApp do Jarvis. Código em Approtina/app-rotina; Jarvis synca pra lib/jarvis.',
    stackHint: 'Node/Express + Postgres',
    wiredNote: 'É o host — tudo passa por aqui'
  },
  jarvis: {
    name: 'Jarvis OS',
    aliases: ['jarvis os', 'os'],
    brief:
      'Fonte de verdade do assistente (R:/Projetos/Jarvis). Tools, registry, memória, missões, ingest do ecossistema. Deploy = sync:host → app-rotina.',
    stackHint: 'Node CommonJS',
    wiredNote: 'Pacote, não serviço isolado'
  },
  cinerush: {
    name: 'CineRush TV',
    aliases: ['cine tv', 'cinehub', 'cine hub', 'iptv', 'havok', 'kirvano'],
    brief:
      'Produto streaming IPTV pro cliente final. Fluxo: venda Kirvano → assinante pendente → provision Havok (painel CineHub) + email/link config. Acesso manual: cinerush_criar. Suporte Chatwoot. NÃO confundir com o Editor de cortes.',
    people: ['Mateus'],
    stackHint: 'Node backend + Playwright Havok + admin/landing',
    wiredNote: 'Tools cinerush_* / chatwoot_*'
  },
  cinerush_editor: {
    name: 'CineRush Editor',
    aliases: ['editor', 'cortes em massa', 'editor video', 'editor cinerush'],
    brief:
      'Pasta Cinerush — esteira de cortes/vídeo em massa (produção). Independente do CineRush TV (assinantes). Tools: cinerush_editor_process/batch/job_status.',
    stackHint: 'Node + fila ops',
    wiredNote: 'CINERUSH_EDITOR_URL'
  },
  attracione: {
    name: 'Attracione',
    aliases: [
      'attra',
      'comp',
      'competicao',
      'competição',
      'ranking',
      'coleta',
      'views',
      'erik',
      'tiktok',
      'kwai',
      'cortes',
      'filmes'
    ],
    brief:
      'Competição de cortes / automação pra puxar views e quantidade de vídeos dos participantes (Mateus, Erik e outros) em plataformas tipo TikTok/Kwai — scraper Playwright + site attracionecomp.com.br + bot Discord. Ganhador diário, carteira, backup. Ops Jarvis: attracione_coleta, attracione_ranking, attracione_backup. Produção no Railway; scraper local no PC.',
    people: ['Mateus', 'Erik'],
    stackHint: 'Express + Playwright + Discord bot',
    wiredNote: 'ATTRACIONE_URL + SCRAPER_TOKEN'
  },
  attracione_2_0: {
    name: 'Attracione 2.0',
    aliases: ['attracione 2', 'attra 2'],
    brief:
      'Evolução/cópia de trabalho do Attracione (pasta Attracione 2.0). Mesma ideia de competição/scraper; ainda não plugada no hub Jarvis como connector separado.',
    people: ['Mateus', 'Erik'],
    wiredNote: 'unlinked — usar Attracione wired pra ops'
  },
  socialhub: {
    name: 'SocialHub (TeuHub)',
    aliases: ['teushub', 'posts', 'agendar post', 'instagram'],
    brief:
      'Agendamento e publicação de posts (Instagram etc.) em teushub.online. Tools: socialhub_posts, agendar, publicar_agendados.',
    stackHint: 'Next + Prisma',
    wiredNote: 'SOCIALHUB_URL + OPS_KEY'
  },
  clipper: {
    name: 'Clipper (Vortex)',
    aliases: ['vortex', 'clip', 'clips', 'fifa', 'ea fc'],
    brief:
      'Clipping multi-stream no PC (FIFA/EA FC etc.). Precisa CLIPPER_API_URL público/túnel pra Railway enxergar. Tools clipper_criar / retry.',
    wiredNote: 'off até túnel'
  },
  cutflix: {
    name: 'Cutflix',
    aliases: ['cut flix', 'templates video'],
    brief:
      'Plataforma de automação de vídeo com IA / templates (monorepo apps api+web+worker). No hub hoje: cutflix_status (health). Memória de projeto guarda stack/decisões.',
    stackHint: 'pnpm monorepo + Next/API',
    wiredNote: 'CUTFLIX_API_URL'
  },
  framerush: {
    name: 'FrameRush',
    aliases: ['frame rush', 'compositor', '9:16'],
    brief:
      'Editor desktop (Windows/Mac): posiciona 1 foto + vários vídeos em canvas 9:16 (1080×1920) e exporta em lote. Electron. Ainda unlinked no hub.',
    stackHint: 'Electron/Node',
    wiredNote: 'sem connector ainda'
  },
  viral_factory: {
    name: 'Viral Factory',
    aliases: ['viral factory', 'afiliados', 'reels'],
    brief:
      'App pra afiliados: página → reels virais → template → publicação. Next. Unlinked no hub.',
    stackHint: 'Next + React',
    wiredNote: 'unlinked'
  },
  app_prime: {
    name: 'App Prime',
    aliases: ['app prime', 'treino', 'dieta'],
    brief:
      'Next.js pra planos de treino e dieta com IA. Unlinked no hub.',
    stackHint: 'Next',
    wiredNote: 'unlinked'
  },
  projeto_milhao: {
    name: 'Projeto Milhão',
    aliases: ['projeto milhao', 'milhão', 'instagram alerta'],
    brief:
      'Monitor de postagens Instagram + alerta WhatsApp. Docker/Node. Unlinked.',
    wiredNote: 'unlinked'
  },
  scraper_service: {
    name: 'Scraper Service',
    aliases: ['scraper service', 'view scraper'],
    brief:
      'Scraper multi-plataforma de views pra competições de clips (Express+Playwright+Docker). Relacionado ao mundo Attracione/comps. Unlinked como connector próprio.',
    wiredNote: 'unlinked'
  },
  portfolio: {
    name: 'Portfolio',
    aliases: ['portfolio', 'site portfolio'],
    brief: 'Site portfolio (Vite/React). Unlinked.',
    wiredNote: 'unlinked'
  },
  discord_antinuke: {
    name: 'Discord Antinuke',
    aliases: ['antinuke', 'discord bot', 'among us'],
    brief:
      'Bot Discord de utilidades do servidor (ex. mute Among Us). Unlinked.',
    wiredNote: 'unlinked'
  },
  capcut_style_analyzer: {
    name: 'CapCut Style Analyzer',
    aliases: ['capcut', 'estilo edicao', 'perfil edicao'],
    brief:
      'Lê projetos CapCut Desktop (Windows) e extrai perfil/padrão de edição. Unlinked.',
    wiredNote: 'unlinked'
  },
  dashboard_visualizacoes: {
    name: 'Dashboard Visualizações',
    aliases: ['dashboard views', 'visualizacoes'],
    brief:
      'Dashboard de visualizações (pasta no Projets). Pouca doc no root — confirmar uso com Mateus. Unlinked.',
    wiredNote: 'unlinked / doc fraca'
  },
  euposto: {
    name: 'EuPosto',
    aliases: ['eu posto', 'euposto'],
    brief:
      'Projeto EuPosto na pasta R:/Projetos/EuPosto. Doc raiz fraca no ingest — aprofundar sob demanda. Unlinked.',
    wiredNote: 'unlinked / doc fraca'
  },
  evolution: {
    name: 'WhatsApp Evolution',
    aliases: ['whatsapp', 'wa', 'evolution', 'zap'],
    brief:
      'Canal WhatsApp do Jarvis via Evolution API (instância Approtina). Não é produto — é boca/ouvido.',
    wiredNote: 'EVOLUTION_*'
  }
};

function getBrief(id) {
  if (!id) return null;
  return PROJECT_BRIEFS[id] || null;
}

function listBriefs() {
  return Object.entries(PROJECT_BRIEFS).map(([id, b]) => ({ id, ...b }));
}

/** Bloco longo pro system prompt */
function getBriefsPromptBlock() {
  return Object.entries(PROJECT_BRIEFS)
    .map(([id, b]) => {
      const al = (b.aliases || []).slice(0, 8).join(', ');
      const people = b.people?.length ? ` | gente: ${b.people.join(', ')}` : '';
      return `- ${b.name} [${id}]${al ? ` — ${al}` : ''}${people}\n  ${b.brief}${
        b.wiredNote ? ` [${b.wiredNote}]` : ''
      }`;
    })
    .join('\n');
}

/** Resolve id por alias/NL */
function resolveBriefId(query) {
  const q = String(query || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
  if (!q) return null;
  if (PROJECT_BRIEFS[q]) return q;
  for (const [id, b] of Object.entries(PROJECT_BRIEFS)) {
    if (b.name.toLowerCase() === q) return id;
    for (const a of b.aliases || []) {
      const an = a
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '');
      if (an === q || (an.length >= 4 && (q.includes(an) || an.includes(q)))) return id;
    }
  }
  return null;
}

module.exports = {
  PROJECT_BRIEFS,
  getBrief,
  listBriefs,
  getBriefsPromptBlock,
  resolveBriefId
};
