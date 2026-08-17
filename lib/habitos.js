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
  },
  {
    titulo: 'Beber água',
    categoria: 'saude',
    prioridade: 'baixa',
    dias_semana: '0,1,2,3,4,5,6',
    aliases: ['beber agua', 'beber água', 'agua', 'água', 'hidratacao', 'hidratação']
  },
  {
    titulo: 'Sono',
    categoria: 'saude',
    prioridade: 'media',
    dias_semana: '0,1,2,3,4,5,6',
    aliases: ['sono', 'dormir', 'dormi', 'dormiu', 'dormi bem', 'noite']
  }
];

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
  // Fallback: token principal do título padrão (academia, agua, sono)
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
    await run(`UPDATE tasks SET concluida = true WHERE id = $1`, [task.id]);
    task = await get(`SELECT * FROM tasks WHERE id = $1`, [task.id]);
    return { ok: true, ja: false, criada: false, task, titulo: nome };
  }

  const id = uuid();
  await run(
    `INSERT INTO tasks (id, titulo, descricao, prioridade, categoria, data_reset, concluida)
     VALUES ($1, $2, '', $3, $4, $5, true)`,
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
  const hojeTask = await get(
    `SELECT id, concluida FROM tasks
     WHERE data_reset::date = $1::date AND (titulo = $2 OR titulo ILIKE $3)
     ORDER BY CASE WHEN titulo = $2 THEN 0 ELSE 1 END, data_criacao DESC LIMIT 1`,
    [hoje, nome, `%${nome}%`]
  );
  return {
    titulo: nome,
    mes: {
      concluidas: Number((mes && mes.concluidas) || 0),
      total: Number((mes && mes.total) || 0)
    },
    hoje: hojeTask
      ? { existe: true, concluida: !!hojeTask.concluida, id: hojeTask.id }
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

async function garantirRecorrentesHabitos() {
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
  return { criadas };
}

async function garantirRecorrenteAcademia() {
  return garantirRecorrentesHabitos();
}

module.exports = {
  HABITOS_PADRAO,
  resolverHabito,
  checkinHabito,
  resumoHabito,
  listarHabitos,
  garantirRecorrentesHabitos,
  garantirRecorrenteAcademia
};
