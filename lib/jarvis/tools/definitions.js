/**
 * JARVIS Tool Registry — catalog (Phase 3).
 * Descriptions are the contract the LLM sees (via toolsPromptBlock).
 *
 * risk: low | medium | high | critical
 * ownerOnly: requires plano owner (projetos)
 * mutatesProjetos: invalidate snapshot cache after ok
 */

/** @typedef {'low'|'medium'|'high'|'critical'} RiskLevel */

/** @type {Record<string, {
 *   risk: RiskLevel,
 *   timeoutMs: number,
 *   ownerOnly?: boolean,
 *   mutatesProjetos?: boolean,
 *   description: string
 * }>} */
const TOOL_DEFS = {
  // —— Rotina / financeiro ——
  criar_despesa: {
    risk: 'medium',
    timeoutMs: 15000,
    description: 'Cria despesa recorrente/esperada'
  },
  criar_tarefa: {
    risk: 'low',
    timeoutMs: 10000,
    description: 'Cria tarefa do dia'
  },
  criar_meta: {
    risk: 'medium',
    timeoutMs: 10000,
    description: 'Cria meta financeira'
  },
  marcar_habito: {
    risk: 'low',
    timeoutMs: 10000,
    description: 'Check-in de hábito (ex.: Academia)'
  },
  criar_categoria: {
    risk: 'medium',
    timeoutMs: 10000,
    description: 'Cria categoria financeira'
  },
  recategorizar: {
    risk: 'high',
    timeoutMs: 25000,
    description: 'Recategoriza transações (pode afetar muitas linhas)'
  },
  renomear_categoria: {
    risk: 'medium',
    timeoutMs: 15000,
    description: 'Renomeia categoria'
  },
  fundir_categorias: {
    risk: 'high',
    timeoutMs: 25000,
    description: 'Fundir/unificar categorias'
  },
  confirmar_despesa: {
    risk: 'medium',
    timeoutMs: 15000,
    description: 'Confirma pagamento de despesa'
  },
  confirmar_receita: {
    risk: 'medium',
    timeoutMs: 15000,
    description: 'Confirma recebimento de receita'
  },
  criar_receita: {
    risk: 'medium',
    timeoutMs: 15000,
    description: 'Cria receita'
  },
  depositar_meta: {
    risk: 'medium',
    timeoutMs: 15000,
    description: 'Deposita valor em meta'
  },
  concluir_tarefa: {
    risk: 'low',
    timeoutMs: 10000,
    description: 'Marca tarefa como feita'
  },
  criar_evento: {
    risk: 'low',
    timeoutMs: 10000,
    description: 'Cria evento na agenda'
  },
  criar_alarme: {
    risk: 'low',
    timeoutMs: 10000,
    description: 'Cria alarme'
  },
  criar_transacao: {
    risk: 'medium',
    timeoutMs: 15000,
    description: 'Cria lançamento financeiro avulso'
  },
  deletar_transacao: {
    risk: 'high',
    timeoutMs: 15000,
    description: 'Apaga lançamento financeiro'
  },
  corrigir_data_tx: {
    risk: 'medium',
    timeoutMs: 15000,
    description: 'Corrige data de transação'
  },
  marcar_das: {
    risk: 'medium',
    timeoutMs: 10000,
    description: 'Marca DAS MEI do mês'
  },
  reconciliar_despesas: {
    risk: 'medium',
    timeoutMs: 45000,
    description: 'Reconcilia despesas com extrato'
  },
  sincronizar_bancos: {
    risk: 'medium',
    timeoutMs: 60000,
    description: 'Sincroniza Open Finance / Pluggy'
  },

  // —— CineRush / Chatwoot (owner) ——
  cinerush_buscar: {
    risk: 'low',
    timeoutMs: 20000,
    ownerOnly: true,
    description: 'Busca assinantes CineRush TV (IPTV). Args: search (email/nome), status opcional.'
  },
  cinerush_provisionar: {
    risk: 'high',
    timeoutMs: 100000,
    ownerOnly: true,
    mutatesProjetos: true,
    description:
      'Provisiona assinante CineRush TV JÁ pendente (Havok). NÃO cria cadastro novo — pra acesso manual use cinerush_criar.'
  },
  cinerush_criar: {
    risk: 'high',
    timeoutMs: 130000,
    ownerOnly: true,
    mutatesProjetos: true,
    description:
      'Cria acesso manual CineRush TV (Havok+DB). Obrigatório: email real. Opcional: nome, plano (mensal|trimestral|…). Nunca invente email.'
  },
  cinerush_reenviar_email: {
    risk: 'high',
    timeoutMs: 55000,
    ownerOnly: true,
    mutatesProjetos: true,
    description: 'Reenvia e-mail de acesso CineRush TV. Args: id ou search (email).'
  },
  chatwoot_listar: {
    risk: 'low',
    timeoutMs: 20000,
    ownerOnly: true,
    description: 'Lista conversas Chatwoot do suporte CineRush. Args: status open|pending.'
  },
  chatwoot_resolver: {
    risk: 'medium',
    timeoutMs: 20000,
    ownerOnly: true,
    mutatesProjetos: true,
    description: 'Resolve conversa Chatwoot. Args: id.'
  },
  chatwoot_atribuir: {
    risk: 'medium',
    timeoutMs: 20000,
    ownerOnly: true,
    mutatesProjetos: true,
    description: 'Atribui conversa Chatwoot ao time. Args: id.'
  },

  // —— Attracione (owner) ——
  attracione_coleta: {
    risk: 'high',
    timeoutMs: 130000,
    ownerOnly: true,
    mutatesProjetos: true,
    description:
      'Dispara scraper Attracione (views/vídeos). NÃO use pra responder "quantos postamos" — isso já está em projetos.attracione.hoje. Só se pedirem coletar/raspar/atualizar dados. Args: plataforma tiktok|kwai opcional.'
  },
  attracione_backup: {
    risk: 'high',
    timeoutMs: 90000,
    ownerOnly: true,
    mutatesProjetos: true,
    description: 'Dispara backup manual Attracione.'
  },
  attracione_ranking: {
    risk: 'low',
    timeoutMs: 20000,
    ownerOnly: true,
    description:
      'Ranking de competição passada Attracione. Args: n (ex. "7"). Ranking atual já vem em projetos.attracione.ranking — só chame pra comps antigas.'
  },

  // —— SocialHub (owner) ——
  socialhub_posts: {
    risk: 'low',
    timeoutMs: 20000,
    ownerOnly: true,
    description:
      'Lista posts TeuHub/SocialHub. Contagem de hoje → preferir projetos.socialhub.hoje no snapshot. Args: status SCHEDULED|PUBLISHED|FAILED.'
  },
  socialhub_agendar: {
    risk: 'high',
    timeoutMs: 30000,
    ownerOnly: true,
    mutatesProjetos: true,
    description:
      'Agenda post no TeuHub. Args: caption, socialAccountIds[], scheduledAt ISO.'
  },
  socialhub_publicar_agendados: {
    risk: 'high',
    timeoutMs: 60000,
    ownerOnly: true,
    mutatesProjetos: true,
    description: 'Publica agora os posts SCHEDULED no TeuHub (cron publish).'
  },

  // —— Clipper (owner) ——
  clipper_criar: {
    risk: 'high',
    timeoutMs: 45000,
    ownerOnly: true,
    mutatesProjetos: true,
    description:
      'Cria clip no Vortex Clipper (PC/túnel). Off sem CLIPPER_API_URL. Args: durationSeconds?, note?.'
  },
  clipper_retry: {
    risk: 'medium',
    timeoutMs: 45000,
    ownerOnly: true,
    mutatesProjetos: true,
    description: 'Retry de grupo de clip no Vortex. Args: id (groupId).'
  },

  // —— CineRush Editor (owner) ——
  cinerush_editor_process: {
    risk: 'high',
    timeoutMs: 55000,
    ownerOnly: true,
    mutatesProjetos: true,
    description:
      'Enfileira 1 corte no CineRush Editor (massa IG) — NÃO é CineRush TV. Args: url (YouTube), manual_headline?, clip_duration?.'
  },
  cinerush_editor_batch: {
    risk: 'high',
    timeoutMs: 70000,
    ownerOnly: true,
    mutatesProjetos: true,
    description: 'Batch de cortes no Editor. Args: items[{url, manual_headline?}].'
  },
  cinerush_editor_job_status: {
    risk: 'low',
    timeoutMs: 15000,
    ownerOnly: true,
    description:
      'Status de job/batch do Editor. Fila e posts IG de hoje também em projetos.cinerush_editor. Args: job_id ou batch_id.'
  },

  // —— Memória de projetos ——
  project_memory_get: {
    risk: 'low',
    timeoutMs: 8000,
    description: 'Lê memória persistente de um projeto (stack, status, decisões, ultima_falha).'
  },
  project_memory_set: {
    risk: 'low',
    timeoutMs: 8000,
    ownerOnly: true,
    description:
      'Grava memória de projeto. Args: project + stack|objetivo|status|nota|decisao|ultima_falha|link. Só owner.'
  },
  project_memory_list: {
    risk: 'low',
    timeoutMs: 8000,
    description: 'Lista projetos com memória salva.'
  },
  project_info: {
    risk: 'low',
    timeoutMs: 8000,
    description:
      'Ficha do ecossistema R:/Projetos (brief+stack+wired). Use quando perguntarem o que é X / se você conhece. Args: project id ou "all".'
  },

  // —— Cutflix ——
  cutflix_status: {
    risk: 'low',
    timeoutMs: 10000,
    ownerOnly: true,
    description:
      'Health da API Cutflix. Snapshot também em projetos.cutflix. Sem tools de write ainda.'
  },

  projeto_milhao_fechamento: {
    risk: 'low',
    timeoutMs: 12000,
    ownerOnly: true,
    description:
      'Fechamento Projeto Milhão (Mateus/Erik, meta 30). Default = ontem (turno 02h). Preferir projetos.projeto_milhao.fechamento no snapshot; tool se pedir outro ymd ou refresh. Args: ymd? YYYY-MM-DD.'
  },

  snapshot_refresh: {
    risk: 'low',
    timeoutMs: 5000,
    ownerOnly: true,
    mutatesProjetos: true,
    description:
      'Invalida cache de projetos/assist. Use após coleta Attracione ou se o usuário pedir dados frescos / "atualiza o cache". Só owner.'
  },

  // —— Ops flags (qualquer projeto; adapter live quando existir) ——
  ops_flag_list: {
    risk: 'low',
    timeoutMs: 15000,
    ownerOnly: true,
    description:
      'Lista flags de ops de um projeto (pause/automação). Args: project (cinerush|cutflix|….). Com adapter live (ex. cinerush) mostra estado real do backend; sem adapter = só store Jarvis.'
  },
  ops_flag_get: {
    risk: 'low',
    timeoutMs: 15000,
    ownerOnly: true,
    description:
      'Lê uma flag de ops. Args: project, key (support_automation|access_automation|support_email_autoreply|…).'
  },
  ops_flag_set: {
    risk: 'high',
    timeoutMs: 20000,
    ownerOnly: true,
    mutatesProjetos: true,
    description:
      'Liga/pausa automação de um projeto. Args: project, key, enabled (bool), note?. Só diga que pausou de verdade se o retorno tiver live:true/synced:true. Sem adapter = anota local, NÃO mata o backend.'
  },

  // —— Dev/Ops (owner, read-only) ——
  dev_diagnose: {
    risk: 'low',
    timeoutMs: 20000,
    ownerOnly: true,
    description:
      'Diagnóstico Dev: registry + snapshot + ultima_falha + versão Jarvis. Args: project (approtina|cinerush|projeto_milhao|socialhub|attracione|jarvis|…). Use em "tá quebrado / debug / status do serviço".'
  },
  dev_git_status: {
    risk: 'low',
    timeoutMs: 15000,
    ownerOnly: true,
    description:
      'Git status/commits recentes (local PROJETOS_ROOT ou GitHub). Args: project. Precisa GITHUB_TOKEN se repo privado no Railway.'
  },
  dev_git_diff: {
    risk: 'low',
    timeoutMs: 15000,
    ownerOnly: true,
    description:
      'Git diff local (PROJETOS_ROOT). Args: project, path? (arquivo). No Railway sem disco → use propose/PR.'
  },
  dev_read_file: {
    risk: 'low',
    timeoutMs: 15000,
    ownerOnly: true,
    description:
      'Lê arquivo allowlist do projeto (sem .. / sem .env). Args: project, path (ex. src/index.js ou package.json).'
  },
  dev_propose_patch: {
    risk: 'medium',
    timeoutMs: 30000,
    ownerOnly: true,
    description:
      'Propõe patch (preview, NÃO grava). Args: project + path/content OU files:[{path,content}] (≤5). Depois apply_local ou github_pr com SIM.'
  },
  dev_apply_patch_local: {
    risk: 'critical',
    timeoutMs: 30000,
    ownerOnly: true,
    description:
      'Grava patch no disco (HITL). Args: project + path/content OU files[]. Precisa PROJETOS_ROOT. Sem commit.'
  },
  dev_github_pr: {
    risk: 'critical',
    timeoutMs: 60000,
    ownerOnly: true,
    description:
      'Abre PR no GitHub (HITL) com 1–5 arquivos. Args: project + path/content OU files[], title?, base?. GITHUB_TOKEN (repo).'
  },
  dev_run_tests: {
    risk: 'high',
    timeoutMs: 120000,
    ownerOnly: true,
    description:
      'Roda script allowlist do package.json (test|smoke|check|lint|ci*). Args: project, script? (default test/smoke:host). Só com PROJETOS_ROOT.'
  },
  dev_deploy_checklist: {
    risk: 'low',
    timeoutMs: 5000,
    ownerOnly: true,
    description:
      'Checklist pós-código / pós-PR (NÃO executa deploy). Args: project?. Use após patch/PR ou “como faço deploy”.'
  },
  dev_railway_logs: {
    risk: 'low',
    timeoutMs: 25000,
    ownerOnly: true,
    description:
      'Últimas linhas de log / status do deploy Railway. Args: project ou service (app-rotina, projeto-milhao…). Precisa RAILWAY_TOKEN.'
  },
  dev_railway_redeploy: {
    risk: 'critical',
    timeoutMs: 30000,
    ownerOnly: true,
    description:
      'Redeploy Railway (rebuild/source — HITL obrigatório). Args: project (projeto_milhao|approtina|…). Precisa RAILWAY_TOKEN.'
  },
  dev_railway_restart: {
    risk: 'critical',
    timeoutMs: 25000,
    ownerOnly: true,
    description:
      'Restart Railway sem rebuild (HITL obrigatório). Args: project (projeto_milhao|approtina|…). Precisa RAILWAY_TOKEN.'
  },

  // —— Research (owner) ——
  research_web_search: {
    risk: 'low',
    timeoutMs: 45000,
    ownerOnly: true,
    description:
      'Busca web (Brave/Serper se KEY setada; senão DuckDuckGo). Args: query, limit? (≤10). Devolve title/url/snippet.'
  },
  research_fetch_url: {
    risk: 'low',
    timeoutMs: 20000,
    ownerOnly: true,
    description:
      'Baixa URL allowlist (SSRF-safe), devolve texto limpo. Args: url, max_chars?. Allowlist em RESEARCH_FETCH_ALLOWLIST ou RESEARCH_FETCH_OPEN=1.'
  },
  research_write_report: {
    risk: 'medium',
    timeoutMs: 10000,
    ownerOnly: true,
    description:
      'Relatório curto pro WA (5 bullets). Sempre rode depois de research_web_search. Args: title, detailed?/com_fontes? só se pedirem fontes.'
  },

  // —— Browser (owner, SSRF-safe) ——
  browser_open: {
    risk: 'low',
    timeoutMs: 45000,
    ownerOnly: true,
    description:
      'Abre URL. Default = HTTP fetch. Args: url, headless?:true (Playwright — precisa JARVIS_BROWSER_HEADLESS=1), max_chars?. Allowlist RESEARCH_FETCH_*.'
  },
  browser_links: {
    risk: 'low',
    timeoutMs: 25000,
    ownerOnly: true,
    description:
      'Lista links de uma página. Args: url, limit? (≤50). Mesma allowlist SSRF do research.'
  },
  browser_click: {
    risk: 'medium',
    timeoutMs: 30000,
    ownerOnly: true,
    description:
      'Clique headless na sessão aberta. Args: selector? ou text?. Antes: browser_open com headless:true.'
  },
  browser_type: {
    risk: 'medium',
    timeoutMs: 30000,
    ownerOnly: true,
    description:
      'Digita em input headless. Args: selector, text. Antes: browser_open headless:true.'
  },
  browser_snapshot: {
    risk: 'low',
    timeoutMs: 20000,
    ownerOnly: true,
    description:
      'Snapshot texto da página headless atual (após open/click/type). Args: max_chars?.'
  },

  // —— PC do usuário (Fase 2.6 — Jarvis Desktop executa; o PC só aceita estas) ——
  pc_status: {
    risk: 'low',
    timeoutMs: 20000,
    ownerOnly: true,
    description: 'Status do PC com o Jarvis Desktop (memória, uptime, bateria, volume). Sem args.'
  },
  pc_volume: {
    risk: 'low',
    timeoutMs: 20000,
    ownerOnly: true,
    description:
      'Volume do PC. Args: acao = up | down | mute | unmute | set; passos? (up/down, 1–25, padrão 5); nivel? (set, 0–100).'
  },
  pc_media: {
    risk: 'low',
    timeoutMs: 20000,
    ownerOnly: true,
    description: 'Controle de mídia do PC (Spotify, YouTube…). Args: acao = play_pause | next | previous | stop.'
  },
  pc_open_app: {
    risk: 'low',
    timeoutMs: 20000,
    ownerOnly: true,
    description:
      'Abre app da lista liberada no PC. Args: app = spotify | chrome | vscode | explorer | notepad | calculadora | whatsapp | discord | obs | terminal.'
  },
  pc_close_app: {
    risk: 'high',
    timeoutMs: 20000,
    ownerOnly: true,
    description: 'Fecha app da lista liberada no PC (pede SIM). Args: app (mesma lista do pc_open_app).'
  },
  pc_lock: {
    risk: 'medium',
    timeoutMs: 20000,
    ownerOnly: true,
    description: 'Bloqueia a tela do PC. Sem args.'
  },
  pc_screenshot: {
    risk: 'medium',
    timeoutMs: 25000,
    ownerOnly: true,
    description: 'Print da tela do PC, mostrado na conversa. Só quando o usuário pedir. Sem args.'
  },
  pc_screen_look: {
    risk: 'medium',
    timeoutMs: 60000,
    ownerOnly: true,
    description:
      'Olha a tela do PC e responde sobre ela ("o que tá errado aqui?", "que erro é esse?", "lê isso pra mim", "o que é isso na tela?"). Args: pergunta (o que ele quer saber). Não mostra o print.'
  },
  pc_spotify_play: {
    risk: 'low',
    timeoutMs: 35000,
    ownerOnly: true,
    description:
      'Toca no Spotify do usuário (Premium). Args: busca (artista, música, álbum ou playlist, ex. "Matuê", "Kenny G Matuê"); tipo_busca? = artista | musica | album | playlist.'
  },
  pc_spotify_now: {
    risk: 'low',
    timeoutMs: 20000,
    ownerOnly: true,
    description: 'O que está tocando no Spotify agora. Sem args.'
  },
  pc_youtube_play: {
    risk: 'low',
    timeoutMs: 30000,
    ownerOnly: true,
    description: 'Abre e toca no navegador do PC o 1º vídeo do YouTube pra busca. Args: busca.'
  },
  pc_open_url: {
    risk: 'low',
    timeoutMs: 20000,
    ownerOnly: true,
    description:
      'Abre site no navegador do PC. Args: site (youtube, gmail, drive, netflix, instagram, github, chatgpt…) OU url (https://…).'
  },
  pc_files_list: {
    risk: 'low',
    timeoutMs: 20000,
    ownerOnly: true,
    description:
      'Lista uma pasta do PC (só leitura). Args: pasta (downloads, documentos, desktop, imagens, videos, projetos, "projetos/Jarvis" ou caminho); pergunta? (o que o usuário quer saber sobre ela).'
  },
  pc_files_search: {
    risk: 'low',
    timeoutMs: 30000,
    ownerOnly: true,
    description:
      'Procura arquivos/pastas por nome no PC (só leitura). Args: nome (trecho ou *.pdf); pasta? (padrão: todas as liberadas); pergunta?.'
  },
  pc_files_read: {
    risk: 'low',
    timeoutMs: 30000,
    ownerOnly: true,
    description:
      'Lê arquivo de texto do PC (só leitura; PDF/Office ainda não). Args: arquivo (ex. "projetos/Jarvis/README.md"); pergunta? (o que responder sobre ele).'
  },
  pc_open_path: {
    risk: 'medium',
    timeoutMs: 20000,
    ownerOnly: true,
    description: 'Abre pasta no Explorer ou arquivo no app padrão do PC (nunca programa/script). Args: caminho.'
  },

  // —— TV LG da casa (Fase 3 — o Jarvis Desktop fala com a TV na rede local) ——
  tv_status: {
    risk: 'low',
    timeoutMs: 20000,
    ownerOnly: true,
    description: 'Status da TV (ligada?, app aberto, volume). Sem args.'
  },
  tv_power: {
    risk: 'medium',
    timeoutMs: 40000,
    ownerOnly: true,
    description: 'Liga ou desliga a TV. Args: acao = on | off.'
  },
  tv_volume: {
    risk: 'low',
    timeoutMs: 20000,
    ownerOnly: true,
    description:
      'Volume da TV. Args: acao = up | down | mute | unmute | set; passos? (up/down, 1–20, padrão 3); nivel? (set, 0–100).'
  },
  tv_media: {
    risk: 'low',
    timeoutMs: 20000,
    ownerOnly: true,
    description: 'Mídia na TV. Args: acao = play | pause | stop | rewind | fast_forward.'
  },
  tv_key: {
    risk: 'low',
    timeoutMs: 20000,
    ownerOnly: true,
    description:
      'Aperta botão do controle da TV. Args: tecla = HOME | BACK | EXIT | UP | DOWN | LEFT | RIGHT | ENTER | INFO | MENU | CHANNELUP | CHANNELDOWN | RED | GREEN | YELLOW | BLUE.'
  },
  tv_open_app: {
    risk: 'low',
    timeoutMs: 25000,
    ownerOnly: true,
    description:
      'Abre app instalado na TV. Args: app (ex.: netflix, youtube, prime, disney, globoplay, max, spotify, navegador, tv).'
  },
  tv_input: {
    risk: 'low',
    timeoutMs: 20000,
    ownerOnly: true,
    description: 'Troca a entrada da TV. Args: entrada = hdmi1 | hdmi2 | hdmi3 | hdmi4.'
  },
  tv_notify: {
    risk: 'low',
    timeoutMs: 20000,
    ownerOnly: true,
    description: 'Mostra um aviso curto na tela da TV. Args: texto (até 200 caracteres).'
  },
  tv_pair: {
    risk: 'low',
    timeoutMs: 90000,
    ownerOnly: true,
    description:
      'Conecta o PC na TV LG (a TV precisa estar ligada; aparece "Permitir" na tela pra aceitar no controle). Sem args.'
  },

  // —— Redes sociais (Fase 4, SÓ LEITURA — Navegador do Jarvis no PC + API do YouTube) ——
  soc_status: {
    risk: 'low',
    timeoutMs: 25000,
    ownerOnly: true,
    description: 'Quais redes estão conectadas no PC (instagram, tiktok, youtube, x). Sem args.'
  },
  soc_login: {
    risk: 'low',
    timeoutMs: 25000,
    ownerOnly: true,
    description: 'Abre no PC a janela pra ENTRAR numa rede (o usuário digita a senha lá, nunca o Jarvis). Args: rede = instagram | tiktok | x.'
  },
  soc_posts: {
    risk: 'low',
    timeoutMs: 135000,
    ownerOnly: true,
    description:
      'Posts recentes com métricas (views, curtidas, comentários). Args: rede = instagram | tiktok | youtube | x; quantidade? (1–20, padrão 6); pergunta? (o que ele quer saber, ex. "qual foi melhor?").'
  },
  soc_comments: {
    risk: 'low',
    timeoutMs: 135000,
    ownerOnly: true,
    description:
      'Comentários de um post (Instagram ou YouTube). Args: rede; post? (1 = mais recente, ou link); pergunta?.'
  },
  soc_inbox: {
    risk: 'low',
    timeoutMs: 135000,
    ownerOnly: true,
    description: 'DMs do Instagram (não lidas primeiro) ou menções do X. Args: rede = instagram | x; pergunta?.'
  },
  soc_summary: {
    risk: 'low',
    timeoutMs: 285000,
    ownerOnly: true,
    description: 'Resumo de todas as redes conectadas (posts recentes + DMs/menções). Args: pergunta?.'
  },

  // —— Creative (owner) ——
  creative_generate_image: {
    risk: 'medium',
    timeoutMs: 90000,
    ownerOnly: true,
    description:
      'Gera imagem com Gemini (Nano Banana). Args: prompt (obrigatório), aspect? (1:1|16:9|9:16). Use quando pedirem gera/cria/desenha imagem, banner, arte.'
  },
  creative_landing_copy: {
    risk: 'medium',
    timeoutMs: 45000,
    ownerOnly: true,
    description:
      'Outline de landing (hero + seções + CTAs) a partir do brief do projeto. Args: project (obrigatório), topic?, hints?. Salva em memória do projeto.'
  }
};

const RISK_ORDER = { low: 0, medium: 1, high: 2, critical: 3 };

function needsApproval(risk, threshold = 'high') {
  return RISK_ORDER[risk] >= RISK_ORDER[threshold];
}

module.exports = {
  TOOL_DEFS,
  RISK_ORDER,
  needsApproval,
  MAX_TOOLS_PER_TURN: 8,
  DEFAULT_TIMEOUT_MS: 30000
};
