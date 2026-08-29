const { all, run } = require('./db');
const { persistirHistoricoDia } = require('./historico');

/** Remove tarefas de dias anteriores a ontem (já agregadas em task_historico). */
async function limparTarefasAntigas(userId, { manterDias = 1 } = {}) {
  if (!userId) return { apagadas: 0, historico: 0 };
  const lim = Math.max(0, Number(manterDias) || 1);

  const dias = await all(
    `SELECT DISTINCT TO_CHAR(data_reset::date, 'YYYY-MM-DD') AS d
     FROM tasks
     WHERE user_id = $1 AND data_reset IS NOT NULL
       AND data_reset::date < CURRENT_DATE - $2::int
     ORDER BY d ASC`,
    [userId, lim]
  );

  let historico = 0;
  for (const row of dias) {
    const r = await persistirHistoricoDia(row.d, userId);
    if (r.salvo) historico++;
  }

  const del = await run(
    `DELETE FROM tasks
     WHERE user_id = $1 AND data_reset IS NOT NULL
       AND data_reset::date < CURRENT_DATE - $2::int`,
    [userId, lim]
  );

  return { apagadas: del?.rowCount || 0, historico, dias: dias.length };
}

async function limparTarefasAntigasTodos(opts) {
  const users = await all(`SELECT id, login FROM usuarios WHERE ativo = true`);
  let apagadas = 0;
  let historico = 0;
  for (const u of users) {
    const r = await limparTarefasAntigas(u.id, opts);
    apagadas += r.apagadas;
    historico += r.historico;
    if (r.apagadas) console.log(`[limpar-tasks] ${u.login}: ${r.apagadas} apagada(s), ${r.historico} dia(s) no histórico`);
  }
  return { usuarios: users.length, apagadas, historico };
}

module.exports = { limparTarefasAntigas, limparTarefasAntigasTodos };
