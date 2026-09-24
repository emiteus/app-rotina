/**
 * Intent routing for context packing (Phase 4 + project registry Phase 6).
 */
const { resolveProjectsFromMessage } = require('../projects/registry');

const FINANCE = /\b(financ|dinheiro|saldo|gasto|gastei|paguei|paga|despesa|receita|recebi|extrato|banco|nubank|pix|categoria|recategoriz|meta|guardei|das|mei|fatura|conta\b|emprest|plano\s*financ|sobra|entrada|sa[ií]da|transac)/i;

const TASKS = /\b(tarefa|todo|pend[eê]ncia|conclu[ií]|faz(er)?\s+hoje|atrasad|agenda|evento|alarme|lembrete|recorrente)/i;

const HABITS = /\b(h[aá]bito|academia|treino|exerc[ií]cio|duolingo|consist[eê]ncia|streak)/i;

const STATUS = /\b(como\s+(est[aá]|ando|vai)|status|resumo|vis[aã]o\s*geral|o\s+que\s+tenho|me\s+atualiz|briefing|panorama|quais\s+m[oó]dulos|projetos\s+conect)/i;

/** Remove prefixos do ingress multimodal pra classificar o pedido real. */
function stripIngressNoise(mensagem) {
  return String(mensagem || '')
    .replace(/^\[Áudio transcrito\]:\s*/i, '')
    .replace(/^\[Imagem\]:\s*/i, '')
    .replace(/^\[Doc[^\]]*\]:\s*/i, '')
    .replace(/^\[Mídia\]:\s*/i, '')
    .replace(/^Pedido do usuário:\s*/i, '')
    .replace(/\n+_Responde curto[\s\S]*$/i, '')
    .trim();
}

// Palavras de cumprimento/chamada: áudio só com elas é saudação
const GREETING_WORDS = new Set(
  (
    'oi oii oiii ola ei hey opa fala alo salve jarvis e ai eai tranquilo beleza tudo bem td ta bom boa dia tarde noite ' +
    'chefe como vai voce vc esta suave firmeza meu rei certo joia blz'
  ).split(' ')
);

/**
 * Cumprimento curto (texto ou áudio). Ex.: "olá jarvis, tranquilo?"
 * NÃO casa pedido de ação (paguei, recebi, deploy…).
 */
function looksLikeGreeting(mensagem) {
  let t = stripIngressNoise(mensagem).replace(/\s+/g, ' ').trim();
  if (/^\*(Screenshot|Documento)\*/i.test(t) || /^RESUMO:/i.test(t)) return false;
  if (!t || t.length > 120) return false;

  const soft = t
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[""'']/g, '')
    .trim();

  // Ação explícita → nunca greeting
  if (
    /\b(confirm|paguei|pagar|recebi|recebido|criar?|delet|deploy|restart|diagnost|pesquis|sincroniz|reconcili|missao|provision|quanto|quantos|saldo|despesa|receita)\w*/i.test(
      soft
    )
  ) {
    return false;
  }

  // Chit-chat solto
  if (/^(kkk+|haha+|rs+|kkk)\s*[!.]*$/.test(soft)) return true;
  if (
    /^(tudo bem|td bem|tranquilo|ta tranquilo|beleza|suave|e ai|eai|firmeza)(\s+chefe)?\s*[?.!]*$/.test(
      soft
    )
  ) {
    return true;
  }

  // Começa com saudação (+ jarvis opcional + chit-chat)
  const m = soft.match(
    /^(oi+|ola|e ai|eai|fala|bom dia|boa tarde|boa noite|alo+|hey|hola|salve)(\s+jarvis)?\b(.*)$/
  );
  if (!m) {
    // Áudio curto com cara de cumprimento (STT impreciso): só se NÃO sobrar pedido.
    // "Jarvis, toca Kennedy no YouTube" tem "jarvis" mas é pedido — todo comando de voz começa assim.
    const raw = String(mensagem || '');
    if (/\[Áudio transcrito\]/i.test(raw) && soft.length <= 70) {
      const sobra = soft
        .replace(/[^a-z0-9\s]/g, ' ')
        .split(/\s+/)
        .filter((w) => w && !GREETING_WORDS.has(w));
      return sobra.length === 0;
    }
    return false;
  }

  const rest = String(m[3] || '')
    .replace(/^[\s,;:.\-!?]+/, '')
    .trim();

  if (!rest) return true;

  return /^(tudo bem|td bem|ta bem|tudo certo|td certo|tranquilo|ta tranquilo|beleza|e ai|eai|como (vai|andas|voce esta|vc esta)|suave|firmeza|chefe|meu rei)(\s+chefe)?\s*[?.!]*$/.test(
    rest
  );
}

