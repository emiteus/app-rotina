/**
 * Tools da agenda das redes pelo site (ops/agenda-redes.js): agendar lote, ver, cancelar e modelos de legenda.
 * A subida em si roda no PC (soc_schedule_upload no Jarvis Desktop); aqui só plano, fila e avisos.
 */
const { requireLib } = require('../../host');

const TYPES = new Set(['soc_agendar', 'soc_agenda_listar', 'soc_agenda_cancelar', 'soc_modelo_legenda']);

async function handle(acao, ctx) {
  const tipo = acao && acao.tipo;
  if (!TYPES.has(tipo)) return null;
  const { isPlanoOwnerUserId } = requireLib('plano-owner');
  if (!(await isPlanoOwnerUserId(ctx.userId))) return { tipo, ok: false, erro: 'agenda das redes só pro dono' };
  const ag = require('../../ops/agenda-redes');

  if (tipo === 'soc_agendar') {
    const r = await ag.agendarLote(ctx.userId, acao);
    return { tipo, ...r };
  }

  if (tipo === 'soc_agenda_listar') {
    const itens = await ag.listar(ctx.userId, { status: acao.status || null, limite: acao.limite });
    return { tipo, ok: true, itens, vazio: itens.length === 0 };
  }

  if (tipo === 'soc_agenda_cancelar') {
    const r = await ag.cancelar(ctx.userId, { lote: acao.lote || null, ids: acao.ids || acao.id || [], tudo: acao.tudo === true });
    return {
      tipo,
      ok: true,
      ...r,
      // O que já foi pra rede só sai por lá (o Jarvis não apaga post agendado)
      aviso: r.ja_na_rede ? `${r.ja_na_rede} já estão agendados na própria rede; esses você tira pelo TikTok Studio / Business Suite` : undefined
    };
  }

  // soc_modelo_legenda
  const op = String(acao.acao || acao.op || (acao.legenda ? 'salvar' : 'listar')).toLowerCase();
  if (op === 'listar') return { tipo, ok: true, modelos: await ag.listarModelos(ctx.userId) };
  if (op === 'apagar' || op === 'remover') {
    const ok = await ag.apagarModelo(ctx.userId, acao.nome);
    return ok ? { tipo, ok: true, apagado: acao.nome } : { tipo, ok: false, erro: `não tenho o modelo "${acao.nome}"` };
  }
  if (op === 'testar' || op === 'exemplo') {
    const m = await ag.acharModelo(ctx.userId, acao.nome);
    if (!m) return { tipo, ok: false, erro: `não tenho o modelo "${acao.nome}"` };
    return { tipo, ok: true, nome: m.nome, exemplo: ag.aplicarModelo(m, { nome: String(acao.arquivo || 'Nome Do Filme parte 2.mp4') }) };
  }
  try {
    const m = await ag.salvarModelo(ctx.userId, acao);
    return { tipo, ok: true, salvo: m.nome, exemplo: ag.aplicarModelo(m, { nome: 'Nome Do Filme parte 2.mp4' }) };
  } catch (e) {
    return { tipo, ok: false, erro: e.message };
  }
}

module.exports = { TYPES, handle };
