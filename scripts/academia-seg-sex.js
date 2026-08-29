require('dotenv').config({ quiet: true });
const { pool } = require('../lib/db');

(async () => {
  const r = await pool.query(
    `UPDATE tarefas_recorrentes SET dias_semana = '1,2,3,4,5'
     WHERE titulo ILIKE 'Academia' RETURNING titulo, dias_semana`
  );
  console.log('Recorrente Academia:', r.rows);

  // Remove tarefa de sábado/domingo se existir hoje ou futuro indevido
  const del = await pool.query(
    `DELETE FROM tasks WHERE titulo ILIKE 'Academia'
       AND data_reset::date >= CURRENT_DATE
       AND EXTRACT(DOW FROM data_reset::date) IN (0, 6)
     RETURNING id`
  );
  if (del.rowCount) console.log('Removida academia fim de semana:', del.rowCount);

  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
