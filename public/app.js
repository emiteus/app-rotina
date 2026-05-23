// WebSocket para atualizações em tempo real
let ws = null;
let wsReconnectAttempts = 0;
const wsMaxReconnectAttempts = 5;
const wsReconnectDelay = 3000; // 3 segundos

function conectarWebSocket() {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${window.location.host}`;

  ws = new WebSocket(wsUrl);

  ws.addEventListener('open', () => {
    console.log('[WS] Conectado ao servidor');
    wsReconnectAttempts = 0;

    // Autentica no WebSocket
    const sessionId = Math.random().toString(36).substring(7);
    ws.send(JSON.stringify({ tipo: 'auth', sessionId }));
  });

  ws.addEventListener('message', (event) => {
    try {
      const msg = JSON.parse(event.data);
      handleWebSocketMessage(msg);
    } catch (err) {
      console.error('[WS] Erro ao processar mensagem:', err);
    }
  });

  ws.addEventListener('close', () => {
    console.log('[WS] Desconectado do servidor');
    if (wsReconnectAttempts < wsMaxReconnectAttempts) {
      wsReconnectAttempts++;
      console.log(`[WS] Reconectando em ${wsReconnectDelay / 1000}s... (tentativa ${wsReconnectAttempts}/${wsMaxReconnectAttempts})`);
      setTimeout(conectarWebSocket, wsReconnectDelay);
    }
  });

  ws.addEventListener('error', (err) => {
    console.error('[WS] Erro:', err);
  });
}

function handleWebSocketMessage(msg) {
  const { tipo, dados } = msg;

  switch (tipo) {
    case 'tarefa-criada':
    case 'tarefa-atualizada':
    case 'tarefa-deletada':
      console.log('[WS] Tarefa atualizada:', dados);
      carregarTarefas();
      break;

    case 'financeiro-adicionada':
    case 'financeiro-deletada':
      console.log('[WS] Transação atualizada:', dados);
      carregarTransacoes();
      break;

    case 'alarme-criado':
    case 'alarme-atualizado':
    case 'alarme-deletado':
      console.log('[WS] Alarme atualizado:', dados);
      carregarAlarmes();
      break;

    default:
      console.log('[WS] Mensagem desconhecida:', tipo);
  }
}

// Exibe data de hoje
function atualizarData() {
  const hoje = new Date();
  const opcoes = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
  document.getElementById('data-hoje').textContent = hoje.toLocaleDateString('pt-BR', opcoes);
}

// Carrega tarefas
async function carregarTarefas() {
  try {
    const res = await fetch('/api/tasks');
    const tasks = await res.json();

    const lista = document.getElementById('lista-tarefas');
    lista.innerHTML = '';

    tasks.forEach(task => {
      const li = document.createElement('li');
      li.className = `task-item ${task.concluida ? 'completed' : ''}`;
      li.innerHTML = `
        <input type="checkbox" ${task.concluida ? 'checked' : ''}
               onchange="marcarTarefa('${task.id}', this.checked)">
        <span class="task-text">${task.titulo}</span>
        <button class="btn-delete" onclick="deletarTarefa('${task.id}')">✕</button>
      `;
      lista.appendChild(li);
    });

    // Atualiza stats
    const total = tasks.length;
    const concluidas = tasks.filter(t => t.concluida).length;
    document.getElementById('total').textContent = total;
    document.getElementById('concluidas').textContent = concluidas;
  } catch (err) {
    console.error('Erro ao carregar tarefas:', err);
  }
}

// Adiciona tarefa
async function adicionarTarefa() {
  const input = document.getElementById('nova-tarefa');
  const titulo = input.value.trim();

  if (!titulo) return;

  try {
    await fetch('/api/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ titulo })
    });
    input.value = '';
    carregarTarefas();
  } catch (err) {
    console.error('Erro ao adicionar tarefa:', err);
  }
}

// Marca tarefa como concluída
async function marcarTarefa(id, concluida) {
  try {
    await fetch(`/api/tasks/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ concluida })
    });
    carregarTarefas();
  } catch (err) {
    console.error('Erro ao marcar tarefa:', err);
  }
}

// Deleta tarefa
async function deletarTarefa(id) {
  if (!confirm('Deletar tarefa?')) return;
  try {
    await fetch(`/api/tasks/${id}`, { method: 'DELETE' });
    carregarTarefas();
  } catch (err) {
    console.error('Erro ao deletar tarefa:', err);
  }
}

