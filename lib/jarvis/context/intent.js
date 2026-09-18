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

/**
 * Cumprimento curto (texto ou áudio). Ex.: "olá jarvis, tranquilo?"
 * NÃO casa pedido de ação (paguei, recebi, deploy…).
 */
function looksLikeGreeting(mensagem) {
  let t = stripIngressNoise(mensagem).replace(/\s+/g, ' ').trim();
  // Se veio Vision/achados estruturados, não é greeting
  if (/^\*(Screenshot|Documento)\*/i.test(t) || /^RESUMO:/i.test(t)) return false;
  if (!t || t.length > 100) return false;

  // Ação explícita → nunca greeting
  if (
    /\b(confirm|pag(uei|ar)|receb[oi]|cria[r]?|delet|deploy|restart|diagnost|pesquis|sincroniz|reconcili|miss[aã]o|provision|quanto|quantos|saldo|despesa)\w*/i.test(
      t
    )
  ) {
    return false;
  }

  // oi / olá / e aí / fala jarvis / bom dia … (+ opcional jarvis + chit-chat)
  if (
    /^(oi|ol[áa]|e a[ií]|fala|bom dia|boa tarde|boa noite|al[oô]|hey|hola)(\s+jarvis)?\b/i.test(
      t
    )
  ) {
    return /^(oi|ol[áa]|e a[ií]|fala|bom dia|boa tarde|boa noite|al[oô]|hey|hola)(\s+jarvis)?([,!.\s]+(tudo\s+bem|tranquilo|beleza|e\s+a[ií]|como\s+(vai|andas)|suave|firmeza|td\s+bem)?)?\s*[!.?]*$/i.test(
      t
    );
  }

  if (/^(kkk+|haha+|rs+)\s*[!.]*$/i.test(t)) return true;
  if (/^(tudo\s+bem|tranquilo|beleza|suave|e\s+a[ií])\s*[?.!]*$/i.test(t)) return true;

  return false;
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

module.exports = { detectIntent, looksLikeGreeting, stripIngressNoise };
