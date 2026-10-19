/**
 * Tools da agenda das redes pelo site (ops/agenda-redes.js): agendar lote, ver, cancelar e modelos de legenda.
 * A subida em si roda no PC (soc_schedule_upload no Jarvis Desktop); aqui só plano, fila e avisos.
 * Toda resposta leva `texto` pronto: a resposta final das tools soc_* usa só ele (routes/ia.js, narrarOks) —
 * sem isso o "o que tá agendado nas redes?" respondia só "Verificando a agenda" (19/10/2026).
 */
const { requireLib } = require('../../host');

const TYPES = new Set(['soc_agendar', 'soc_agenda_listar', 'soc_agenda_cancelar', 'soc_modelo_legenda']);

const STATUS = { fila: 'na fila', subindo: 'subindo agora', agendado: 'agendado na rede', falhou: 'falhou', cancelado: 'cancelado' };

function textoLista(itens) {
  if (!itens.length) return 'Não tem nada na agenda das redes agora.';
  const linhas = itens.map((i) => `• ${i.quando} · ${i.rede} · ${i.nome} — **${STATUS[i.status] || i.status}**${i.erro ? ` (${i.erro})` : ''}`);
  return `Agenda das redes:\n${linhas.join('\n')}`;
}

async function handle(acao, ctx) {
  const tipo = acao && acao.tipo;
  if (!TYPES.has(tipo)) return null;
  const { isPlanoOwnerUserId } = requireLib('plano-owner');
  if (!(await isPlanoOwnerUserId(ctx.userId))) return { tipo, ok: false, erro: 'agenda das redes só pro dono' };
  const ag = require('../../ops/agenda-redes');

  if (tipo === 'soc_agendar') {
    const r = await ag.agendarLote(ctx.userId, acao);
    if (!r.ok) return { tipo, ...r };
    const espera = r.esperando_prazo ? ` ${r.esperando_prazo} ficam na fila até entrar no prazo da rede e sobem sozinhos.` : '';
    return {
      tipo,
      ...r,
      texto: `Coloquei **${r.posts}** post(s) na agenda (de ${r.primeiro} a ${r.ultimo}). Vou subindo um por vez no PC e te aviso no fim.${espera}`
    };
  }

  if (tipo === 'soc_agenda_listar') {
    const itens = await ag.listar(ctx.userId, { status: acao.status || null, limite: acao.limite });
    return { tipo, ok: true, itens, vazio: itens.length === 0, texto: textoLista(itens) };
  }

  if (tipo === 'soc_agenda_cancelar') {
    const r = await ag.cancelar(ctx.userId, { lote: acao.lote || null, ids: acao.ids || acao.id || [], tudo: acao.tudo === true });
    // O que já foi pra rede só sai por lá (o Jarvis não apaga post agendado)
    const aviso = r.ja_na_rede ? `${r.ja_na_rede} já estão agendados na própria rede; esses você tira pelo TikTok Studio / Business Suite` : undefined;
    return {
      tipo,
      ok: true,
      ...r,
      aviso,
      texto: `${r.cancelados ? `Cancelei **${r.cancelados}** post(s) que ainda não tinham subido.` : 'Não tinha nada na fila pra cancelar.'}${aviso ? ` ${aviso}.` : ''}`
    };
  }

  // soc_modelo_legenda
  const op = String(acao.acao || acao.op || (acao.legenda ? 'salvar' : 'listar')).toLowerCase();
  if (op === 'listar') {
    const modelos = await ag.listarModelos(ctx.userId);
    const texto = modelos.length
      ? `Modelos de legenda:\n${modelos.map((m) => `• **${m.nome}**: ${String(m.legenda).replace(/\n/g, ' ⏎ ').slice(0, 120)}${m.hashtags ? ` (${m.hashtags})` : ''}`).join('\n')}`
      : 'Você ainda não tem modelo de legenda. Ex.: "cria o modelo filmes: 🎬 {titulo} {parte}, hashtags filmes cinema".';
    return { tipo, ok: true, modelos, texto };
  }
  if (op === 'apagar' || op === 'remover') {
    const ok = await ag.apagarModelo(ctx.userId, acao.nome);
    return ok ? { tipo, ok: true, apagado: acao.nome, texto: `Apaguei o modelo **${acao.nome}**.` } : { tipo, ok: false, erro: `não tenho o modelo "${acao.nome}"` };
  }
  if (op === 'testar' || op === 'exemplo') {
    const m = await ag.acharModelo(ctx.userId, acao.nome);
    if (!m) return { tipo, ok: false, erro: `não tenho o modelo "${acao.nome}"` };
    const exemplo = ag.aplicarModelo(m, { nome: String(acao.arquivo || 'Nome Do Filme parte 2.mp4') });
    return { tipo, ok: true, nome: m.nome, exemplo, texto: `Assim fica a legenda do modelo **${m.nome}**:\n${exemplo}` };
  }
  try {
    const m = await ag.salvarModelo(ctx.userId, acao);
    const exemplo = ag.aplicarModelo(m, { nome: 'Nome Do Filme parte 2.mp4' });
    return { tipo, ok: true, salvo: m.nome, exemplo, texto: `Salvei o modelo **${m.nome}**. Num vídeo "Nome Do Filme parte 2" fica assim:\n${exemplo}` };
  } catch (e) {
    return { tipo, ok: false, erro: e.message };
  }
}

module.exports = { TYPES, handle, textoLista };
