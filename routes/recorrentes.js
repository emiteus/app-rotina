const express = require('express');
const { v4: uuid } = require('uuid');
const { run, get, all } = require('../lib/db');

let wsServer;
const router = express.Router();

function emit(tipo, dados) {
  if (wsServer) wsServer.broadcast({ tipo: 'recorrente-' + tipo, dados });
}

// GET todas recorrentes
router.get('/', async (req, res) => {
  try {
    const items = await all(`SELECT * FROM tarefas_recorrentes ORDER BY ativa DESC, criado_em DESC`);
    res.json(items);
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

// POST nova recorrente
router.post('/', async (req, res) => {
  const { titulo, descricao, prioridade, categoria, frequencia, dias_semana } = req.body;
  if (!titulo) return res.status(400).json({ erro: 'Titulo obrigatorio' });
  try {
    const id = uuid();
    await run(
      `INSERT INTO tarefas_recorrentes (id, titulo, descricao, prioridade, categoria, frequencia, dias_semana)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [id, titulo, descricao || '', prioridade || 'media', categoria || 'geral',
       frequencia || 'diario', dias_semana || '0,1,2,3,4,5,6']
    );
    const item = await get(`SELECT * FROM tarefas_recorrentes WHERE id = $1`, [id]);
    emit('criada', item);
    res.status(201).json(item);
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

// PATCH atualizar recorrente
router.patch('/:id', async (req, res) => {
  const { titulo, prioridade, categoria, frequencia, dias_semana, ativa } = req.body;
  try {
    if (titulo !== undefined) await run(`UPDATE tarefas_recorrentes SET titulo = $1 WHERE id = $2`, [titulo, req.params.id]);
    if (prioridade !== undefined) await run(`UPDATE tarefas_recorrentes SET prioridade = $1 WHERE id = $2`, [prioridade, req.params.id]);
    if (categoria !== undefined) await run(`UPDATE tarefas_recorrentes SET categoria = $1 WHERE id = $2`, [categoria, req.params.id]);
    if (frequencia !== undefined) await run(`UPDATE tarefas_recorrentes SET frequencia = $1 WHERE id = $2`, [frequencia, req.params.id]);
    if (dias_semana !== undefined) await run(`UPDATE tarefas_recorrentes SET dias_semana = $1 WHERE id = $2`, [dias_semana, req.params.id]);
    if (ativa !== undefined) await run(`UPDATE tarefas_recorrentes SET ativa = $1 WHERE id = $2`, [!!ativa, req.params.id]);
    const item = await get(`SELECT * FROM tarefas_recorrentes WHERE id = $1`, [req.params.id]);
    emit('atualizada', item);
    res.json(item);
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

// DELETE
router.delete('/:id', async (req, res) => {
  try {
    await run(`DELETE FROM tarefas_recorrentes WHERE id = $1`, [req.params.id]);
    emit('deletada', { id: req.params.id });
    res.json({ msg: 'Recorrente deletada' });
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

// POST gerar tarefas de hoje a partir das recorrentes
router.post('/gerar-hoje', async (req, res) => {
  try {
    const hoje = new Date();
    const diaSemana = hoje.getDay().toString();
    const hojeStr = hoje.toISOString().split('T')[0];
    const recorrentes = await all(`SELECT * FROM tarefas_recorrentes WHERE ativa = true`);

    let criadas = 0;
    for (const r of recorrentes) {
      // Verifica se deve criar hoje
      let deveCriar = false;
      if (r.frequencia === 'diario') {
        const dias = (r.dias_semana || '0,1,2,3,4,5,6').split(',');
        deveCriar = dias.includes(diaSemana);
      } else if (r.frequencia === 'semanal') {
        const dias = (r.dias_semana || '1').split(',');
        deveCriar = dias.includes(diaSemana);
      }

      // Já criou hoje?
      if (r.ultima_criacao) {
        const ultima = new Date(r.ultima_criacao).toISOString().split('T')[0];
        if (ultima === hojeStr) deveCriar = false;
      }

      if (deveCriar) {
        const taskId = uuid();
        await run(
          `INSERT INTO tasks (id, titulo, descricao, prioridade, categoria, data_reset)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [taskId, r.titulo, r.descricao || '', r.prioridade, r.categoria, `${hojeStr} 00:00:00`]
        );
        await run(`UPDATE tarefas_recorrentes SET ultima_criacao = $1 WHERE id = $2`, [hojeStr, r.id]);
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
