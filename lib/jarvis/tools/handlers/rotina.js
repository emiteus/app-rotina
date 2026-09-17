const { v4: uuid } = require('uuid');
const { run, get } = require('../../../db');
const { checkinHabito } = require('../../../habitos');
const { hojeStr, dataResetSql } = require('../../../datas');
const { persistirHistoricoDia } = require('../../../historico');

const TYPES = new Set([
  'criar_tarefa',
  'marcar_habito',
  'concluir_tarefa',
  'criar_evento',
  'criar_alarme'
]);

async function handle(acao, ctx) {
  const tipo = acao && acao.tipo;
  if (!TYPES.has(tipo)) return null;

  const { userId } = ctx;

  if (tipo === 'criar_tarefa') {
    const titulo = String(acao.titulo || '').trim();
    if (!titulo) {
      return { tipo, ok: false, erro: 'titulo obrigatório' };
    }
    const id = uuid();
    const dataReset = acao.data_reset && String(acao.data_reset).length >= 10
      ? dataResetSql(String(acao.data_reset).slice(0, 10))
      : dataResetSql(hojeStr());
    await run(
      `INSERT INTO tasks (id, titulo, descricao, prioridade, categoria, data_reset, hora, user_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [id, titulo, acao.descricao || '', acao.prioridade || 'media', acao.categoria || 'geral', dataReset, acao.hora || null, userId]
    );
    return { tipo, ok: true, titulo };
  }

  if (tipo === 'marcar_habito') {
    const titulo = String(acao.titulo || 'Academia').trim() || 'Academia';
    const r = await checkinHabito(titulo, userId);
    persistirHistoricoDia(hojeStr(), userId).catch(() => {});
    return {
      tipo,
      ok: true,
      titulo: r.titulo || (r.task && r.task.titulo) || titulo,
      ja: r.ja,
      criada: r.criada
    };
  }

  if (tipo === 'concluir_tarefa') {
    const titulo = String(acao.titulo || acao.nome || '').trim();
    const id = acao.id ? String(acao.id) : null;
    const dataAlvo = (acao.data_reset || acao.data || hojeStr()).slice(0, 10);
    let row = null;
    if (id) row = await get(`SELECT id, titulo, concluida FROM tasks WHERE id = $1 AND user_id = $2`, [id, userId]);
    if (!row && titulo) {
      row = await get(
        `SELECT id, titulo, concluida FROM tasks
         WHERE user_id = $1 AND data_reset::date = $2::date AND concluida = false
           AND (lower(titulo) = lower($3) OR titulo ILIKE $4)
         ORDER BY CASE WHEN lower(titulo) = lower($3) THEN 0 ELSE 1 END
         LIMIT 1`,
        [userId, dataAlvo, titulo, `%${titulo}%`]
      );
    }
    if (!row) {
      return { tipo, ok: false, erro: 'tarefa não encontrada' };
    }
    if (row.concluida) {
      return { tipo, ok: true, titulo: row.titulo, ja: true };
    }
    await run(
      `UPDATE tasks SET concluida = true, concluida_em = COALESCE(concluida_em, CURRENT_TIMESTAMP) WHERE id = $1 AND user_id = $2`,
      [row.id, userId]
    );
    persistirHistoricoDia(hojeStr(), userId).catch(() => {});
    return { tipo, ok: true, titulo: row.titulo, id: row.id };
  }

  if (tipo === 'criar_evento') {
    const titulo = String(acao.titulo || '').trim();
    const data = String(acao.data || '').slice(0, 10);
    if (!titulo || !/^\d{4}-\d{2}-\d{2}$/.test(data)) {
      return { tipo, ok: false, erro: 'titulo e data (YYYY-MM-DD) obrigatórios' };
    }
    const id = uuid();
    await run(
      `INSERT INTO eventos (id, titulo, descricao, data, hora, tipo, cor, user_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [id, titulo, acao.descricao || '', data, acao.hora || null, acao.tipo_evento || acao.tipo || 'evento', acao.cor || 'blue', userId]
    );
    return { tipo, ok: true, titulo, data, hora: acao.hora || null, id };
  }

  if (tipo === 'criar_alarme') {
    const hora = String(acao.hora || '').trim();
    const mensagem = String(acao.mensagem || acao.titulo || '').trim();
    if (!/^\d{2}:\d{2}$/.test(hora) || !mensagem) {
      return { tipo, ok: false, erro: 'hora (HH:MM) e mensagem obrigatórios' };
    }
    const id = uuid();
    await run(`INSERT INTO alarmes (id, hora, mensagem, user_id) VALUES ($1,$2,$3,$4)`, [id, hora, mensagem, userId]);
    return { tipo, ok: true, hora, mensagem, id };
  }

  return null;
}

module.exports = { TYPES, handle };
