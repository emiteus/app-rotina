const {
  getProjectMemory,
  listProjectMemories,
  upsertProjectMemory,
  resolveMemoryProjectId,
  slimMemory,
  projectDisplayName
} = require('../../memory/projects');
const { getProjectKnowledge, listEcosystem } = require('../../projects/knowledge');

const TYPES = new Set([
  'project_memory_get',
  'project_memory_set',
  'project_memory_list',
  'project_info',
  'user_facts_list',
  'user_facts_forget',
  'approval_rules_list',
  'approval_rules_forget'
]);

async function handle(acao, ctx) {
  const tipo = acao && acao.tipo;
  if (!TYPES.has(tipo)) return null;
  const { userId } = ctx;

  // Aprovação permanente (permissions/standing.js): ver e desfazer "sempre sim/não"
  if (tipo === 'approval_rules_list') {
    const standing = require('../../permissions/standing');
    const regras = await standing.listarRegras(userId);
    return { tipo, ok: true, total: regras.length, texto: standing.textoDasRegras(regras) };
  }
  if (tipo === 'approval_rules_forget') {
    const trecho = String(acao.trecho || acao.acao || acao.texto || acao.query || '').trim().slice(0, 200);
    if (!trecho) return { tipo, ok: false, erro: 'sobre o que você quer que eu volte a perguntar?' };
    const desfeitas = await require('../../permissions/standing').esquecerRegras(userId, trecho);
    return {
      tipo,
      ok: true,
      desfeitas,
      texto: desfeitas.length
        ? `Feito: volto a perguntar antes de ${desfeitas.map((r) => `**${r.resumo}**`).join(', ')}.`
        : `Não achei regra sobre "${trecho}". Pergunta "o que você aprova sozinho?" pra ver a lista.`
    };
  }

  // Memória automática de fatos (memory/facts.js): o usuário vê e apaga o que o Jarvis aprendeu
  if (tipo === 'user_facts_list') {
    const fatos = await require('../../memory/facts').listarFatos(userId, { limite: 60 });
    return {
      tipo,
      ok: true,
      total: fatos.length,
      texto: fatos.length
        ? `O que eu aprendi sobre você (${fatos.length}):\n${fatos.map((f) => `• ${f.fato}`).join('\n')}`
        : 'Ainda não aprendi nada sobre você nas conversas.'
    };
  }
  if (tipo === 'user_facts_forget') {
    const trecho = String(acao.trecho || acao.fato || acao.texto || acao.query || '').trim().slice(0, 200);
    if (!trecho) return { tipo, ok: false, erro: 'o que você quer que eu esqueça?' };
    const esquecidos = await require('../../memory/facts').esquecerFatos(userId, trecho);
    return {
      tipo,
      ok: true,
      esquecidos,
      texto: esquecidos.length
        ? `Esqueci: ${esquecidos.map((f) => `"${f}"`).join(', ')}.`
        : `Não achei nada sobre "${trecho}" no que aprendi.`
    };
  }

  if (tipo === 'project_info') {
    const q = acao.project || acao.project_id || acao.id || acao.nome || acao.name || '';
    if (!q || String(q).toLowerCase() === 'all' || String(q) === '*') {
      const list = listEcosystem().map((p) => ({
        id: p.id,
        name: p.name || p.folder,
        wired: !!p.wired,
        summary: (p.brief || p.summary || '').slice(0, 280),
        people: p.people || [],
        related: (p.related || []).slice(0, 6),
        aliases: (p.aliases || []).slice(0, 8)
      }));
      return { tipo, ok: true, count: list.length, itens: list };
    }
    const k = getProjectKnowledge(q);
    if (!k) return { tipo, ok: false, erro: `Projeto "${q}" não achado no ecossistema` };
    return {
      tipo,
      ok: true,
      project_id: k.id,
      name: k.name || k.folder,
      wired: !!k.wired,
      brief: k.brief || k.summary,
      stack: k.stack || [],
      stackHint: k.stackHint || null,
      people: k.people || [],
      related: k.related || [],
      urls: k.urls || [],
      aliases: k.aliases || [],
      structure: (k.structure || []).slice(0, 12),
      note: k.wiredNote || k.note || null,
      folder: k.folder
    };
  }

  if (tipo === 'project_memory_list') {
    const list = await listProjectMemories(userId, acao.limit || 15);
    return {
      tipo,
      ok: true,
      itens: list.map(slimMemory)
    };
  }

  if (tipo === 'project_memory_get') {
    const id = resolveMemoryProjectId(acao.project_id || acao.project || acao.id || acao.nome);
    if (!id) return { tipo, ok: false, erro: 'project_id ou nome obrigatório' };
    const mem = await getProjectMemory(userId, id);
    return {
      tipo,
      ok: true,
      project_id: id,
      name: projectDisplayName(id),
      memory: slimMemory(mem)
    };
  }

  // project_memory_set
  const id = resolveMemoryProjectId(acao.project_id || acao.project || acao.id || acao.nome);
  if (!id) return { tipo, ok: false, erro: 'project_id ou nome obrigatório' };
  const patch = {
    project_id: id,
    stack: acao.stack,
    objetivo: acao.objetivo,
    status: acao.status,
    link: acao.link || acao.url,
    links: acao.links,
    decisao: acao.decisao || acao.decision,
    nota: acao.nota || acao.note || acao.fato,
    ultima_falha: acao.ultima_falha || acao.falha || acao.error,
    limpar_falha: !!acao.limpar_falha
  };
  // drop undefined
  for (const k of Object.keys(patch)) {
    if (patch[k] === undefined) delete patch[k];
  }
  const mem = await upsertProjectMemory(userId, patch);
  return {
    tipo,
    ok: true,
    project_id: id,
    name: projectDisplayName(id),
    memory: slimMemory(mem)
  };
}

module.exports = { TYPES, handle };
