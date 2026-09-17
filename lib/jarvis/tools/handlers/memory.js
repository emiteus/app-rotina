const {
  getProjectMemory,
  listProjectMemories,
  upsertProjectMemory,
  resolveMemoryProjectId,
  slimMemory,
  projectDisplayName
} = require('../../memory/projects');

const TYPES = new Set([
  'project_memory_get',
  'project_memory_set',
  'project_memory_list'
]);

async function handle(acao, ctx) {
  const tipo = acao && acao.tipo;
  if (!TYPES.has(tipo)) return null;
  const { userId } = ctx;

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
