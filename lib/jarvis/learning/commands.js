/**
 * Comandos NL da Fase 1: ver/controlar o que o Jarvis aprendeu.
 * "lista lições" · "esquece a lição ab12" · "lista receitas" · "apaga a receita cd34"
 */
const lessons = require('./lessons');
const recipes = require('./recipes');

function parseLearningCommand(mensagem) {
  const t = String(mensagem || '').trim();
  let m;
  if (/^(lista(r)?\s+(as\s+)?li[cç][oõ]es|li[cç][oõ]es|o\s+que\s+(voc[eê]|vc)\s+aprendeu)\s*[?!.]*$/i.test(t)) {
    return { cmd: 'list_lessons' };
  }
  m = t.match(/^(esquece|esqueça|ignora|apaga)\s+(a\s+)?li[cç][aã]o\s+#?([a-f0-9]{4,16})\s*[!.]*$/i);
  if (m) return { cmd: 'forget_lesson', id: m[3] };
  if (/^(lista(r)?\s+(as\s+)?receitas|receitas)\s*[?!.]*$/i.test(t)) {
    return { cmd: 'list_recipes' };
  }
  m = t.match(/^(apaga|apague|remove|esquece)\s+(a\s+)?receita\s+#?([a-f0-9]{4,16})\s*[!.]*$/i);
  if (m) return { cmd: 'delete_recipe', id: m[3] };
  return null;
}

const shortId = (id) => String(id || '').slice(0, 6);

async function tryHandleLearningCommand(userId, mensagem) {
  const parsed = parseLearningCommand(mensagem);
  if (!parsed) return null;

  if (parsed.cmd === 'list_lessons') {
    const list = await lessons.listLessons(userId, { includeResolved: true, limit: 10 });
    if (!list.length) return { handled: true, resposta: 'Ainda não anotei nenhuma lição.' };
    const lines = list.map((l) => {
      const onde = l.project_id ? ` · ${l.project_id}` : '';
      const estado = l.resolved
        ? `resolvida${l.solucao ? ` (passou com ${l.solucao})` : ''}`
        : `aberta, ${l.count}x`;
      return `• \`${shortId(l.id)}\` **${l.tool}**${onde}: ${l.sintoma} — ${estado}`;
    });
    return {
      handled: true,
      resposta: `Lições:\n${lines.join('\n')}\n\nPra tirar uma do contexto: **esquece a lição <id>**.`
    };
  }

  if (parsed.cmd === 'forget_lesson') {
    const l = await lessons.ignoreLesson(userId, parsed.id);
    return {
      handled: true,
      resposta: l
        ? `Beleza, esqueci a lição \`${shortId(l.id)}\` (${l.tool}). Se o erro voltar, anoto de novo.`
        : `Não achei lição com id **${parsed.id}**.`
    };
  }

  if (parsed.cmd === 'list_recipes') {
    const list = await recipes.listRecipes(userId, 10);
    if (!list.length) {
      return {
        handled: true,
        resposta: 'Nenhuma receita ainda. Missão que termina sem erro vira receita sozinha.'
      };
    }
    const lines = list.map(
      (r) =>
        `• \`${shortId(r.id)}\` **${r.name}** — ${r.steps.map((s) => s.tipo).join(' → ')} (${r.uses}x)`
    );
    return {
      handled: true,
      resposta: `Receitas:\n${lines.join('\n')}\n\nPra remover: **apaga a receita <id>**.`
    };
  }

  if (parsed.cmd === 'delete_recipe') {
    const r = await recipes.deleteRecipe(userId, parsed.id);
    return {
      handled: true,
      resposta: r ? `Apaguei a receita **${r.name}**.` : `Não achei receita com id **${parsed.id}**.`
    };
  }
  return null;
}

module.exports = { parseLearningCommand, tryHandleLearningCommand };