/**
 * @param {string} mensagem
 */
function detectIntent(mensagem) {
  const msg = stripIngressNoise(mensagem);
  if (looksLikeGreeting(mensagem)) {
    return {
      kind: 'greeting',
      needs: { finance: false, tasks: false, habits: false, projects: false, full: false },
      projectHints: []
    };
  }
  // Falha de STT / anexo ilegível — não é pedido financeiro
  if (
    /não consegui transcrever|descrição automática indisponível|manda em \*\*texto\*\*|manda em texto/i.test(
      String(mensagem || '')
    )
  ) {
    return {
      kind: 'general',
      needs: { finance: false, tasks: false, habits: false, projects: false, full: false },
      projectHints: []
    };
  }

  const projectHints = resolveProjectsFromMessage(msg);
  const finance = FINANCE.test(msg);
  const tasks = TASKS.test(msg);
  const habits = HABITS.test(msg);
  const projects = projectHints.length > 0;
  const status = STATUS.test(msg);

  if (status) {
    return {
      kind: 'status',
      needs: { finance: true, tasks: true, habits: true, projects: true, full: true },
      projectHints
    };
  }

  const hits = [finance, tasks, habits, projects].filter(Boolean).length;
  if (hits === 0) {
    return {
      kind: 'general',
      needs: { finance: true, tasks: true, habits: true, projects: true, full: false },
      projectHints
    };
  }
  if (hits >= 2) {
    return {
      kind: 'mixed',
      needs: {
        finance: finance || status,
        tasks: tasks || status,
        habits: habits || status,
        projects: projects || status,
        full: false
      },
      projectHints
    };
  }
  if (finance) {
    return {
      kind: 'finance',
      needs: { finance: true, tasks: false, habits: false, projects: false, full: false },
      projectHints
    };
  }
  if (tasks) {
    return {
      kind: 'tasks',
      needs: { finance: false, tasks: true, habits: false, projects: false, full: false },
      projectHints
    };
  }
  if (habits) {
    return {
      kind: 'habits',
      needs: { finance: false, tasks: false, habits: true, projects: false, full: false },
      projectHints
    };
  }
  return {
    kind: 'projects',
    needs: { finance: false, tasks: false, habits: false, projects: true, full: false },
    projectHints
  };
}

/**
 * Pedido com verbo de ação ("toca", "abre", "liga"…). Usado pra não aceitar resposta sem ação
 * do modelo rápido: ele às vezes só conversa (ou repete o histórico) em vez de agir.
 */
function looksLikeCommand(mensagem) {
  const soft = stripIngressNoise(mensagem)
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase();
  return /\b(toca|tocar|toque|coloca|colocar|bota|abre|abrir|abra|liga|ligar|desliga|desligar|pausa|pausar|continua|aumenta|abaixa|baixa|diminui|fecha|fechar|volume|proxima|anterior|pula|lista|listar|procura|procurar|acha|achar|le|ler|verifica|verificar|mostra|mostrar|manda|mandar|cria|criar|anota|anotar|lembra|lembrar|marca|marcar|muda|mudar|troca|trocar|bloqueia|tira|print|conecta|conectar|post|posts|reel|reels|views|visualizacoes|dm|dms|direct|comentaram|comentarios|seguidores|inscritos|curtidas|mencoes|marcou|tela|errado|olha|olhar|explica|explicar|traduz|traduzir)\b/.test(
    soft
  );
}

module.exports = { detectIntent, looksLikeGreeting, looksLikeCommand, stripIngressNoise };
