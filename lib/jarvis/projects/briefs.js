/**
 * Briefs curados do ecossistema R:\Projetos — ciência operacional do Mateus.
 * Fonte de verdade do "o que é cada projeto". Complementa ingest (README/package).
 * Atualize aqui quando um projeto mudar de papel de verdade.
 *
 * Chave = id do knowledge/catalog (slug).
 */
/** @type {Record<string, {
 *   name: string,
 *   aliases?: string[],
 *   brief: string,
 *   people?: string[],
 *   stackHint?: string,
 *   wiredNote?: string,
 *   related?: string[],
 *   urls?: string[]
 * }>} */
const PROJECT_BRIEFS = {
  approtina: {
    name: 'App Rotina (Approtina)',
    aliases: ['rotina', 'atlas', 'hub', 'app rotina', 'host jarvis', 'dashboard pessoal'],
    brief:
      'Host pessoal no Railway: tarefas, finanças (Open Finance), hábitos, metas, agenda, Assist web e canal WhatsApp do Jarvis (Evolution). Código em Approtina/app-rotina; Jarvis synca pra lib/jarvis via npm run sync:host. Também tem Electron desktop + apps mobile Expo na pasta. É a boca/ouvido de quase tudo wired.',
    people: ['Mateus'],
    stackHint: 'Express + Postgres + Playwright + Electron/Expo',
    wiredNote: 'HOST — tudo passa por aqui',
    related: ['jarvis', 'attracione', 'cinerush', 'cinerush_editor', 'socialhub', 'clipper', 'cutflix', 'evolution'],
    urls: ['http://localhost:3000']
  },
  jarvis: {
    name: 'Jarvis OS',
    aliases: ['jarvis os', 'os', 'assistente', 'hub jarvis'],
    brief:
      'Fonte de verdade do assistente (R:/Projetos/Jarvis): tools, registry, memória de projeto, missões, ingest do ecossistema, briefs. Deploy = sync:host → Approtina/app-rotina (Railway). Não é serviço isolado — é o cérebro que roda dentro do host.',
    people: ['Mateus'],
    stackHint: 'Node CommonJS + axios',
    wiredNote: 'Pacote syncado pro host',
    related: ['approtina', 'cinerush', 'cinerush_editor', 'attracione', 'socialhub', 'clipper', 'cutflix']
  },
  evolution: {
    name: 'WhatsApp Evolution',
    aliases: ['whatsapp', 'wa', 'evolution', 'zap', 'canal whatsapp'],
    brief:
      'Canal WhatsApp do Jarvis via Evolution API (instância Approtina no Hetzner). Também usado por CineRush TV (suporte) e Projeto Milhão (relatórios no grupo). Não é produto — é boca/ouvido compartilhado.',
    people: ['Mateus'],
    wiredNote: 'EVOLUTION_URL / API_KEY / INSTANCE',
    related: ['approtina', 'cinerush', 'projeto_milhao']
  },
  cinerush: {
    name: 'CineRush TV',
    aliases: [
      'cine tv',
      'cinehub',
      'cine hub',
      'iptv',
      'havok',
      'kirvano',
      'assinante',
      'assinantes',
      'streaming',
      'cinerush tv'
    ],
    brief:
      'Produto IPTV pro cliente final (pasta CineRushTV). Fluxo: venda Kirvano → webhook → assinante pendente → provision Havok/CineHub + email Brevo + link config. Monorepo: backend Express/TS (Railway+BullMQ/Redis/Playwright), landing, admin, afiliados, support Chatwoot. Acesso manual: cinerush_criar com email REAL. NÃO confundir com o Editor de cortes (pasta Cinerush).',
    people: ['Mateus'],
    stackHint: 'Express/TS + Supabase + BullMQ + Playwright + Brevo + Chatwoot',
    wiredNote: 'Tools cinerush_* / chatwoot_* — CINERUSH_BACKEND_URL + OPS_KEY',
    related: ['cinerush_editor', 'jarvis', 'approtina', 'discord_antinuke'],
    urls: ['https://cinerush-tv-backend-production.up.railway.app']
  },
  cinerush_editor: {
    name: 'CineRush Editor',
    aliases: [
      'editor',
      'cortes em massa',
      'editor video',
      'editor cinerush',
      'cinerush.app',
      'esteira de cortes',
      'viral editor'
    ],
    brief:
      'Pasta Cinerush — esteira de cortes/vídeo em massa (produção de reels), SEPARADA do CineRush TV. Backend FastAPI (fila, templates, OCR/headlines IA, Meta/IG agendado) + frontend + Electron local. Prod em cinerush.app (Hetzner/Docker). Jarvis: cinerush_editor_process/batch/job_status. Relacionado a FrameRush (compositor 9:16) e CapCut analyzer.',
    people: ['Mateus', 'Erik'],
    stackHint: 'Python FastAPI + Electron + FFmpeg + Groq/Gemini + Docker',
    wiredNote: 'CINERUSH_EDITOR_URL + OPS_KEY',
    related: ['cinerush', 'framerush', 'capcut_style_analyzer', 'socialhub', 'cutflix', 'attracione'],
    urls: ['https://cinerush.app']
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
      'filmes',
      'attracionecomp',
      'competicao de cortes'
    ],
    brief:
      'Competição de cortes (Mateus, Erik e outros): site attracionecomp.com.br (ranking, carteira, ganhadores, anti-fraude) + scraper Playwright local no PC (TikTok bloqueia datacenter) + bot Discord. Coleta puxa views e qtd de vídeos. Ops Jarvis: attracione_coleta / ranking / backup. Site+bot no VPS Hetzner; coleta automática off na VPS — roda no PC. Dashboard ranking e scraper-service são satélites.',
    people: ['Mateus', 'Erik'],
    stackHint: 'Express + Playwright + Discord + Docker',
    wiredNote: 'ATTRACIONE_URL + SCRAPER_TOKEN',
    related: [
      'attracione_2_0',
      'scraper_service',
      'dashboard_visualizacoes',
      'projeto_milhao',
      'framerush',
      'capcut_style_analyzer'
    ],
    urls: ['https://www.attracionecomp.com.br']
  },
  attracione_2_0: {
    name: 'Attracione 2.0',
    aliases: ['attracione 2', 'attra 2', 'attracione dois', 'attracione bot', 'attracione nova'],
    brief:
      'Next-gen do Attracione: fork do site + bot Discord reescrito (Attracione-bot) com cadastro por modal, espelho Google Sheets e tickets staff. Bot em Railway (attracione-bot); ainda unlinked no Jarvis — ops de coleta/ranking continuam no Attracione v1 wired.',
    people: ['Mateus', 'Erik'],
    stackHint: 'Express + Discord.js + TypeScript + Google Sheets',
    wiredNote: 'unlinked — ops via Attracione v1',
    related: ['attracione', 'scraper_service', 'dashboard_visualizacoes']
  },
  socialhub: {
    name: 'SocialHub (TeuHub)',
    aliases: ['teushub', 'teus hub', 'posts', 'agendar post', 'instagram', 'hub social', 'social hub'],
    brief:
      'Next.js pra gestão/agendamento multi-plataforma (YouTube, Instagram, Facebook, TikTok) com analytics, categorias e fila BullMQ. Prisma+Postgres. Prod: teushub.online. Snapshot: projetos.socialhub.hoje (posts PUBLISHED no dia). Tools: socialhub_posts / agendar / publicar_agendados. NÃO é Attracione.',
    people: ['Mateus'],
    stackHint: 'Next + Prisma + Postgres + BullMQ',
    wiredNote: 'SOCIALHUB_URL + OPS_KEY',
    related: ['jarvis', 'cutflix', 'cinerush_editor', 'euposto', 'viral_factory'],
    urls: ['https://teushub.online']
  },
  clipper: {
    name: 'Clipper (Vortex)',
    aliases: ['vortex', 'clip', 'clips', 'fifa', 'ea fc', 'clip control', 'vortex clip'],
    brief:
      'Vortex Clip Control: clipping retroativo multi-stream (até 8 HLS) pra broadcast FIFA/EA FC. Buffer circular ffmpeg + frontend React; roda local :4310. Jarvis wired (clipper_criar/retry) mas OFF até túnel/CLIPPER_API_URL público.',
    people: ['Mateus'],
    stackHint: 'Node + Express + Socket.io + FFmpeg + React/Vite + SQLite',
    wiredNote: 'off até túnel — CLIPPER_API_URL + API_KEY',
    related: ['jarvis', 'cinerush_editor']
  },
  cutflix: {
    name: 'Cutflix',
    aliases: ['cut flix', 'templates video', 'pipeline instagram', 'automacao video'],
    brief:
      'Monorepo pnpm de automação de vídeo com IA: templates, upload/URL, worker FFmpeg+Groq (transcrição/visão), preview e publicação Instagram. Docker Compose (Postgres, Redis, MinIO). Jarvis hoje: cutflix_status (health). Concorrente/irmão da esteira CineRush Editor.',
    people: ['Mateus'],
    stackHint: 'pnpm monorepo + Express/React + Prisma + BullMQ + FFmpeg + Groq',
    wiredNote: 'CUTFLIX_API_URL — só health por enquanto',
    related: ['jarvis', 'socialhub', 'cinerush_editor', 'framerush']
  },
  framerush: {
    name: 'FrameRush',
    aliases: ['frame rush', 'compositor', '9:16', 'selo reels', 'compositor video'],
    brief:
      'App desktop Electron (Win/Mac): composição em lote 9:16 (1080×1920) — 1 foto/selo + N vídeos, exporta MP4 com ffmpeg. Usado na esteira de reels (logo sobre clip) junto com CineRush Editor. Instaladores NSIS/DMG. Unlinked no hub.',
    people: ['Mateus'],
    stackHint: 'Electron + ffmpeg-static',
    wiredNote: 'sem connector — app local',
    related: ['cinerush_editor', 'capcut_style_analyzer', 'attracione', 'socialhub']
  },
  viral_factory: {
    name: 'Viral Factory',
    aliases: ['viral factory', 'afiliados', 'factory viral', 'reels afiliado'],
    brief:
      'Next.js pra fluxo de afiliados: scrape página → filtrar reels virais → template estilo Canva → export/analytics demo (Meta/Shopee/TikTok Shop simulados). Protótipo/PoC — scraping e integrações ainda simulados, não produção.',
    people: ['Mateus'],
    stackHint: 'Next + React + Tailwind + Zustand',
    wiredNote: 'unlinked — PoC',
    related: ['socialhub', 'cutflix', 'euposto']
  },
  app_prime: {
    name: 'Calow AI (App Prime)',
    aliases: ['app prime', 'calow', 'calowai', 'treino', 'dieta', 'fitness', 'prime fit'],
    brief:
      'Produto comercial Next.js (calowai.com.br): planos de treino e dieta com IA (Gemini), quiz, pagamentos Asaas/Mercado Pago, admin e Meta Pixel. Separado do ecossistema Jarvis/CineRush — deploy VPS próprio (porta 3004). Pasta no disco: "app prime".',
    people: ['Mateus'],
    stackHint: 'Next + TS + Tailwind + Gemini + Asaas/MP',
    wiredNote: 'unlinked — produto próprio',
    related: [],
    urls: ['https://www.calowai.com.br']
  },
  projeto_milhao: {
    name: 'Projeto Milhão',
    aliases: [
      'projeto milhao',
      'milhão',
      'milhao',
      'instagram alerta',
      'monitor instagram',
      'meta 30 posts',
      'fechamento',
      'fechamento milhao'
    ],
    brief:
      'Cron Node que scrapeia reels IG de páginas (Mateus: filmelabs, ney.filmes, mister.cine; Erik: isinhafilmes, maniadefilmesbr), soma views e manda relatório no grupo WhatsApp "Projeto Milhão" via Evolution. Meta 30 posts/dia por pessoa. Fechamento oficial = turno 02h (dados de ontem). Jarvis: projeto_milhao_fechamento + snapshot. HTTP ops :4410 ou data/dia-*.json.',
    people: ['Mateus', 'Erik'],
    stackHint: 'Node + node-cron + Docker + Evolution WA',
    wiredNote: 'PROJETO_MILHAO_URL ou DATA_DIR',
    related: ['attracione', 'approtina', 'evolution', 'cinerush']
  },
  scraper_service: {
    name: 'Scraper Service',
    aliases: ['scraper service', 'view scraper', 'scraper api', 'scraper remoto', 'scraper cloud'],
    brief:
      'API Express containerizada pra scrape multi-plataforma (TikTok, IG, YouTube) por username+hashtags — alternativa HTTP ao scraper local do Attracione (pensado pra cloud + proxy). POST /scrape e /scrape/all. Ainda unlinked no Jarvis.',
    people: ['Mateus'],
    stackHint: 'Express + Playwright + Docker',
    wiredNote: 'unlinked — :4000 + x-api-key',
    related: ['attracione', 'attracione_2_0']
  },
  portfolio: {
    name: 'Portfolio Mateus',
    aliases: ['portfolio', 'portfólio', 'meu portfolio', 'site portfolio', 'vitrine'],
    brief:
      'Site portfolio React/Vite/Tailwind com showcase de edits (Ruyter, Attracione, Gabriel Laranjeira…). Assets em Cloudflare R2; deploy Vercel. Vitrine comercial, não produto SaaS.',
    people: ['Mateus'],
    stackHint: 'React + Vite + Tailwind + Framer Motion',
    wiredNote: 'unlinked — Vercel',
    related: ['attracione', 'capcut_style_analyzer']
  },
  discord_antinuke: {
    name: 'Bot Editflix (Discord)',
    aliases: [
      'antinuke',
      'discord bot',
      'among us',
      'editflix',
      'editflix bot',
      'among bot',
      'bot discord'
    ],
    brief:
      'Bot Discord do servidor Editflix (pasta discord-antinuke, nome legado): mute Among Us (/among + hotkey AutoHotkey), sons de entrada, log de voz. Anti-nuke removido. 24/7 no Railway. Comunidade do ecossistema de cortes/streaming.',
    people: ['Mateus'],
    stackHint: 'Node + discord.js',
    wiredNote: 'unlinked — Railway próprio',
    related: ['attracione', 'cinerush']
  },
  capcut_style_analyzer: {
    name: 'CapCut Style Analyzer',
    aliases: [
      'capcut',
      'estilo edicao',
      'perfil edicao',
      'analisador capcut',
      'capcut analyzer',
      'style profile'
    ],
    brief:
      'CLI Python offline: lê drafts do CapCut Desktop (Windows), extrai perfil de edição (ritmo, zoom, legendas, transições) → style-profile.json; builder monta projeto novo; modo --cuts com Whisper+Claude. Complementa esteira CineRush Editor / FrameRush. Sem deploy — local.',
    people: ['Mateus'],
    stackHint: 'Python + faster-whisper + FFmpeg + Anthropic',
    wiredNote: 'unlinked — CLI local',
    related: ['cinerush_editor', 'framerush', 'attracione', 'portfolio']
  },
  dashboard_visualizacoes: {
    name: 'Dashboard Ranking Attracione',
    aliases: [
      'dashboard views',
      'visualizacoes',
      'dashboard visualizações',
      'ranking attracione',
      'painel ranking',
      'premiacao'
    ],
    brief:
      'SPA estática (HTML/CSS/JS) do ranking público da competição Attracione a partir de ranking.json (+ premiacao-7e8.html). Deploy Vercel. Consumidor visual — dados vêm do backend/export Attracione.',
    people: ['Mateus'],
    stackHint: 'HTML/CSS/JS estático + Vercel',
    wiredNote: 'unlinked — estático',
    related: ['attracione', 'attracione_2_0']
  },
  euposto: {
    name: 'EuPosto',
    aliases: ['eu posto', 'euposto', 'crosspost', 'publicar tudo', 'multi post'],
    brief:
      'Página estática pra publicar um vídeo de uma vez no YouTube + Instagram + Facebook + TikTok (upload resumível YT, IG via Cloudinary). Utilitário/protótipo pessoal sem backend próprio — OAuth no client. Relacionado a SocialHub/Cutflix como ideia de crosspost.',
    people: ['Mateus'],
    stackHint: 'HTML/JS + YouTube API + Cloudinary',
    wiredNote: 'unlinked — estático',
    related: ['socialhub', 'cutflix', 'viral_factory']
  }
};

