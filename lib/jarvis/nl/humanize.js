/**
 * Conversa de gente (pedido do Mateus em 24/09/2026): nada de nome de comando, campo técnico,
 * JSON ou erro cru na resposta — nem no WhatsApp, nem no app do PC.
 * Ex. ruim: "Não consegui **cinerush_editor_job_status**: job_id ou batch_id obrigatório"
 * Ex. bom:  "Não consegui ver o andamento do corte no Editor: qual corte você quer que eu veja? Me passa o número dele."
 */

// O que o comando FAZ, pra caber em "Não consegui ___"
const LABELS = {
  criar_despesa: 'registrar a despesa',
  criar_tarefa: 'criar a tarefa',
  criar_meta: 'criar a meta',
  marcar_habito: 'marcar o hábito',
  criar_categoria: 'criar a categoria',
  recategorizar: 'mudar a categoria',
  renomear_categoria: 'renomear a categoria',
  fundir_categorias: 'juntar as categorias',
  confirmar_despesa: 'confirmar o pagamento',
  confirmar_receita: 'confirmar o recebimento',
  criar_receita: 'registrar a receita',
  depositar_meta: 'guardar dinheiro na meta',
  concluir_tarefa: 'concluir a tarefa',
  criar_evento: 'criar o evento',
  criar_alarme: 'criar o alarme',
  criar_transacao: 'registrar a transação',
  deletar_transacao: 'apagar a transação',
  corrigir_data_tx: 'corrigir a data',
  marcar_das: 'marcar o DAS',
  reconciliar_despesas: 'conferir as despesas com o banco',
  sincronizar_bancos: 'atualizar os bancos',
  cinerush_buscar: 'achar o cliente do CineRush',
  cinerush_provisionar: 'liberar o acesso do cliente',
  cinerush_criar: 'criar o acesso no CineRush',
  cinerush_reenviar_email: 'reenviar o e-mail do cliente',
  chatwoot_listar: 'ver as conversas do suporte',
  chatwoot_resolver: 'resolver a conversa do suporte',
  chatwoot_atribuir: 'passar a conversa pra alguém',
  attracione_coleta: 'coletar os dados da Attracione',
  attracione_backup: 'fazer o backup da Attracione',
  attracione_ranking: 'ver o ranking da Attracione',
  socialhub_posts: 'ver os posts do SocialHub',
  socialhub_agendar: 'agendar o post',
  socialhub_publicar_agendados: 'publicar os posts agendados',
  clipper_criar: 'criar o corte no Clipper',
  clipper_retry: 'refazer o corte no Clipper',
  cinerush_editor_process: 'mandar o corte pro Editor',
  cinerush_editor_batch: 'mandar os cortes pro Editor',
  cinerush_editor_job_status: 'ver o andamento do corte no Editor',
  cinerush_editor_jobs: 'ver os trabalhos do Editor',
  cinerush_editor_agendados: 'ver os posts agendados do Editor',
  project_memory_get: 'lembrar do projeto',
  project_memory_set: 'anotar no projeto',
  project_memory_list: 'listar os projetos',
  project_info: 'ver a ficha do projeto',
  cutflix_status: 'ver como está o Cutflix',
  projeto_milhao_fechamento: 'fechar o Projeto Milhão',
  snapshot_refresh: 'atualizar os dados',
  ops_flag_list: 'ver as configurações do projeto',
  ops_flag_get: 'ver a configuração',
  ops_flag_set: 'mudar a configuração',
  dev_diagnose: 'diagnosticar o projeto',
  dev_git_status: 'ver as mudanças no código',
  dev_git_diff: 'ver as mudanças no código',
  dev_read_file: 'ler o arquivo do projeto',
  dev_propose_patch: 'preparar a correção',
  dev_apply_patch_local: 'aplicar a correção',
  dev_github_pr: 'abrir o pedido de mudança no GitHub',
  dev_run_tests: 'rodar os testes',
  dev_deploy_checklist: 'conferir o deploy',
  dev_railway_logs: 'ler os registros do servidor',
  dev_railway_redeploy: 'publicar de novo o servidor',
  dev_railway_restart: 'reiniciar o servidor',
  research_web_search: 'pesquisar na internet',
  research_fetch_url: 'abrir a página',
  research_write_report: 'montar o resumo da pesquisa',
  browser_open: 'abrir a página',
  browser_links: 'ver os links da página',
  browser_click: 'clicar na página',
  browser_type: 'digitar na página',
  browser_snapshot: 'ler a página',
  pc_status: 'ver como está o PC',
  pc_volume: 'mexer no volume do PC',
  pc_media: 'controlar a música no PC',
  pc_open_app: 'abrir o programa no PC',
  pc_close_app: 'fechar o programa no PC',
  pc_lock: 'bloquear o PC',
  pc_screenshot: 'tirar o print da tela',
  pc_screen_look: 'olhar a sua tela',
  pc_close_tab: 'fechar a aba',
  criar_recorrente: 'criar a tarefa que se repete',
  pc_spotify_play: 'tocar no Spotify',
  pc_spotify_now: 'ver o que está tocando',
  pc_youtube_play: 'tocar no YouTube',
  pc_open_url: 'abrir o site',
  pc_files_list: 'ver a pasta',
  pc_files_search: 'procurar o arquivo',
  pc_files_read: 'ler o arquivo',
  pc_open_path: 'abrir a pasta',
  tv_status: 'ver como está a TV',
  tv_power: 'ligar/desligar a TV',
  tv_volume: 'mexer no volume da TV',
  tv_media: 'controlar a TV',
  tv_key: 'apertar o botão da TV',
  tv_open_app: 'abrir o app na TV',
  tv_input: 'trocar a entrada da TV',
  tv_notify: 'mandar o aviso pra TV',
  tv_pair: 'conectar na TV',
  soc_status: 'ver as redes conectadas',
  soc_login: 'abrir a rede pra você entrar',
  soc_posts: 'ver os posts',
  soc_comments: 'ver os comentários',
  soc_inbox: 'ver as mensagens',
  soc_summary: 'montar o resumo das redes',
  creative_generate_image: 'gerar a imagem',
  creative_landing_copy: 'montar o texto da página'
};

