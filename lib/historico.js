const { run, get, all } = require('./db');
const { hojeStr, addDias, ymdDe } = require('./datas');

async function agregarDia(dia) {
  const data = ymdDe(dia) || hojeStr();
  const tot = await get(
    `SELECT
       COUNT(*)::int AS total,
       SUM(CASE WHEN concluida THEN 1 ELSE 0 END)::int AS concluidas
     FROM tasks
     WHERE data_reset IS NOT NULL AND data_reset::date = $1::date`,
    [data]
  );
  const cats = await all(
    `SELECT COALESCE(categoria,'geral') AS c, COUNT(*)::int AS n
     FROM tasks
     WHERE data_reset IS NOT NULL AND data_reset::date = $1::date
     GROUP BY COALESCE(categoria,'geral')`,
    [data]
  );
  const pris = await all(
    `SELECT COALESCE(prioridade,'media') AS p, COUNT(*)::int AS n
     FROM tasks
     WHERE data_reset IS NOT NULL AND data_reset::date = $1::date
     GROUP BY COALESCE(prioridade,'media')`,
    [data]
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

async function persistirHistoricoDia(dia) {
  const agg = await agregarDia(dia);
  if (agg.total === 0) {
    // Mantém linha existente atualizada pra 0 se já havia; senão não cria dia vazio
    const existe = await get(`SELECT data FROM task_historico WHERE data = $1::date`, [agg.data]);
    if (!existe) return { ...agg, salvo: false };
  }
  await run(
    `INSERT INTO task_historico (data, total, concluidas, por_categoria, por_prioridade)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (data) DO UPDATE SET
       total = EXCLUDED.total,
       concluidas = EXCLUDED.concluidas,
       por_categoria = EXCLUDED.por_categoria,
       por_prioridade = EXCLUDED.por_prioridade`,
    [
      agg.data,
      agg.total,
      agg.concluidas,
      JSON.stringify(agg.por_categoria),
      JSON.stringify(agg.por_prioridade)
    ]
  );
  return { ...agg, salvo: true };
}

async function backfillHistorico(dias = 90) {
  const lim = Math.max(1, Math.min(Number(dias) || 90, 365));
  const datas = await all(
    `SELECT DISTINCT TO_CHAR(data_reset::date, 'YYYY-MM-DD') AS d
     FROM tasks
     WHERE data_reset IS NOT NULL
       AND data_reset::date >= CURRENT_DATE - $1::int
     ORDER BY d ASC`,
    [lim]
  );
  let salvos = 0;
  for (const row of datas) {
    const r = await persistirHistoricoDia(row.d);
    if (r.salvo) salvos++;
  }
  // Garante ontem + hoje mesmo sem tasks (não cria vazios)
  await persistirHistoricoDia(addDias(-1));
  await persistirHistoricoDia(hojeStr());
  return { dias: datas.length, salvos };
}

module.exports = { agregarDia, persistirHistoricoDia, backfillHistorico };
