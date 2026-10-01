/**
 * Tarefa do dia a partir de uma recorrente — fonte única pro cron das 00:05, pro boot, pra rota
 * /gerar-hoje e pra criar/editar recorrente.
 * Antes só o cron gerava: recorrente criada (ou recuperada) depois das 00:05 só aparecia no dia seguinte
 * (01/10/2026). A lógica também estava copiada em server.js e routes/recorrentes.js, com regras diferentes.
 */
const { v4: uuid } = require('uuid');
const { pool, all } = require('./db');
const { hojeStr, diaSemana, dataResetSql } = require('./datas');

const TODOS_OS_DIAS = ['0', '1', '2', '3', '4', '5', '6'];

/** Dias da semana (0 = domingo) em que a recorrente vale. */
function diasDa(r) {
  if (r.dias_semana) return String(r.dias_semana).split(',').map((d) => d.trim());
  return r.frequencia === 'semanal' ? ['1'] : TODOS_OS_DIAS;
}

function valeNoDia(r, dow) {
  return !!r.ativa && !!r.user_id && diasDa(r).includes(String(dow));
}

/**
 * Cria a tarefa de hoje da recorrente, se for dia dela e ainda não tiver criado.
 * O dia fica reservado na própria recorrente (ultima_criacao) na mesma transação do INSERT:
 * se dois geradores chegarem juntos (cron e cadastro), o segundo não passa — não tem como duplicar.
 * @returns a tarefa criada, ou null
 */
async function gerarTarefaDoDia(r, { hoje = hojeStr(), dow = diaSemana() } = {}) {
  if (!valeNoDia(r, dow)) return null;
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const reserva = await c.query(
      `UPDATE tarefas_recorrentes SET ultima_criacao = $1::date
        WHERE id = $2 AND user_id = $3 AND ativa = true
          AND ultima_criacao IS DISTINCT FROM $1::date
        RETURNING titulo, descricao, prioridade, categoria`,
      [hoje, r.id, r.user_id]
    );
    if (!reserva.rowCount) {
      await c.query('ROLLBACK');
      return null;
    }
    const x = reserva.rows[0];
    const { rows } = await c.query(
      `INSERT INTO tasks (id, titulo, descricao, prioridade, categoria, data_reset, user_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [uuid(), x.titulo, x.descricao || '', x.prioridade, x.categoria, dataResetSql(hoje), r.user_id]
    );
    await c.query('COMMIT');
    return rows[0];
  } catch (err) {
    await c.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    c.release();
  }
}

/** Todas as recorrentes ativas (de um usuário, ou de todos) → tarefas de hoje. */
async function gerarRecorrentesDoDia({ userId = null, hoje, dow } = {}) {
  const recs = userId
    ? await all(`SELECT * FROM tarefas_recorrentes WHERE ativa = true AND user_id = $1`, [userId])
    : await all(`SELECT * FROM tarefas_recorrentes WHERE ativa = true AND user_id IS NOT NULL`);
  const criadas = [];
  for (const r of recs) {
    const t = await gerarTarefaDoDia(r, { hoje, dow });
    if (t) criadas.push(t);
  }
  return criadas;
}

module.exports = { gerarTarefaDoDia, gerarRecorrentesDoDia, diasDa, valeNoDia };