// Campo que faltou → como perguntar
const FIELD_ASK = [
  [/job_id|batch_id|\bjob\b/i, 'qual corte você quer que eu veja? Me passa o número dele'],
  [/e-?mail/i, 'qual é o e-mail?'],
  [/\bvalor\b|amount/i, 'qual é o valor?'],
  [/\bid\b|identificador/i, 'de qual você está falando? Me passa o nome ou o número'],
  [/\bnome\b|\bname\b/i, 'qual é o nome?'],
  [/\bdata\b|\bdate\b/i, 'pra qual data?'],
  [/\bpasta\b|\barquivo\b|path/i, 'qual pasta ou arquivo?'],
  [/\bbusca\b|query/i, 'o que você quer que eu procure?'],
  [/\bprompt\b/i, 'como você quer a imagem?'],
  [/\bprojeto\b|project/i, 'de qual projeto?']
];

function label(tipo) {
  return LABELS[tipo] || 'fazer isso';
}

const ASK = '\u0000ask:'; // marca interna: o motivo é uma pergunta pra você

/** Erro técnico → motivo em português de gente (ou pergunta, se faltou informação). */
function humanReason(erro) {
  const e = String(erro || '').trim();
  if (!e) return '';
  // "Spotify: Insufficient client scope" — erro de serviço em inglês não é conversa
  const svc = e.match(/^([A-Z][\w ]{1,20}):\s*(.+)$/);
  if (svc && /\b(insufficient|invalid|error|failed|denied|forbidden|scope|request|unauthorized|not allowed|bad)\b/i.test(svc[2]) && !/[ãõçáéíóúâê]/i.test(svc[2])) {
    return `o ${svc[1]} recusou o pedido`;
  }
  if (/nenhum PC|Jarvis Desktop.*(online|agora)|PC não respondeu/i.test(e)) return 'seu PC está desligado ou o Jarvis Desktop está fechado agora';
  if (/obrigat[óo]ri|required|faltou|missing/i.test(e)) {
    for (const [re, ask] of FIELD_ASK) if (re.test(e)) return ASK + ask;
    return `${ASK}me diz de qual você está falando?`;
  }
  if (/timeout|timed out|ETIMEDOUT|demorou demais|tempo esgotado/i.test(e)) return 'o sistema demorou demais pra responder; tenta de novo daqui a pouco';
  if (/ECONNREFUSED|ENOTFOUND|EAI_AGAIN|fetch failed|socket hang up|\b50[0-4]\b|offline|indispon/i.test(e)) {
    return 'o serviço não está respondendo agora';
  }
  if (/\b40[13]\b|unauthori[sz]ed|forbidden|só pro dono|sem permiss/i.test(e)) return 'isso não está liberado pra mim';
  if (/\b404\b|not found|não encontrad|não achei/i.test(e) && !/[a-z]+_[a-z_]+/.test(e)) return e.replace(/^\w/, (c) => c.toLowerCase());
  if (/\b404\b|not found/i.test(e)) return 'não encontrei isso';
  if (/tipo não suportado|tool não|desconhecid/i.test(e)) return 'isso eu ainda não sei fazer';
  // Listas de opções do validador ("acao: up | down | set") não são conversa
  if (/\w+\s*\|\s*\w+/.test(e)) return 'não entendi exatamente o que fazer; pode falar de outro jeito?';
  const clean = stripTech(e);
  // Sobrou pouca coisa legível → motivo genérico
  return clean.length >= 8 ? clean.replace(/^\w/, (c) => c.toLowerCase()) : 'deu um problema do meu lado';
}

