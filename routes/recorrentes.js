const express = require('express');
const { v4: uuid } = require('uuid');
const { run, get, all } = require('../lib/db');
const { requireUserId } = require('../lib/tenant');
const { gerarTarefaDoDia, gerarRecorrentesDoDia } = require('../lib/recorrentes');

let wsServer;
const router = express.Router();

// Só pro dono da recorrente (antes ia pra todos os conectados)
function emit(userId, tipo, dados) {
  if (wsServer) wsServer.broadcastToUser(userId, { tipo: 'recorrente-' + tipo, dados });
}

// Recorrente nova/editada que vale hoje já cria a tarefa de hoje (antes esperava o cron das 00:05).
// Falha aqui não derruba o cadastro: o cron do dia seguinte gera normalmente.
async function tarefaDeHoje(item, uid) {
  try {
    const task = await gerarTarefaDoDia(item);
    if (task && wsServer) wsServer.broadcastToUser(uid, { tipo: 'tarefa-criada', dados: task });
    return task;
  } catch (err) {
    console.error('[Recorrentes] tarefa de hoje:', err.message);
    return null;
  }
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
    emit(uid, 'criada', item);
    await tarefaDeHoje(item, uid);
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
    emit(uid, 'atualizada', item);
    // Reativou ou passou a valer hoje: cria a de hoje (se já criou hoje, a reserva do dia impede repetir)
    await tarefaDeHoje(item, uid);
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
    emit(uid, 'deletada', { id: req.params.id });
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
    const criadas = await gerarRecorrentesDoDia({ userId: uid });
    for (const task of criadas) if (wsServer) wsServer.broadcastToUser(uid, { tipo: 'tarefa-criada', dados: task });
    res.json({ msg: 'Geradas', criadas: criadas.length });
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

router.setWsServer = function(ws) { wsServer = ws; };
module.exports = router;