function getBrief(id) {
  if (!id) return null;
  return PROJECT_BRIEFS[id] || null;
}

function listBriefs() {
  return Object.entries(PROJECT_BRIEFS).map(([id, b]) => ({ id, ...b }));
}

/** Bloco longo pro system prompt — ciência completa do ecossistema */
function getBriefsPromptBlock() {
  const lines = Object.entries(PROJECT_BRIEFS).map(([id, b]) => {
    const al = (b.aliases || []).slice(0, 10).join(', ');
    const people = b.people?.length ? ` | gente: ${b.people.join(', ')}` : '';
    const rel = b.related?.length ? ` | liga: ${b.related.slice(0, 6).join(', ')}` : '';
    const url = b.urls?.length ? ` | url: ${b.urls[0]}` : '';
    return `- ${b.name} [${id}]${al ? ` — ${al}` : ''}${people}${rel}${url}\n  ${b.brief}${
      b.wiredNote ? ` [${b.wiredNote}]` : ''
    }${b.stackHint ? ` {${b.stackHint}}` : ''}`;
  });
  const map = [
    'Mapa rápido: Jarvis→Approtina(host/WA). CineRush TV=IPTV/Havok ≠ Cinerush Editor=cortes em massa.',
    'Attracione=comp views Mateus+Erik (scraper PC); satélites: Attracione 2.0, scraper-service, dashboard-visualizacoes, Projeto Milhão.',
    'Esteira reels: CineRush Editor ↔ FrameRush ↔ CapCut analyzer ↔ SocialHub/Cutflix/EuPosto.',
    'Calow AI (app prime)=fitness separado. Portfolio=vitrine. Editflix bot=Discord comunidade.'
  ].join(' ');
  return `Ecossistema completo (TODOS os projetos — use isto pra "voce conhece X"):\n${map}\n${lines.join('\n')}`;
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
  // match exato de alias / nome primeiro
  for (const [id, b] of Object.entries(PROJECT_BRIEFS)) {
    const nameN = b.name
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');
    if (nameN === q) return id;
    for (const a of b.aliases || []) {
      const an = a
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '');
      if (an === q) return id;
    }
  }
  // match parcial (alias >= 4 chars)
  for (const [id, b] of Object.entries(PROJECT_BRIEFS)) {
    for (const a of b.aliases || []) {
      const an = a
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '');
      if (an.length >= 4 && (q.includes(an) || an.includes(q))) return id;
    }
    const nameN = b.name
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');
    if (nameN.length >= 4 && (q.includes(nameN) || nameN.includes(q))) return id;
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
