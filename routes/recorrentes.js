const express = require('express');
const { v4: uuid } = require('uuid');
const { run, get, all } = require('../lib/db');
const { hojeStr, diaSemana, ymdDe, dataResetSql } = require('../lib/datas');
const { requireUserId } = require('../lib/tenant');

let wsServer;
const router = express.Router();

function emit(tipo, dados) {
  if (wsServer) wsServer.broadcast({ tipo: 'recorrente-' + tipo, dados });
}

// GET todas recorrentes
router.get('/', async (req, res) => {
  const uid = requireUserId(req, res);
  if (!uid) return;
  try {
    const items = await all(
      `SELECT * FROM tarefas_recorrentes WHERE user_id = $1 ORDER BY ativa DESC, criado_em DESC`,
      [uid]
    );
    res.json(items);
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

// POST nova recorrente
router.post('/', async (req, res) => {
  const uid = requireUserId(req, res);
  if (!uid) return;
  const { titulo, descricao, prioridade, categoria, frequencia, dias_semana } = req.body;
  if (!titulo) return res.status(400).json({ erro: 'Titulo obrigatorio' });
  try {
    const id = uuid();
    await run(
      `INSERT INTO tarefas_recorrentes (id, titulo, descricao, prioridade, categoria, frequencia, dias_semana, user_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [id, titulo, descricao || '', prioridade || 'media', categoria || 'geral',
       frequencia || 'diario', dias_semana || '0,1,2,3,4,5,6', uid]
    );
    const item = await get(`SELECT * FROM tarefas_recorrentes WHERE id = $1 AND user_id = $2`, [id, uid]);
    emit('criada', item);
    res.status(201).json(item);
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

// PATCH atualizar recorrente
router.patch('/:id', async (req, res) => {
  const uid = requireUserId(req, res);
  if (!uid) return;
  const { titulo, prioridade, categoria, frequencia, dias_semana, ativa } = req.body;
  try {
    const existe = await get(`SELECT id FROM tarefas_recorrentes WHERE id = $1 AND user_id = $2`, [req.params.id, uid]);
    if (!existe) return res.status(404).json({ erro: 'Recorrente não encontrada' });

    if (titulo !== undefined) await run(`UPDATE tarefas_recorrentes SET titulo = $1 WHERE id = $2 AND user_id = $3`, [titulo, req.params.id, uid]);
    if (prioridade !== undefined) await run(`UPDATE tarefas_recorrentes SET prioridade = $1 WHERE id = $2 AND user_id = $3`, [prioridade, req.params.id, uid]);
    if (categoria !== undefined) await run(`UPDATE tarefas_recorrentes SET categoria = $1 WHERE id = $2 AND user_id = $3`, [categoria, req.params.id, uid]);
    if (frequencia !== undefined) await run(`UPDATE tarefas_recorrentes SET frequencia = $1 WHERE id = $2 AND user_id = $3`, [frequencia, req.params.id, uid]);
    if (dias_semana !== undefined) await run(`UPDATE tarefas_recorrentes SET dias_semana = $1 WHERE id = $2 AND user_id = $3`, [dias_semana, req.params.id, uid]);
    if (ativa !== undefined) await run(`UPDATE tarefas_recorrentes SET ativa = $1 WHERE id = $2 AND user_id = $3`, [!!ativa, req.params.id, uid]);
    const item = await get(`SELECT * FROM tarefas_recorrentes WHERE id = $1 AND user_id = $2`, [req.params.id, uid]);
    emit('atualizada', item);
    res.json(item);
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

// DELETE
router.delete('/:id', async (req, res) => {
  const uid = requireUserId(req, res);
  if (!uid) return;
  try {
    const r = await run(`DELETE FROM tarefas_recorrentes WHERE id = $1 AND user_id = $2`, [req.params.id, uid]);
    if (!r.rowCount) return res.status(404).json({ erro: 'Recorrente não encontrada' });
    emit('deletada', { id: req.params.id });
    res.json({ msg: 'Recorrente deletada' });
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

// POST gerar tarefas de hoje a partir das recorrentes
router.post('/gerar-hoje', async (req, res) => {
  const uid = requireUserId(req, res);
  if (!uid) return;
  try {
    const dow = String(diaSemana());
    const hoje = hojeStr();
    const recorrentes = await all(`SELECT * FROM tarefas_recorrentes WHERE ativa = true AND user_id = $1`, [uid]);

    let criadas = 0;
    for (const r of recorrentes) {
      // Verifica se deve criar hoje
      let deveCriar = false;
      if (r.frequencia === 'diario') {
        const dias = (r.dias_semana || '0,1,2,3,4,5,6').split(',');
        deveCriar = dias.includes(dow);
      } else if (r.frequencia === 'semanal') {
        const dias = (r.dias_semana || '1').split(',');
        deveCriar = dias.includes(dow);
      }

      // Já criou hoje?
      if (r.ultima_criacao) {
        if (ymdDe(r.ultima_criacao) === hoje) deveCriar = false;
      }

      if (deveCriar) {
        const taskId = uuid();
        await run(
          `INSERT INTO tasks (id, titulo, descricao, prioridade, categoria, data_reset, user_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [taskId, r.titulo, r.descricao || '', r.prioridade, r.categoria, dataResetSql(hoje), uid]
        );
        await run(`UPDATE tarefas_recorrentes SET ultima_criacao = $1 WHERE id = $2 AND user_id = $3`, [hoje, r.id, uid]);
        criadas++;
      }
    }
    res.json({ msg: 'Geradas', criadas });
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

router.setWsServer = function(ws) { wsServer = ws; };
module.exports = router;
