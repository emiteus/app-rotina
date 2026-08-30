const { all } = require('./db');
const { hojeStr, addDias, ymdDe } = require('./datas');

function pctDe(total, concluidas) {
  const t = Number(total) || 0;
  const c = Number(concluidas) || 0;
  return t > 0 ? Math.round((c / t) * 100) : 0;
}

function ordenarJogadoresDia(jogadores) {
  return [...jogadores].sort((a, b) => {
    if (b.pct !== a.pct) return b.pct - a.pct;
    if (b.concluidas !== a.concluidas) return b.concluidas - a.concluidas;
    return String(a.nome).localeCompare(String(b.nome), 'pt-BR');
  });
}

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

/** Histórico de ofensiva: soma dos % diários (pontos) por jogador no período. */
async function rankingHistorico(userIdAtual, opts = {}) {
  const hoje = hojeStr();
  const dias = Math.max(1, Math.min(Number(opts.dias) || 30, 365));
  const de = ymdDe(opts.de) || addDias(-(dias - 1));
  const ate = ymdDe(opts.ate) || hoje;

  const rows = await all(`
    SELECT h.user_id, u.nome, u.cor,
      TO_CHAR(h.data, 'YYYY-MM-DD') AS data,
      h.total::int AS total,
      h.concluidas::int AS concluidas
    FROM task_historico h
    INNER JOIN usuarios u ON u.id = h.user_id AND u.ativo = true
    WHERE h.data >= $1::date AND h.data <= $2::date
    ORDER BY h.data ASC
  `, [de, ate]);

  const byDay = new Map();
  for (const r of rows) {
    const dia = String(r.data || '').slice(0, 10);
    if (!byDay.has(dia)) byDay.set(dia, new Map());
    byDay.get(dia).set(r.user_id, {
      userId: r.user_id,
      nome: r.nome,
      cor: r.cor || '#f97316',
      total: Number(r.total) || 0,
      concluidas: Number(r.concluidas) || 0
    });
  }

  // Hoje: dados ao vivo (podem ser mais recentes que task_historico)
  const liveHoje = await all(`
    SELECT u.id AS user_id, u.nome, u.cor,
      COUNT(t.id)::int AS total,
      COALESCE(SUM(CASE WHEN t.concluida THEN 1 ELSE 0 END), 0)::int AS concluidas
    FROM usuarios u
    LEFT JOIN tasks t ON t.user_id = u.id AND t.data_reset::date = $1::date
    WHERE u.ativo = true
    GROUP BY u.id, u.nome, u.cor
  `, [hoje]);

  if (hoje >= de && hoje <= ate) {
    const mapHoje = new Map(byDay.get(hoje) || []);
    for (const r of liveHoje) {
      mapHoje.set(r.user_id, {
        userId: r.user_id,
        nome: r.nome,
        cor: r.cor || '#f97316',
        total: Number(r.total) || 0,
        concluidas: Number(r.concluidas) || 0
      });
    }
    byDay.set(hoje, mapHoje);
  }

  const agg = new Map();
  const serie = [];

  const diasOrdenados = [...byDay.keys()].sort();
  for (const dia of diasOrdenados) {
    const map = byDay.get(dia);
    const jogadores = [...map.values()]
      .filter((j) => j.total > 0)
      .map((j) => ({
        ...j,
        pct: pctDe(j.total, j.concluidas)
      }));

    if (!jogadores.length) continue;

    const ranked = ordenarJogadoresDia(jogadores);
    const diaSerie = { data: dia, jogadores: [] };

    ranked.forEach((j, idx) => {
      if (!agg.has(j.userId)) {
        agg.set(j.userId, {
          id: j.userId,
          nome: j.nome,
          cor: j.cor,
          pontos: 0,
          vitorias: 0,
          dias: 0,
          concluidas: 0,
          eu: j.userId === userIdAtual
        });
      }
      const a = agg.get(j.userId);
      a.pontos += j.pct;
      a.dias += 1;
      a.concluidas += j.concluidas;
      if (idx === 0 && j.pct > 0) a.vitorias += 1;

      diaSerie.jogadores.push({
        id: j.userId,
        nome: j.nome,
        cor: j.cor,
        pct: j.pct,
        concluidas: j.concluidas,
        total: j.total,
        venceu: idx === 0 && j.pct > 0
      });
    });

    serie.push(diaSerie);
  }

  const jogadores = [...agg.values()]
    .map((j) => ({
      ...j,
      media_pct: j.dias > 0 ? Math.round(j.pontos / j.dias) : 0
    }))
    .sort((a, b) => {
      if (b.pontos !== a.pontos) return b.pontos - a.pontos;
      if (b.vitorias !== a.vitorias) return b.vitorias - a.vitorias;
      return String(a.nome).localeCompare(String(b.nome), 'pt-BR');
    });

  let lider = null;
  if (jogadores.length >= 2 && jogadores[0].pontos > jogadores[1].pontos) {
    lider = {
      id: jogadores[0].id,
      nome: jogadores[0].nome,
      diffPontos: jogadores[0].pontos - jogadores[1].pontos
    };
  } else if (jogadores.length === 1 && jogadores[0].pontos > 0) {
    lider = { id: jogadores[0].id, nome: jogadores[0].nome, diffPontos: jogadores[0].pontos };
  }

  return {
    periodo: { de, ate, dias: diasOrdenados.length },
    jogadores,
    lider,
    serie
  };
}

module.exports = { rankingDoDia, rankingHistorico };
