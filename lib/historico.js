const { run, get, all } = require('./db');
const { hojeStr, addDias, ymdDe } = require('./datas');

async function agregarDia(dia, userId) {
  const data = ymdDe(dia) || hojeStr();
  const tot = await get(
    `SELECT COUNT(*)::int AS total,
            SUM(CASE WHEN concluida THEN 1 ELSE 0 END)::int AS concluidas
     FROM tasks
     WHERE user_id = $1 AND data_reset IS NOT NULL AND data_reset::date = $2::date`,
    [userId, data]
  );
  const cats = await all(
    `SELECT COALESCE(categoria,'geral') AS c, COUNT(*)::int AS n
     FROM tasks WHERE user_id = $1 AND data_reset IS NOT NULL AND data_reset::date = $2::date
     GROUP BY COALESCE(categoria,'geral')`,
    [userId, data]
  );
  const pris = await all(
    `SELECT COALESCE(prioridade,'media') AS p, COUNT(*)::int AS n
     FROM tasks WHERE user_id = $1 AND data_reset IS NOT NULL AND data_reset::date = $2::date
     GROUP BY COALESCE(prioridade,'media')`,
    [userId, data]
  );
  const por_categoria = {};
  cats.forEach((r) => { por_categoria[r.c] = r.n; });
  const por_prioridade = { alta: 0, media: 0, baixa: 0 };
  pris.forEach((r) => { por_prioridade[r.p] = r.n; });
  return {
    data,
    total: Number((tot && tot.total) || 0),
    concluidas: Number((tot && tot.concluidas) || 0),
    por_categoria,
    por_prioridade
  };
}

async function persistirHistoricoDia(dia, userId) {
  if (!userId) return { salvo: false };
  const agg = await agregarDia(dia, userId);
  if (agg.total === 0) {
    const existe = await get(
      `SELECT data FROM task_historico WHERE user_id = $1 AND data = $2::date`,
      [userId, agg.data]
    );
    if (!existe) return { ...agg, salvo: false };
  }
  await run(
    `INSERT INTO task_historico (user_id, data, total, concluidas, por_categoria, por_prioridade)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (user_id, data) DO UPDATE SET
       total = EXCLUDED.total,
       concluidas = EXCLUDED.concluidas,
       por_categoria = EXCLUDED.por_categoria,
       por_prioridade = EXCLUDED.por_prioridade`,
    [userId, agg.data, agg.total, agg.concluidas, JSON.stringify(agg.por_categoria), JSON.stringify(agg.por_prioridade)]
  ).catch(async () => {
    await run(
      `DELETE FROM task_historico WHERE user_id = $1 AND data = $2::date`,
      [userId, agg.data]
    );
    await run(
      `INSERT INTO task_historico (user_id, data, total, concluidas, por_categoria, por_prioridade)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [userId, agg.data, agg.total, agg.concluidas, JSON.stringify(agg.por_categoria), JSON.stringify(agg.por_prioridade)]
    );
  });
  return { ...agg, salvo: true };
}

async function backfillHistorico(dias = 90, userId) {
  if (!userId) return { dias: 0, salvos: 0 };
  const lim = Math.max(1, Math.min(Number(dias) || 90, 365));
  const datas = await all(
    `SELECT DISTINCT TO_CHAR(data_reset::date, 'YYYY-MM-DD') AS d
     FROM tasks WHERE user_id = $1 AND data_reset IS NOT NULL
       AND data_reset::date >= CURRENT_DATE - $2::int
     ORDER BY d ASC`,
    [userId, lim]
  );
  let salvos = 0;
  for (const row of datas) {
    const r = await persistirHistoricoDia(row.d, userId);
    if (r.salvo) salvos++;
  }
  await persistirHistoricoDia(addDias(-1), userId);
  await persistirHistoricoDia(hojeStr(), userId);
  return { dias: datas.length, salvos };
}

async function backfillHistoricoTodos(dias = 90) {
  const users = await all(`SELECT id FROM usuarios WHERE ativo = true`);
  let total = 0;
  for (const u of users) {
    const r = await backfillHistorico(dias, u.id);
    total += r.salvos;
  }
  return { usuarios: users.length, salvos: total };
}

module.exports = { agregarDia, persistirHistoricoDia, backfillHistorico, backfillHistoricoTodos };
