#!/usr/bin/env node
/** Recria recorrentes perdidas e gera tarefa de hoje se faltar. */
require('dotenv').config({ quiet: true });
const { v4: uuid } = require('uuid');
const { initDB, pool, run, get } = require('../lib/db');
const { hojeStr, dataResetSql } = require('../lib/datas');

const NOVAS = [
  { titulo: 'Prancha ao acordar', prioridade: 'alta', categoria: 'saude', dias_semana: '0,1,2,3,4,5,6' },
  { titulo: 'Jogar o lixo', prioridade: 'media', categoria: 'pessoal', dias_semana: '0,1,2,3,4,5,6' },
];

async function main() {
  await initDB();
  const login = (process.argv[2] || 'teus').toLowerCase();
  const u = await pool.query(`SELECT id FROM usuarios WHERE lower(login) = $1`, [login]);
  const userId = u.rows[0]?.id;
  if (!userId) throw new Error('Usuário não encontrado');

  const hoje = hojeStr();

  for (const item of NOVAS) {
    let rec = await get(
      `SELECT * FROM tarefas_recorrentes WHERE user_id = $1 AND lower(trim(titulo)) = lower(trim($2))`,
      [userId, item.titulo]
    );

    if (!rec) {
      const id = uuid();
      await run(
        `INSERT INTO tarefas_recorrentes (id, titulo, descricao, prioridade, categoria, frequencia, dias_semana, ativa, user_id)
         VALUES ($1, $2, '', $3, $4, 'diario', $5, true, $6)`,
        [id, item.titulo, item.prioridade, item.categoria, item.dias_semana, userId]
      );
      rec = await get(`SELECT * FROM tarefas_recorrentes WHERE id = $1`, [id]);
      console.log('Recorrente criada:', item.titulo);
    } else if (!rec.ativa) {
      await run(`UPDATE tarefas_recorrentes SET ativa = true WHERE id = $1`, [rec.id]);
      console.log('Recorrente reativada:', item.titulo);
    } else {
      console.log('Recorrente já existe:', item.titulo);
    }

    const jaHoje = await get(
      `SELECT id FROM tasks WHERE user_id = $1 AND lower(trim(titulo)) = lower(trim($2))
         AND data_reset::date = CURRENT_DATE LIMIT 1`,
      [userId, item.titulo]
    );
    if (!jaHoje) {
      const taskId = uuid();
      await run(
        `INSERT INTO tasks (id, titulo, descricao, prioridade, categoria, data_reset, user_id)
         VALUES ($1, $2, '', $3, $4, $5, $6)`,
        [taskId, item.titulo, item.prioridade, item.categoria, dataResetSql(hoje), userId]
      );
      await run(`UPDATE tarefas_recorrentes SET ultima_criacao = $1 WHERE id = $2`, [hoje, rec.id]);
      console.log('Tarefa de hoje criada:', item.titulo);
    }
  }

  const lista = await pool.query(
    `SELECT titulo, ativa FROM tarefas_recorrentes WHERE user_id = $1 AND ativa = true ORDER BY titulo`,
    [userId]
  );
  console.log('\nRecorrentes ativas:', lista.rows.map((r) => r.titulo).join(', '));
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
