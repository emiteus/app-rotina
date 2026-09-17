/**
 * Intent routing for context packing (Phase 4).
 * Cheap heuristics — no LLM. Returns which snapshot slices the prompt needs.
 */

const FINANCE = /\b(financ|dinheiro|saldo|gasto|gastei|paguei|paga|despesa|receita|recebi|extrato|banco|nubank|pix|categoria|recategoriz|meta|guardei|das|mei|fatura|conta\b|emprest|plano\s*financ|sobra|entrada|sa[ií]da|transac)/i;

const TASKS = /\b(tarefa|todo|pend[eê]ncia|conclu[ií]|faz(er)?\s+hoje|atrasad|agenda|evento|alarme|lembrete|recorrente)/i;

const HABITS = /\b(h[aá]bito|academia|treino|exerc[ií]cio|duolingo|consist[eê]ncia|streak)/i;

const PROJECTS = /\b(cinerush|cine\s*rush|chatwoot|attracione|socialhub|social\s*hub|clipper|vortex|assinante|provision|havok|kirvano|comp\s*\d|ranking|coleta|post\s*agend)/i;

const STATUS = /\b(como\s+(est[aá]|ando|vai)|status|resumo|vis[aã]o\s*geral|o\s+que\s+tenho|me\s+atualiz|briefing|panorama)/i;

const GREETING = /^(oi|ol[áa]|e a[ií]|fala(\s+jarvis)?|bom dia|boa tarde|boa noite|al[oôô]|hey|hola|kkk+)\s*[!.?]*$/i;

/**
 * @param {string} mensagem
 * @returns {{
 *   kind: 'greeting'|'status'|'finance'|'tasks'|'habits'|'projects'|'mixed'|'general',
 *   needs: { finance: boolean, tasks: boolean, habits: boolean, projects: boolean, full: boolean },
 *   projectHints: string[]
 * }}
 */
function detectIntent(mensagem) {
  const msg = String(mensagem || '').trim();
  if (GREETING.test(msg)) {
    return {
      kind: 'greeting',
      needs: { finance: false, tasks: false, habits: false, projects: false, full: false },
      projectHints: []
    };
  }

  const finance = FINANCE.test(msg);
  const tasks = TASKS.test(msg);
  const habits = HABITS.test(msg);
  const projects = PROJECTS.test(msg);
  const status = STATUS.test(msg);

  const projectHints = [];
  if (/cinerush|cine\s*rush|chatwoot|havok|kirvano|assinante|provision/i.test(msg)) {
    projectHints.push('cinerush');
  }
  if (/attracione|ranking|coleta|comp\s*\d/i.test(msg)) projectHints.push('attracione');
  if (/socialhub|social\s*hub|post\s*agend/i.test(msg)) projectHints.push('socialhub');
  if (/clipper|vortex/i.test(msg)) projectHints.push('clipper');

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

module.exports = { detectIntent };
