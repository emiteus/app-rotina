const { v4: uuid } = require('uuid');
const { run, get } = require('./db');

function hojeLocalStr() {
  const hoje = new Date();
  return `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}-${String(hoje.getDate()).padStart(2, '0')}`;
}

async function checkinHabito(titulo = 'Academia') {
  const nome = String(titulo || 'Academia').trim() || 'Academia';
  const hojeStr = hojeLocalStr();

  let task = await get(
    `SELECT * FROM tasks
     WHERE data_reset::date = $1::date
       AND titulo ILIKE $2
     ORDER BY concluida ASC, data_criacao DESC
     LIMIT 1`,
    [hojeStr, `%${nome}%`]
  );

  if (task) {
    if (task.concluida) return { ok: true, ja: true, criada: false, task };
    await run(`UPDATE tasks SET concluida = true WHERE id = $1`, [task.id]);
    task = await get(`SELECT * FROM tasks WHERE id = $1`, [task.id]);
    return { ok: true, ja: false, criada: false, task };
  }

  const id = uuid();
  const dataReset = new Date(hojeStr + 'T00:00:00Z').toISOString();
  await run(
    `INSERT INTO tasks (id, titulo, descricao, prioridade, categoria, data_reset, concluida)
     VALUES ($1, $2, '', 'media', 'saude', $3, true)`,
    [id, nome, dataReset]
  );
  task = await get(`SELECT * FROM tasks WHERE id = $1`, [id]);
  return { ok: true, ja: false, criada: true, task };
}

async function resumoHabito(titulo = 'Academia') {
  const nome = String(titulo || 'Academia').trim() || 'Academia';
  const hojeStr = hojeLocalStr();
  const mes = await get(
    `SELECT
       COUNT(*) FILTER (WHERE concluida)::int AS concluidas,
       COUNT(*)::int AS total
     FROM tasks
     WHERE data_reset IS NOT NULL
       AND DATE(data_reset) >= DATE_TRUNC('month', CURRENT_DATE)
       AND titulo ILIKE $1`,
    [`%${nome}%`]
  );
  const hoje = await get(
    `SELECT id, concluida FROM tasks
     WHERE data_reset::date = $1::date AND titulo ILIKE $2
     ORDER BY data_criacao DESC LIMIT 1`,
    [hojeStr, `%${nome}%`]
  );
  return {
    titulo: nome,
    mes: {
      concluidas: Number((mes && mes.concluidas) || 0),
      total: Number((mes && mes.total) || 0)
    },
    hoje: hoje
      ? { existe: true, concluida: !!hoje.concluida, id: hoje.id }
      : { existe: false, concluida: false }
  };
}

async function garantirRecorrenteAcademia() {
  const existe = await get(
    `SELECT id FROM tarefas_recorrentes WHERE titulo ILIKE 'academia' AND ativa = true LIMIT 1`
  );
  if (existe) return { criada: false };
  const id = uuid();
  await run(
    `INSERT INTO tarefas_recorrentes (id, titulo, descricao, prioridade, categoria, frequencia, dias_semana)
     VALUES ($1, 'Academia', '', 'media', 'saude', 'diario', '0,1,2,3,4,5,6')`,
    [id]
  );
  return { criada: true };
}

module.exports = { checkinHabito, resumoHabito, garantirRecorrenteAcademia };
