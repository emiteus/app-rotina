const { all } = require('./db');
const { hojeStr } = require('./datas');

async function rankingDoDia(userIdAtual) {
  const hoje = hojeStr();
  const rows = await all(`
    SELECT u.id, u.nome, u.cor,
      COUNT(t.id)::int AS total,
      COALESCE(SUM(CASE WHEN t.concluida THEN 1 ELSE 0 END), 0)::int AS concluidas
    FROM usuarios u
    LEFT JOIN tasks t ON t.user_id = u.id AND t.data_reset::date = $1::date
    WHERE u.ativo = true
    GROUP BY u.id, u.nome, u.cor
    ORDER BY
      CASE WHEN COUNT(t.id) > 0
        THEN COALESCE(SUM(CASE WHEN t.concluida THEN 1 ELSE 0 END), 0)::float / COUNT(t.id)
        ELSE 0 END DESC,
      COALESCE(SUM(CASE WHEN t.concluida THEN 1 ELSE 0 END), 0) DESC,
      u.nome ASC
  `, [hoje]);

  const jogadores = rows.map((r) => {
    const total = Number(r.total) || 0;
    const concluidas = Number(r.concluidas) || 0;
    const pct = total > 0 ? Math.round((concluidas / total) * 100) : 0;
    return {
      id: r.id,
      nome: r.nome,
      cor: r.cor || '#f97316',
      concluidas,
      total,
      pct,
      eu: r.id === userIdAtual
    };
  });

  let lider = null;
  if (jogadores.length >= 2) {
    const top = jogadores[0];
    const second = jogadores[1];
    if (top.pct > second.pct) {
      lider = { id: top.id, nome: top.nome, diffPct: top.pct - second.pct };
    } else if (top.pct === second.pct && top.pct > 0) {
      lider = { id: null, nome: null, diffPct: 0, empate: true };
    }
  } else if (jogadores.length === 1 && jogadores[0].pct > 0) {
    lider = { id: jogadores[0].id, nome: jogadores[0].nome, diffPct: jogadores[0].pct };
  }

  return { data: hoje, jogadores, lider };
}

module.exports = { rankingDoDia };