/** Remove o que é de máquina: nomes de comando, VARIAVEIS_DE_AMBIENTE, `código`, JSON, stack. */
function stripTech(text) {
  return String(text || '')
    .replace(/\s+at\s+\S+\s*\([^)]*\)/g, '') // stack trace
    .replace(/[{[][^{}[\]]{0,400}[}\]]/g, (m) => (/"\w+"\s*:/.test(m) ? '' : m)) // JSON
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\b[A-Z][A-Z0-9]+(?:_[A-Z0-9]+)+\b/g, '') // CINERUSH_EDITOR_URL
    .replace(/\b[a-z][a-z0-9]+(?:_[a-z0-9]+)+\b/g, (m) => (LABELS[m] ? label(m) : '')) // job_id, snake_case
    .replace(/\s*[—–-]\s*\/\s*/g, ' ')
    .replace(/\(\s*\)|\s+\/\s*$/g, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([,.;:!?])/g, '$1')
    .replace(/^[\s,;:—–-]+|[\s,;:—–-]+$/g, '')
    .trim();
}

/** Uma falha de ação em uma frase de gente. */
function humanFailure(f) {
  if (!f) return 'Não consegui fazer isso.';
  const what = label(f.tipo);
  if (f.uncertain) return `Não tive confirmação de que consegui ${what} (demorou demais). Pode ter dado certo: confere antes de pedir de novo.`;
  const why = humanReason(f.erro);
  if (!why) return `Não consegui ${what}.`;
  // Faltou informação: pergunta direta ("Pra ver o andamento do corte no Editor, qual corte…?")
  const end = (t) => (/[?.!]$/.test(t) ? t : `${t}.`);
  if (why.startsWith(ASK)) return end(`Pra ${what}, ${why.slice(ASK.length)}`);
  return end(`Não consegui ${what}: ${why}`);
}

/**
 * Filtro final de toda resposta que sai pra você: troca nome de comando por português
 * e tira sobras técnicas que o modelo às vezes escreve.
 */
function humanizeReply(text) {
  let s = String(text || '');
  if (!s) return s;
  // **cinerush_editor_job_status** / `pc_volume` / pc_volume → "ver o andamento do corte no Editor"
  s = s.replace(/(\*\*|`)?\b([a-z]+(?:_[a-z0-9]+)+)\b(\*\*|`)?/g, (m, a, name) => (LABELS[name] ? label(name) : m));
  // Blocos que vazaram do formato interno
  s = s.replace(/"acoes"\s*:\s*\[[\s\S]*?\]\s*,?/g, '');
  s = s.replace(/^\s*\{\s*"resposta"\s*:\s*"([\s\S]*?)"\s*\}\s*$/m, '$1');
  s = s.replace(/\n{3,}/g, '\n\n');
  return s.trim();
}

module.exports = { LABELS, label, humanReason, humanFailure, humanizeReply, stripTech };