// Carrega transações
async function carregarTransacoes() {
  try {
    const res = await fetch('/api/financeiro');
    const data = await res.json();

    // Atualiza saldo
    document.getElementById('saldo-total').textContent = `R$ ${data.saldo.toFixed(2)}`;

    // Carrega transações
    const lista = document.getElementById('lista-transacoes');
    lista.innerHTML = '';

    data.transacoes.forEach(t => {
      const li = document.createElement('li');
      const classe = t.tipo === 'saida' ? 'saida' : '';
      const simbolo = t.tipo === 'entrada' ? '+' : '-';
      li.className = `transaction-item ${classe}`;
      li.innerHTML = `
        <div class="transaction-info">
          <div>${t.descricao || '(sem descrição)'}</div>
          <div class="transaction-tipo">${new Date(t.data).toLocaleDateString('pt-BR')}</div>
        </div>
        <span class="transaction-valor">${simbolo} R$ ${t.valor.toFixed(2)}</span>
        <button class="btn-delete" onclick="deletarTransacao('${t.id}')">✕</button>
      `;
      lista.appendChild(li);
    });
  } catch (err) {
    console.error('Erro ao carregar transações:', err);
  }
}

// Adiciona transação
async function adicionarTransacao() {
  const tipo = document.getElementById('tipo-transacao').value;
  const valor = parseFloat(document.getElementById('valor-transacao').value);
  const descricao = document.getElementById('desc-transacao').value.trim();

  if (!valor || valor <= 0) return;

  try {
    await fetch('/api/financeiro', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tipo, valor, descricao })
    });
    document.getElementById('valor-transacao').value = '';
    document.getElementById('desc-transacao').value = '';
    carregarTransacoes();
  } catch (err) {
    console.error('Erro ao adicionar transação:', err);
  }
}

// Deleta transação
async function deletarTransacao(id) {
  if (!confirm('Deletar transação?')) return;
  try {
    await fetch(`/api/financeiro/${id}`, { method: 'DELETE' });
    carregarTransacoes();
  } catch (err) {
    console.error('Erro ao deletar transação:', err);
  }
}

// Carrega alarmes
async function carregarAlarmes() {
  try {
    const res = await fetch('/api/alarmes');
    const alarmes = await res.json();

    const lista = document.getElementById('lista-alarmes');
    lista.innerHTML = '';

    alarmes.forEach(a => {
      const li = document.createElement('li');
      li.className = 'alarm-item';
      li.innerHTML = `
        <div class="alarm-info">
          <div class="alarm-hora">${a.hora}</div>
          <div class="alarm-msg">${a.mensagem}</div>
        </div>
        <button class="btn-delete" onclick="deletarAlarme('${a.id}')">✕</button>
      `;
      lista.appendChild(li);
    });
  } catch (err) {
    console.error('Erro ao carregar alarmes:', err);
  }
}

// Adiciona alarme
async function adicionarAlarme() {
  const hora = document.getElementById('hora-alarme').value;
  const mensagem = document.getElementById('msg-alarme').value.trim();

  if (!hora || !mensagem) return;

  try {
    await fetch('/api/alarmes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hora, mensagem })
    });
    document.getElementById('hora-alarme').value = '';
    document.getElementById('msg-alarme').value = '';
    carregarAlarmes();
  } catch (err) {
    console.error('Erro ao adicionar alarme:', err);
  }
}

// Deleta alarme
async function deletarAlarme(id) {
  if (!confirm('Deletar alarme?')) return;
  try {
    await fetch(`/api/alarmes/${id}`, { method: 'DELETE' });
    carregarAlarmes();
  } catch (err) {
    console.error('Erro ao deletar alarme:', err);
  }
}

// Tabs
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    // Remove ativo
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));

    // Ativa novo
    btn.classList.add('active');
    const tab = btn.getAttribute('data-tab');
    document.getElementById(tab).classList.add('active');
  });
});

// Verifica autenticacao
async function verificarAutenticacao() {
  try {
    const res = await fetch('/api/auth/check');
    const data = await res.json();
    if (!data.authenticated) {
      window.location.href = '/login.html';
    }
  } catch (err) {
    console.error('Erro ao verificar autenticacao:', err);
    window.location.href = '/login.html';
  }
}

// Logout
async function fazerLogout() {
  if (confirm('Deslogar do app?')) {
    // Fecha WebSocket
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.close();
    }
    await fetch('/api/auth/logout');
    window.location.href = '/login.html';
  }
}

// Inicialização
window.addEventListener('load', () => {
  verificarAutenticacao();
  atualizarData();
  carregarTarefas();
  carregarTransacoes();
  carregarAlarmes();

  // Conecta ao WebSocket para atualizações em tempo real
  conectarWebSocket();

  // Recarrega a cada 30s como fallback
  setInterval(() => {
    carregarTarefas();
    carregarTransacoes();
    carregarAlarmes();
  }, 30000);
});

// Enter nas inputs
document.getElementById('nova-tarefa')?.addEventListener('keypress', e => {
  if (e.key === 'Enter') adicionarTarefa();
});

document.getElementById('msg-alarme')?.addEventListener('keypress', e => {
  if (e.key === 'Enter') adicionarAlarme();
});
