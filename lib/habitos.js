const { v4: uuid } = require('uuid');
const { run, get, all } = require('./db');
const { hojeStr, dataResetSql } = require('./datas');

const HABITOS_PADRAO = [
  {
    titulo: 'Academia',
    categoria: 'saude',
    prioridade: 'media',
    dias_semana: '1,2,3,4,5,6',
    aliases: ['academia', 'treino', 'gym', 'musculacao', 'musculação']
  }
];

const HABITOS_REMOVIDOS = ['Beber água', 'Beber agua', 'Sono'];

function normaliza(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function resolverHabito(titulo) {
  const raw = String(titulo || '').trim();
  const n = normaliza(raw);
  if (!n) return HABITOS_PADRAO[0];
  for (const h of HABITOS_PADRAO) {
    if (normaliza(h.titulo) === n) return h;
    if (h.aliases.some((a) => n === a || n.includes(a))) return h;
  }
  for (const h of HABITOS_PADRAO) {
    const partes = normaliza(h.titulo).split(' ').filter((p) => p.length >= 4);
    if (partes.some((p) => n.includes(p))) return h;
  }
  return {
    titulo: raw.slice(0, 60),
    categoria: 'saude',
    prioridade: 'media',
    dias_semana: '0,1,2,3,4,5,6',
    aliases: []
  };
}

async function checkinHabito(titulo = 'Academia') {
  const habito = resolverHabito(titulo);
  const nome = habito.titulo;
  const hoje = hojeStr();

  let task = await get(
    `SELECT * FROM tasks
     WHERE data_reset::date = $1::date
       AND (titulo = $2 OR titulo ILIKE $3)
     ORDER BY CASE WHEN titulo = $2 THEN 0 ELSE 1 END, concluida ASC, data_criacao DESC
     LIMIT 1`,
    [hoje, nome, `%${nome}%`]
  );

  if (task) {
    if (task.concluida) return { ok: true, ja: true, criada: false, task, titulo: nome };
    await run(
      `UPDATE tasks SET concluida = true, concluida_em = CURRENT_TIMESTAMP WHERE id = $1`,
      [task.id]
    );
    task = await get(`SELECT * FROM tasks WHERE id = $1`, [task.id]);
    return { ok: true, ja: false, criada: false, task, titulo: nome };
  }

  const id = uuid();
  await run(
    `INSERT INTO tasks (id, titulo, descricao, prioridade, categoria, data_reset, concluida, concluida_em)
     VALUES ($1, $2, '', $3, $4, $5, true, CURRENT_TIMESTAMP)`,
    [id, nome, habito.prioridade || 'media', habito.categoria || 'saude', dataResetSql(hoje)]
  );
  task = await get(`SELECT * FROM tasks WHERE id = $1`, [id]);
  return { ok: true, ja: false, criada: true, task, titulo: nome };
}

async function resumoHabito(titulo = 'Academia') {
  const habito = resolverHabito(titulo);
  const nome = habito.titulo;
  const hoje = hojeStr();
  const mes = await get(
    `SELECT
       COUNT(*) FILTER (WHERE concluida)::int AS concluidas,
       COUNT(*)::int AS total
     FROM tasks
     WHERE data_reset IS NOT NULL
       AND DATE(data_reset) >= DATE_TRUNC('month', CURRENT_DATE)
       AND (titulo = $1 OR titulo ILIKE $2)`,
    [nome, `%${nome}%`]
  );
  const semana = await get(
    `SELECT
       COUNT(*) FILTER (WHERE concluida)::int AS concluidas,
       COUNT(*)::int AS total
     FROM tasks
     WHERE data_reset IS NOT NULL
       AND DATE(data_reset) >= DATE_TRUNC('week', CURRENT_DATE)::date
       AND DATE(data_reset) <= CURRENT_DATE
       AND (titulo = $1 OR titulo ILIKE $2)`,
    [nome, `%${nome}%`]
  );
  const hojeTask = await get(
    `SELECT id, concluida, concluida_em FROM tasks
     WHERE data_reset::date = $1::date AND (titulo = $2 OR titulo ILIKE $3)
     ORDER BY CASE WHEN titulo = $2 THEN 0 ELSE 1 END, data_criacao DESC LIMIT 1`,
    [hoje, nome, `%${nome}%`]
  );
  return {
    titulo: nome,
    semana: {
      concluidas: Number((semana && semana.concluidas) || 0),
      total: Number((semana && semana.total) || 0)
    },
    mes: {
      concluidas: Number((mes && mes.concluidas) || 0),
      total: Number((mes && mes.total) || 0)
    },
    hoje: hojeTask
      ? {
          existe: true,
          concluida: !!hojeTask.concluida,
          id: hojeTask.id,
          concluida_em: hojeTask.concluida_em || null
        }
      : { existe: false, concluida: false }
  };
}

async function listarHabitos() {
  const lista = [];
  for (const h of HABITOS_PADRAO) {
    lista.push(await resumoHabito(h.titulo));
  }
  return { habitos: lista };
}

async function limparHabitosRemovidos() {
  let desativadas = 0;
  let apagadas = 0;
  for (const titulo of HABITOS_REMOVIDOS) {
    const r1 = await run(
      `UPDATE tarefas_recorrentes SET ativa = false WHERE titulo ILIKE $1 AND ativa = true`,
      [titulo]
    );
    desativadas += r1?.rowCount || 0;
    const r2 = await run(
      `DELETE FROM tasks
       WHERE (titulo ILIKE $1)
         AND (concluida = false OR data_reset::date >= CURRENT_DATE)`,
      [titulo]
    );
    apagadas += r2?.rowCount || 0;
  }
  return { desativadas, apagadas };
}

async function garantirRecorrentesHabitos() {
  const limpeza = await limparHabitosRemovidos().catch(() => ({ desativadas: 0, apagadas: 0 }));
  let criadas = 0;
  for (const h of HABITOS_PADRAO) {
    const existe = await get(
      `SELECT id FROM tarefas_recorrentes WHERE titulo ILIKE $1 AND ativa = true LIMIT 1`,
      [h.titulo]
    );
    if (existe) continue;
    const id = uuid();
    await run(
      `INSERT INTO tarefas_recorrentes (id, titulo, descricao, prioridade, categoria, frequencia, dias_semana)
       VALUES ($1, $2, '', $3, $4, 'diario', $5)`,
      [id, h.titulo, h.prioridade, h.categoria, h.dias_semana]
    );
    criadas++;
  }
  return { criadas, ...limpeza };
}

async function garantirRecorrenteAcademia() {
  return garantirRecorrentesHabitos();
}

/** Consistência de horário de conclusão (últimos N dias). */
async function analisarConsistencia(dias = 30) {
  const n = Math.min(Math.max(Number(dias) || 30, 7), 90);
  const porTitulo = await all(
    `SELECT
       titulo,
       COUNT(*)::int AS vezes,
       AVG(EXTRACT(HOUR FROM concluida_em) * 60 + EXTRACT(MINUTE FROM concluida_em)) AS media_min,
       STDDEV_POP(EXTRACT(HOUR FROM concluida_em) * 60 + EXTRACT(MINUTE FROM concluida_em)) AS desvio_min,
       MIN(concluida_em) AS primeira,
       MAX(concluida_em) AS ultima
     FROM tasks
     WHERE concluida = true
       AND concluida_em IS NOT NULL
       AND concluida_em >= CURRENT_DATE - ($1::int * INTERVAL '1 day')
     GROUP BY titulo
     HAVING COUNT(*) >= 2
     ORDER BY COUNT(*) DESC
     LIMIT 20`,
    [n]
  );

  const porHora = await all(
    `SELECT EXTRACT(HOUR FROM concluida_em)::int AS hora, COUNT(*)::int AS n
     FROM tasks
     WHERE concluida = true
       AND concluida_em IS NOT NULL
       AND concluida_em >= CURRENT_DATE - ($1::int * INTERVAL '1 day')
     GROUP BY EXTRACT(HOUR FROM concluida_em)
     ORDER BY hora`,
    [n]
  );

  const totalComHora = await get(
    `SELECT COUNT(*)::int AS n
     FROM tasks
     WHERE concluida = true
       AND concluida_em IS NOT NULL
       AND concluida_em >= CURRENT_DATE - ($1::int * INTERVAL '1 day')`,
    [n]
  );

  function fmtMin(m) {
    if (m == null || Number.isNaN(Number(m))) return null;
    const total = Math.round(Number(m));
    const h = Math.floor(total / 60) % 24;
    const min = total % 60;
    return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
  }

  function nivel(desvio) {
    if (desvio == null) return 'insuficiente';
    const d = Number(desvio);
    if (d <= 45) return 'alta';
    if (d <= 120) return 'media';
    return 'baixa';
  }

  const tarefas = (porTitulo || []).map((r) => ({
    titulo: r.titulo,
    vezes: Number(r.vezes) || 0,
    horario_medio: fmtMin(r.media_min),
    desvio_minutos: r.desvio_min != null ? Math.round(Number(r.desvio_min)) : null,
    consistencia: nivel(r.desvio_min)
  }));

  const comDados = tarefas.filter((t) => t.consistencia !== 'insuficiente');
  const resumo =
    comDados.length === 0
      ? 'Ainda sem horários de conclusão suficientes — começam a ser salvos a partir de agora.'
      : comDados.filter((t) => t.consistencia === 'alta').length >= Math.ceil(comDados.length / 2)
        ? 'Você costuma concluir as mesmas tarefas em horários parecidos.'
        : 'Horários de conclusão ainda variam bastante — dá pra fechar uma janela mais estável.';

  return {
    dias: n,
    total_com_horario: Number((totalComHora && totalComHora.n) || 0),
    resumo,
    por_tarefa: tarefas,
    por_hora: (porHora || []).map((r) => ({ hora: Number(r.hora), n: Number(r.n) || 0 }))
  };
}

module.exports = {
  HABITOS_PADRAO,
  HABITOS_REMOVIDOS,
  resolverHabito,
  checkinHabito,
  resumoHabito,
  listarHabitos,
  limparHabitosRemovidos,
  garantirRecorrentesHabitos,
  garantirRecorrenteAcademia,
  analisarConsistencia
};
