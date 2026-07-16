// =====================
//  STATE & WEBSOCKET
// =====================
let ws = null;
let wsReconnectAttempts = 0;
const wsMaxReconnectAttempts = 5;
const wsReconnectDelay = 3000;

let allTasks = [];
let allTransactions = [];
let allAlarms = [];
let currentTaskFilter = 'todas';
let currentFinFilter = 'todas';
let performanceChart = null;
let currentChartType = 'line';
let notificacaoPermitida = false;
let modoNoturnoAtivo = false;
let usarFrasesMotivacionais = true;

// =====================
//  ESTADO PERSISTENTE (banco de dados, com fallback local)
// =====================
let _estado = {};
let _estadoCarregado = false;
const LS = window.localStorage; // acesso cru (não sofre a substituição em massa)

async function carregarEstado() {
  try {
    const r = await fetch('/api/estado').then(x => x.json());
    _estado = r.estado || {};
    _estadoCarregado = true;
    // Migração: leva pro banco o que ainda só existe no armazenamento local
    for (let i = 0; i < LS.length; i++) {
      const k = LS.key(i);
      if (k && !(k in _estado)) {
        const v = LS.getItem(k);
        _estado[k] = v;
        fetch(`/api/estado/${encodeURIComponent(k)}`, {
          method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ valor: v })
        }).catch(() => {});
      }
    }
  } catch (e) {
    _estadoCarregado = false; // sem banco: cai no armazenamento local
  }
}

// Substituem localStorage.getItem/setItem: leem do banco (cache) com fallback local
function estadoGet(chave) {
  if (_estadoCarregado && (chave in _estado)) return _estado[chave];
  return LS.getItem(chave);
}

function estadoSet(chave, valor) {
  const s = valor == null ? null : String(valor);
  _estado[chave] = s;
  try { LS.setItem(chave, s); } catch (e) {} // fallback/backup local
  fetch(`/api/estado/${encodeURIComponent(chave)}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ valor: s })
  }).catch(() => {});
}

// =====================
//  HELPER: DATA LOCAL (sem bug de timezone)
// =====================
function hojeLocal() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function ontemLocal() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function amanhaLocal() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function anteontemLocal() {
  const d = new Date();
  d.setDate(d.getDate() - 2);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// Frases motivacionais
const FRASES_MOTIVACIONAIS = {
  manha: [
    'Bom dia! Você vai arrasar hoje! 💪',
    'Café na veia, tarefas na mira! ☕',
    'Acordou? Agora é hora de bombar! 🔥',
    'Segunda a se vencer é aquela ali! 🎯',
    'Dia novo, energia nova! ⚡'
  ],
  fim_tarefa: [
    'Excelente! Uma a menos! ✅',
    'Booom! Você tá arrasando! 🔥',
    'Isso aí! Continua assim! 💯',
    'Tarefa morta! Próxima! 💪',
    'Bom demais! Tá pegando ritmo! 🚀'
  ],
  meta_atingida: [
    'Modo animal! Você é um CAMPEÃO! 🏆',
    'ESSE É MEU CAMPEONATO! 🥇',
    'Você nasceu pra isso! 👑',
    'SENSACIONAL! Você é TOP 1! 🌟',
    'Nem parece que começou o dia! 🎉'
  ],
  pomodoro: [
    'Pomodoro iniciado. Foco máximo! 🎯',
    '25 minutos de pura concentração! 💪',
    'Time to focus, my friend! 🍅',
    'Vamo lá destruir essa tarefa! 🔥',
    'Pomodoro ativado. Modo beast ON! 💯'
  ],
  pausa_pomodoro: [
    'Pausa merecida! Hidrate-se! 💧',
    'Tempo de recuperação! Respira! 🌬️',
    'Você fez jus a esse descanso! 😎',
    'Aproveita a brecha! 🏖️',
    'Pausa estratégica! Volta renovado! ⚡'
  ]
};

function obterFraseMotivacional(tipo = 'manha') {
  if (!usarFrasesMotivacionais) return '';
  const frases = FRASES_MOTIVACIONAIS[tipo] || FRASES_MOTIVACIONAIS.manha;
  return frases[Math.floor(Math.random() * frases.length)];
}
let pomodoroAtivo = false;
let pomodoroTempo = 0;
let pomodoroMaxTempo = 25 * 60; // 25 minutos em segundos
let pomodoroEmPausa = false;
let pomodoroIntervalo = null;
let pomodoroContador = 0;
let orcamentos = {}; // Armazena limite por categoria
let userXP = 0;
let userLevel = 1;

const XP_POR_LEVEL = [0, 100, 250, 450, 700, 1000, 1350, 1750, 2200, 2700, 3250];

// Carregar dados do jogador
function carregarDadosJogador() {
  const salvo = estadoGet('playerData');
  if (salvo) {
    const data = JSON.parse(salvo);
    userXP = data.xp || 0;
    userLevel = data.level || 1;
  }
  carregarOrcamentos();
}

function salvarDadosJogador() {
  estadoSet('playerData', JSON.stringify({ xp: userXP, level: userLevel }));
}

// Ganhar XP
function ganharXP(quantidade) {
  userXP += quantidade;

  // Verificar level up
  while (userLevel < XP_POR_LEVEL.length && userXP >= XP_POR_LEVEL[userLevel]) {
    userLevel++;
    toast(`🎉 LEVEL UP! Você agora é nível ${userLevel}! 🚀`, 'success');
    confetti({ particleCount: 80, spread: 70 });
  }

  salvarDadosJogador();
  atualizarDisplayXP();
}

function atualizarDisplayXP() {
  const display = document.getElementById('player-xp');
  if (display) {
    const xpAtual = userXP - (XP_POR_LEVEL[userLevel - 1] || 0);
    const xpProximo = (XP_POR_LEVEL[userLevel] || 10000) - (XP_POR_LEVEL[userLevel - 1] || 0);
    const percentual = (xpAtual / xpProximo) * 100;

    display.innerHTML = `
      <div style="display: flex; align-items: center; gap: 12px;">
        <div style="font-size: 20px;">⭐</div>
        <div style="flex: 1;">
          <div style="font-size: 12px; color: var(--text-muted); margin-bottom: 4px;">Nível ${userLevel}</div>
          <div style="height: 6px; background: var(--bg-tertiary); border-radius: 3px; overflow: hidden;">
            <div style="height: 100%; background: var(--accent); width: ${percentual}%;"></div>
          </div>
          <div style="font-size: 11px; color: var(--text-muted); margin-top: 4px;">${Math.round(xpAtual)}/${Math.round(xpProximo)} XP</div>
        </div>
      </div>
    `;
  }
}

// Carregar orçamentos do localStorage
function carregarOrcamentos() {
  const salvo = estadoGet('orcamentos');
  if (salvo) {
    orcamentos = JSON.parse(salvo);
  } else {
    // Plano financeiro do Mateus: teto de alimentação = R$800/mês (R$200/semana)
    orcamentos = { alimentacao: 800 };
    estadoSet('orcamentos', JSON.stringify(orcamentos));
  }
}

// Solicitar permissão de notificação ao carregar
if ('Notification' in window && Notification.permission === 'default') {
  Notification.requestPermission().then(perm => {
    notificacaoPermitida = perm === 'granted';
  });
} else if ('Notification' in window) {
  notificacaoPermitida = Notification.permission === 'granted';
}

// =====================
//  ATALHOS DE TECLADO
// =====================
const ATALHOS = {
  'Ctrl+Shift+T': () => abrirQuickAddModal('tarefa'),
  'Ctrl+Shift+M': () => abrirQuickAddModal('transacao'),
  'Ctrl+Shift+E': () => abrirQuickAddModal('evento'),
  'Ctrl+K': () => abrirSearchGlobal(),
  '?': () => abrirAtalhos()
};

document.addEventListener('keydown', (e) => {
  // Não ativa se está digitando em input
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
    return;
  }

  const key = [
    e.ctrlKey && 'Ctrl',
    e.shiftKey && 'Shift',
    e.altKey && 'Alt',
    e.key.length === 1 ? e.key.toUpperCase() : e.key
  ].filter(Boolean).join('+');

  if (ATALHOS[key]) {
    e.preventDefault();
    ATALHOS[key]();
  }
});

function abrirAtalhos() {
  const modal = document.createElement('div');
  modal.id = 'shortcuts-modal';
  modal.innerHTML = `
    <div id="shortcuts-overlay" class="custom-modal" onclick="fecharAtalhos(event)">
      <div class="shortcuts-content">
        <div class="modal-header">
          <h2>⌨️ Atalhos de Teclado</h2>
          <button class="modal-close" onclick="fecharAtalhos()">✕</button>
        </div>
        <div class="shortcuts-grid">
          <div class="shortcut-item">
            <div class="shortcut-key">Ctrl + Shift + T</div>
            <div class="shortcut-label">Nova Tarefa</div>
          </div>
          <div class="shortcut-item">
            <div class="shortcut-key">Ctrl + Shift + M</div>
            <div class="shortcut-label">Nova Transação</div>
          </div>
          <div class="shortcut-item">
            <div class="shortcut-key">Ctrl + Shift + E</div>
            <div class="shortcut-label">Novo Evento</div>
          </div>
          <div class="shortcut-item">
            <div class="shortcut-key">Ctrl + K</div>
            <div class="shortcut-label">Busca Global</div>
          </div>
          <div class="shortcut-item">
            <div class="shortcut-key">Ctrl + Shift + F</div>
            <div class="shortcut-label">Modo Foco</div>
          </div>
          <div class="shortcut-item">
            <div class="shortcut-key">?</div>
            <div class="shortcut-label">Ver Atalhos</div>
          </div>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
}

function fecharAtalhos(e) {
  if (e && e.target.id !== 'shortcuts-overlay') return;
  const modal = document.getElementById('shortcuts-modal');
  if (modal) modal.remove();
}

function abrirSearchGlobal() {
  const modal = document.createElement('div');
  modal.id = 'search-modal';
  modal.innerHTML = `
    <div id="search-overlay" class="custom-modal" onclick="fecharSearch(event)">
      <div class="search-content">
        <div class="search-input-wrapper">
          <span style="font-size: 20px; margin-right: 10px;">🔍</span>
          <input type="text" id="search-input" placeholder="Buscar tarefas, transações, eventos..." autofocus>
        </div>
        <div id="search-results" class="search-results"></div>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  const input = document.getElementById('search-input');
  input.addEventListener('input', (e) => realizarBusca(e.target.value));
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') fecharSearch();
  });
}

function realizarBusca(query) {
  if (!query.trim()) {
    document.getElementById('search-results').innerHTML = '';
    return;
  }

  const q = query.toLowerCase();
  const resultados = [];

  // Buscar tarefas
  allTasks.filter(t => t.titulo.toLowerCase().includes(q)).forEach(t => {
    resultados.push({
      tipo: '📝',
      titulo: t.titulo,
      desc: `${t.categoria || 'Geral'} • ${t.concluida ? '✓' : '⏳'}`,
      id: t.id,
      acao: () => trocarAba('rotina')
    });
  });

  // Buscar transações
  allTransactions.filter(t => t.descricao.toLowerCase().includes(q)).forEach(t => {
    resultados.push({
      tipo: t.tipo === 'entrada' ? '📈' : '📉',
      titulo: t.descricao,
      desc: `R$ ${t.valor.toFixed(2)} • ${t.categoria}`,
      id: t.id,
      acao: () => trocarAba('financeiro')
    });
  });

  const html = resultados.map((r, i) => `
    <div class="search-result-item" onclick="${r.acao.toString()}; fecharSearch()">
      <span>${r.tipo}</span>
      <div>
        <div class="search-result-title">${r.titulo}</div>
        <div class="search-result-desc">${r.desc}</div>
      </div>
    </div>
  `).join('');

  document.getElementById('search-results').innerHTML = html || '<div style="padding: 20px; text-align: center; color: var(--text-muted);">Nenhum resultado</div>';
}

function fecharSearch(e) {
  if (e && e.target.id !== 'search-overlay') return;
  const modal = document.getElementById('search-modal');
  if (modal) modal.remove();
}

// =====================
//  MODO NOTURNO AUTOMÁTICO
// =====================
function verificarModoNoturno() {
  const agora = new Date();
  const hora = agora.getHours();
  const deveSerNoturno = hora >= 19 || hora < 7; // 19h até 7h
  if (deveSerNoturno && !modoNoturnoAtivo) ativarModoNoturno();
  else if (!deveSerNoturno && modoNoturnoAtivo) desativarModoNoturno();
}

function ativarModoNoturno() {
  modoNoturnoAtivo = true;
  document.body.classList.add('modo-noturno');
  estadoSet('modoNoturno', 'true');
}

function desativarModoNoturno() {
  modoNoturnoAtivo = false;
  document.body.classList.remove('modo-noturno');
  estadoSet('modoNoturno', 'false');
}

// Verificar modo noturno a cada 5 minutos
setInterval(verificarModoNoturno, 5 * 60 * 1000);

// Restaurar modo noturno + carregar player ao carregar
window.addEventListener('load', () => {
  if (estadoGet('modoNoturno') === 'true') ativarModoNoturno();
  verificarModoNoturno();
  carregarDadosJogador();
  atualizarDisplayXP();
});

// =====================
//  POMODORO
// =====================
function iniciarPomodoro() {
  if (pomodoroAtivo) {
    // Pausar
    clearInterval(pomodoroIntervalo);
    pomodoroEmPausa = true;
    pomodoroAtivo = false;
    atualizarVisualizacaoPomodoro();
    toast(obterFraseMotivacional('pausa_pomodoro'), 'info');
    return;
  }

  pomodoroAtivo = true;
  pomodoroEmPausa = false;
  pomodoroTempo = 0;

  toast(obterFraseMotivacional('pomodoro'), 'success');

  pomodoroIntervalo = setInterval(() => {
    pomodoroTempo++;

    if (pomodoroTempo >= pomodoroMaxTempo) {
      clearInterval(pomodoroIntervalo);
      finalizarPomodoro();
      return;
    }

    atualizarVisualizacaoPomodoro();
  }, 1000);

  atualizarVisualizacaoPomodoro();
}

function finalizarPomodoro() {
  pomodoroAtivo = false;
  pomodoroTempo = pomodoroMaxTempo;
  pomodoroContador++;

  atualizarVisualizacaoPomodoro();

  // Celebração
  celebrarPomodoro();

  // Notificação
  enviarNotificacao('Pomodoro Completo!', {
    body: `Parabéns! Você completou ${pomodoroContador} Pomodoro(s) hoje`,
    tag: 'pomodoro-complete'
  });

  // Resetar após 2 segundos
  setTimeout(() => {
    pomodoroTempo = 0;
    atualizarVisualizacaoPomodoro();
  }, 2000);

  // Guardar estatística
  const hoje = hojeLocal();
  estadoSet(`pomodoroHoje_${hoje}`, pomodoroContador);
}

function resetarPomodoro() {
  clearInterval(pomodoroIntervalo);
  pomodoroAtivo = false;
  pomodoroTempo = 0;
  pomodoroEmPausa = false;
  atualizarVisualizacaoPomodoro();
}

function atualizarVisualizacaoPomodoro() {
  const display = document.getElementById('pomodoro-display');
  const btn = document.getElementById('pomodoro-btn');
  const progresso = document.getElementById('pomodoro-progress');

  if (!display || !btn || !progresso) return;

  const minutos = Math.floor((pomodoroMaxTempo - pomodoroTempo) / 60);
  const segundos = (pomodoroMaxTempo - pomodoroTempo) % 60;

  display.textContent = `${String(minutos).padStart(2, '0')}:${String(segundos).padStart(2, '0')}`;

  const percentual = (pomodoroTempo / pomodoroMaxTempo) * 100;
  progresso.style.width = percentual + '%';

  btn.textContent = pomodoroAtivo ? '⏸️ Pausar' : pomodoroEmPausa ? '▶️ Retomar' : '▶️ Iniciar';
}

function abrirPomodoro() {
  const modal = document.createElement('div');
  modal.id = 'pomodoro-modal';
  modal.innerHTML = `
    <div id="pomodoro-overlay" class="custom-modal" onclick="fecharPomodoro(event)">
      <div class="pomodoro-content">
        <div class="modal-header">
          <h2>Pomodoro</h2>
          <button class="modal-close" onclick="fecharPomodoro()">✕</button>
        </div>
        <div class="pomodoro-body">
          <div class="pomodoro-timer">
            <div id="pomodoro-display">25:00</div>
          </div>
          <div class="pomodoro-bar">
            <div id="pomodoro-progress" class="pomodoro-progress-fill"></div>
          </div>
          <div class="pomodoro-stats">
            <span>🍅 Hoje: <strong id="pomodoro-count">0</strong> Pomodoros</span>
          </div>
          <div class="pomodoro-buttons">
            <button id="pomodoro-btn" class="btn-primary" onclick="iniciarPomodoro()" style="flex: 1;">▶️ Iniciar</button>
            <button class="btn-secondary" onclick="resetarPomodoro()">🔄 Resetar</button>
          </div>
          <div class="pomodoro-tip">
            <strong>Dica:</strong> 25 min de trabalho, 5 min de pausa. Após 4 Pomodoros, faça pausa de 15 min.
          </div>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
  atualizarVisualizacaoPomodoro();

  // Mostrar contador
  const hoje = hojeLocal();
  const chave = 'pomodoroHoje_' + hoje;
  const count = estadoGet(chave) || '0';
  document.getElementById('pomodoro-count').textContent = count;
  pomodoroContador = parseInt(count);
}

function fecharPomodoro(e) {
  if (e && e.target.id !== 'pomodoro-overlay') return;
  const modal = document.getElementById('pomodoro-modal');
  if (modal) modal.remove();
}

// =====================
//  CELEBRAÇÃO & CONFETE
// =====================
function celebrarTarefa() {
  // Confete no centro
  confetti({
    particleCount: 50,
    spread: 60,
    origin: { x: 0.5, y: 0.3 },
    colors: ['#31a24c', '#10b981', '#5b7cfa', '#f5a623']
  });

  toast(obterFraseMotivacional('fim_tarefa'), 'success');
}

function celebrarMeta() {
  // Confete grande
  confetti({
    particleCount: 100,
    spread: 90,
    origin: { x: 0.5, y: 0.3 },
    colors: ['#fbbf24', '#f5a623', '#10b981', '#5b7cfa']
  });

  // Animar background momentaneamente
  document.body.style.filter = 'brightness(1.2)';
  setTimeout(() => {
    document.body.style.filter = 'brightness(1)';
  }, 500);

  toast(obterFraseMotivacional('meta_atingida'), 'success');
}

function celebrarPomodoro() {
  // Confete pequeno
  confetti({
    particleCount: 30,
    spread: 45,
    origin: { x: 0.5, y: 0.3 }
  });

  toast('Pomodoro completado! ' + obterFraseMotivacional('pausa_pomodoro'), 'success');
}

// =====================
//  RESUMO DIÁRIO/SEMANAL
// =====================
function gerarResumoDiario() {
  const hoje = hojeLocal();
  const tarefasHoje = allTasks.filter(t => {
    if (!t.data_reset) return false;
    return t.data_reset.split('T')[0] === hoje;
  });

  const concluidas = tarefasHoje.filter(t => t.concluida).length;
  const total = tarefasHoje.length;
  const taxa = total > 0 ? Math.round((concluidas / total) * 100) : 0;

  // Gastos hoje
  let gastos = 0;
  allTransactions.forEach(t => {
    if (t.data.substring(0, 10) === hoje && t.tipo === 'saida') {
      gastos += parseFloat(t.valor);
    }
  });

  // Horário de pico
  const horariosCount = {};
  tarefasHoje.filter(t => t.concluida && t.hora).forEach(t => {
    const hora = t.hora.substring(0, 2);
    horariosCount[hora] = (horariosCount[hora] || 0) + 1;
  });
  const melhorHora = Object.keys(horariosCount).length > 0
    ? Object.keys(horariosCount).reduce((a, b) => horariosCount[a] > horariosCount[b] ? a : b)
    : null;

  const resumo = {
    data: hoje,
    concluidas,
    total,
    taxa,
    gastos,
    melhorHora,
    pomodoros: estadoGet(`pomodoroHoje_${hoje}`) || 0
  };

  return resumo;
}

function gerarResumoSemanal() {
  const hoje = new Date();
  const domingo = new Date(hoje);
  domingo.setDate(hoje.getDate() - hoje.getDay());

  const resumosPorDia = {};
  for (let i = 0; i < 7; i++) {
    const data = new Date(domingo);
    data.setDate(data.getDate() + i);
    const y = data.getFullYear(), mo = String(data.getMonth()+1).padStart(2,'0'), dy = String(data.getDate()).padStart(2,'0');
    const dataStr = `${y}-${mo}-${dy}`;

    const tarefasData = allTasks.filter(t => {
      if (!t.data_reset) return false;
      return t.data_reset.split('T')[0] === dataStr;
    });

    const concluidas = tarefasData.filter(t => t.concluida).length;
    const total = tarefasData.length;

    resumosPorDia[dataStr] = {
      dia: data.toLocaleDateString('pt-BR', { weekday: 'short' }).toUpperCase(),
      concluidas,
      total,
      taxa: total > 0 ? Math.round((concluidas / total) * 100) : 0
    };
  }

  return resumosPorDia;
}

function abrirResumoDiario() {
  const resumo = gerarResumoDiario();
  const modal = document.createElement('div');
  modal.id = 'resumo-modal';
  modal.innerHTML = `
    <div id="resumo-overlay" class="custom-modal" onclick="fecharResumo(event)">
      <div class="modal-content" style="max-width: 500px;">
        <div class="modal-header">
          <h2>📊 Resumo do Dia</h2>
          <button class="modal-close" onclick="fecharResumo()">✕</button>
        </div>
        <div class="modal-body">
          <div class="resumo-grid">
            <div class="resumo-card">
              <div style="font-size: 14px; color: var(--text-muted);">Tarefas</div>
              <div style="font-size: 28px; font-weight: 700; color: var(--accent);">${resumo.concluidas}/${resumo.total}</div>
              <div style="font-size: 12px; color: var(--text-secondary);">Taxa: ${resumo.taxa}%</div>
            </div>
            <div class="resumo-card">
              <div style="font-size: 14px; color: var(--text-muted);">Gastos</div>
              <div style="font-size: 28px; font-weight: 700; color: var(--danger);">R$ ${resumo.gastos.toFixed(2)}</div>
              <div style="font-size: 12px; color: var(--text-secondary);">Hoje</div>
            </div>
            <div class="resumo-card">
              <div style="font-size: 14px; color: var(--text-muted);">Pomodoros</div>
              <div style="font-size: 28px; font-weight: 700; color: var(--warning);">🍅 ${resumo.pomodoros}</div>
              <div style="font-size: 12px; color: var(--text-secondary);">Completados</div>
            </div>
            ${resumo.melhorHora ? `
            <div class="resumo-card">
              <div style="font-size: 14px; color: var(--text-muted);">Melhor Hora</div>
              <div style="font-size: 28px; font-weight: 700; color: var(--success);">${resumo.melhorHora}h</div>
              <div style="font-size: 12px; color: var(--text-secondary);">Mais produtivo</div>
            </div>
            ` : ''}
          </div>
          <div style="margin-top: 20px; padding: 16px; background: var(--bg-tertiary); border-radius: 8px; font-size: 13px; color: var(--text-secondary); text-align: center;">
            ${resumo.taxa >= 80 ? '🌟 Excelente dia! Continue assim!' : resumo.taxa >= 60 ? '👍 Bom dia! Você tá indo bem!' : '💪 Amanhã é outro dia! Vamo lá!'}
          </div>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
}

function fecharResumo(e) {
  if (e && e.target.id !== 'resumo-overlay') return;
  const modal = document.getElementById('resumo-modal');
  if (modal) modal.remove();
}

// Notificação automática de resumo às 21h
setInterval(() => {
  const agora = new Date();
  const hora = agora.getHours();
  const minuto = agora.getMinutes();

  if (hora === 21 && minuto === 0) {
    const resumo = gerarResumoDiario();
    toast(`📊 Resumo: ${resumo.concluidas}/${resumo.total} tarefas (${resumo.taxa}%)`, 'info');
    setTimeout(() => abrirResumoDiario(), 1000);
  }
}, 60000); // Verifica a cada minuto

// =====================
//  ORÇAMENTO POR CATEGORIA
// =====================
function abrirConfigOrcamentos() {
  const categorias = ['alimentacao', 'transporte', 'saude', 'lazer', 'outro'];
  const labels = {
    'alimentacao': '🍕 Alimentação',
    'transporte': '🚗 Transporte',
    'saude': '💊 Saúde',
    'lazer': '🎮 Lazer',
    'outro': '📌 Outro'
  };

  const modal = document.createElement('div');
  modal.id = 'orcamentos-modal';
  modal.innerHTML = `
    <div id="orcamentos-overlay" class="custom-modal" onclick="fecharConfigOrcamentos(event)">
      <div class="modal-content">
        <div class="modal-header">
          <h2>💳 Configurar Orçamentos</h2>
          <button class="modal-close" onclick="fecharConfigOrcamentos()">✕</button>
        </div>
        <div class="modal-body">
          <div class="orcamentos-list">
            ${categorias.map(cat => `
              <div class="orcamento-item">
                <label>${labels[cat]}</label>
                <input type="number" id="orcamento-${cat}" placeholder="R$ 0,00" value="${orcamentos[cat] || ''}">
              </div>
            `).join('')}
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn-secondary" onclick="fecharConfigOrcamentos()">Cancelar</button>
          <button class="btn-primary" onclick="salvarOrcamentos()">Salvar</button>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
}

function salvarOrcamentos() {
  const categorias = ['alimentacao', 'transporte', 'saude', 'lazer', 'outro'];
  const novo = {};

  categorias.forEach(cat => {
    const input = document.getElementById(`orcamento-${cat}`);
    if (input && input.value) {
      novo[cat] = parseFloat(input.value);
    }
  });

  orcamentos = novo;
  estadoSet('orcamentos', JSON.stringify(orcamentos));
  toast('✅ Orçamentos salvos!', 'success');
  fecharConfigOrcamentos();
  atualizarDashboard();
}

function fecharConfigOrcamentos(e) {
  if (e && e.target.id !== 'orcamentos-overlay') return;
  const modal = document.getElementById('orcamentos-modal');
  if (modal) modal.remove();
}

function renderOrcamentosVisual() {
  // Calcular gastos por categoria neste mês
  const hoje = new Date();
  const mesAtual = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}`;

  const gastos = {};
  allTransactions.forEach(t => {
    const dataMes = t.data.substring(0, 7);
    if (dataMes === mesAtual && t.tipo === 'saida') {
      gastos[t.categoria] = (gastos[t.categoria] || 0) + parseFloat(t.valor);
    }
  });

  const labels = {
    'alimentacao': '🍕 Alimentação',
    'transporte': '🚗 Transporte',
    'saude': '💊 Saúde',
    'lazer': '🎮 Lazer',
    'outro': '📌 Outro'
  };

  const container = document.createElement('div');
  container.className = 'orcamentos-visual';

  let temOrcamento = false;
  Object.entries(orcamentos).forEach(([cat, limite]) => {
    if (!limite) return;
    temOrcamento = true;

    const gasto = gastos[cat] || 0;
    const percentual = (gasto / limite) * 100;
    const cor = percentual >= 100 ? '#f81d13' : percentual >= 80 ? '#f5a623' : '#31a24c';

    container.innerHTML += `
      <div class="orcamento-card">
        <div style="display: flex; justify-content: space-between; margin-bottom: 8px;">
          <span>${labels[cat]}</span>
          <span style="color: var(--text-muted); font-size: 12px;">R$ ${gasto.toFixed(2)} / R$ ${limite.toFixed(2)}</span>
        </div>
        <div class="orcamento-barra">
          <div class="orcamento-fill" style="width: ${Math.min(percentual, 100)}%; background: ${cor};"></div>
        </div>
        ${percentual >= 80 ? `<div style="color: ${cor}; font-size: 12px; margin-top: 4px;">⚠️ ${Math.round(percentual)}% do limite</div>` : ''}
      </div>
    `;

    // Alertar se passou do limite
    if (gasto > limite) {
      setTimeout(() => {
        toast(`⚠️ Você ultrapassou o orçamento de ${labels[cat].split(' ')[1]}!`, 'error');
      }, 100);
    }
  });

  if (temOrcamento) {
    const painel = document.getElementById('painel-orcamentos');
    if (painel) {
      painel.innerHTML = container.innerHTML;
    }
  }
}

// =====================
//  PLANO FINANCEIRO + ANÁLISE DIÁRIA
// =====================
// Plano real do Mateus (jun/2026). Renda é PISO — meses melhores viram excedente.
const PLANO_FINANCEIRO = {
  rendaPiso: 3500,
  boletos: [
    { nome: 'Academia', valor: 85.00, dia: 5 },
    { nome: 'Água (média)', valor: 80.00, dia: 8 },
    { nome: 'Pilates', valor: 185.00, dia: 10 },
    { nome: 'Internet', valor: 70.00, dia: 11 },
    { nome: 'Consórcio', valor: 410.04, dia: 10 }
  ],
  emprestimo: { nome: 'Empréstimo', valor: 1188.65, dia: 23, parcelasRestantes: 12 },
  assinaturas: 175.08, // TIM, Netflix, HBO, Spotify, Discord, Meli+, 2x GDrive (sem Crunchyroll)
  projetos: 38.99,     // Discloud + Railway
  potes: {
    comida:  { limite: 800, semanal: 200 },
    reserva: { meta: 250 },
    folga:   { limite: 217 }
  }
};

function _planoComprometidoMensal() {
  const b = PLANO_FINANCEIRO.boletos.reduce((s, x) => s + x.valor, 0);
  return b + PLANO_FINANCEIRO.emprestimo.valor + PLANO_FINANCEIRO.assinaturas + PLANO_FINANCEIRO.projetos;
}

// ---- Reserva (rastreamento manual via localStorage) ----
function carregarReservaEntries() {
  try { return JSON.parse(estadoGet('reservaEntries') || '[]'); }
  catch (e) { return []; }
}

function reservaTotais() {
  const entries = carregarReservaEntries();
  const total = entries.reduce((s, e) => s + parseFloat(e.valor || 0), 0);
  const agora = new Date();
  const mesAtual = `${agora.getFullYear()}-${String(agora.getMonth() + 1).padStart(2, '0')}`;
  const mes = entries
    .filter(e => (e.data || '').substring(0, 7) === mesAtual)
    .reduce((s, e) => s + parseFloat(e.valor || 0), 0);
  return { total, mes };
}

async function abrirAddReserva() {
  const r = await promptModal({
    titulo: 'Guardar na reserva',
    campos: [{ name: 'valor', label: 'Quanto você guardou (R$)', tipo: 'number', placeholder: '0,00' }]
  });
  if (!r) return;
  const valor = parseFloat(String(r.valor).replace(',', '.'));
  if (isNaN(valor) || valor <= 0) { toast('Valor inválido', 'error'); return; }
  const entries = carregarReservaEntries();
  entries.push({ data: hojeLocal(), valor });
  estadoSet('reservaEntries', JSON.stringify(entries));
  toast(`+${formatBRL(valor)} guardado na reserva!`, 'success');
  if (valor >= 30) { try { ganharXP(10); } catch (e) {} }
  renderAnaliseFinanceira();
}

function _inicioSemanaLocal() {
  // Segunda-feira como início da semana
  const d = new Date();
  const dow = d.getDay(); // 0=dom .. 6=sab
  const diff = dow === 0 ? 6 : dow - 1;
  d.setDate(d.getDate() - diff);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function analisarFinancas() {
  const agora = new Date();
  const diaDoMes = agora.getDate();
  const mesAtual = `${agora.getFullYear()}-${String(agora.getMonth() + 1).padStart(2, '0')}`;
  const inicioSemana = _inicioSemanaLocal();

  const txMes = allTransactions.filter(t => (t.data || '').substring(0, 7) === mesAtual);
  const entradasMes = txMes.filter(t => t.tipo === 'entrada').reduce((s, t) => s + parseFloat(t.valor), 0);
  const saidasMes = txMes.filter(t => t.tipo === 'saida').reduce((s, t) => s + parseFloat(t.valor), 0);

  // Comida na semana atual
  const gastoComidaSemana = allTransactions
    .filter(t => t.tipo === 'saida' && t.categoria === 'alimentacao' && (t.data || '').substring(0, 10) >= inicioSemana)
    .reduce((s, t) => s + parseFloat(t.valor), 0);
  const tetoSemana = PLANO_FINANCEIRO.potes.comida.semanal;
  const restanteSemana = tetoSemana - gastoComidaSemana;
  const dow = agora.getDay();
  const diasRestantesSemana = dow === 0 ? 1 : (8 - dow); // inclui hoje
  const podePorDia = restanteSemana > 0 ? restanteSemana / diasRestantesSemana : 0;

  // Próximos vencimentos (7 dias)
  const compromissos = [...PLANO_FINANCEIRO.boletos, PLANO_FINANCEIRO.emprestimo].filter(c => c.dia);
  const proximos = compromissos
    .filter(c => c.dia >= diaDoMes && c.dia <= diaDoMes + 7)
    .sort((a, b) => a.dia - b.dia);
  const totalProximos = proximos.reduce((s, c) => s + c.valor, 0);

  const comprometido = _planoComprometidoMensal();
  const rendaRef = entradasMes > 0 ? entradasMes : PLANO_FINANCEIRO.rendaPiso;
  const sobraMes = rendaRef - comprometido;
  const excedente = entradasMes - PLANO_FINANCEIRO.rendaPiso;

  // ---- Sugestões ----
  const sugestoes = [];

  // 1. Comida da semana
  if (restanteSemana < 0) {
    sugestoes.push({ tipo: 'alerta', texto: `Estourou o teto de comida da semana em ${formatBRL(Math.abs(restanteSemana))}. Segura o delivery até segunda — cozinha o que já tem em casa.` });
  } else if (gastoComidaSemana >= tetoSemana * 0.8) {
    sugestoes.push({ tipo: 'atencao', texto: `Restam só ${formatBRL(restanteSemana)} de comida nesta semana (≈ ${formatBRL(podePorDia)}/dia). Pé no freio até domingo.` });
  } else {
    sugestoes.push({ tipo: 'ok', texto: `Comida da semana: ${formatBRL(gastoComidaSemana)} de ${formatBRL(tetoSemana)}. Pode usar até ${formatBRL(podePorDia)}/dia até domingo.` });
  }

  // 2. Próximos vencimentos
  if (proximos.length > 0) {
    const lista = proximos.map(c => `${c.nome} (dia ${c.dia} · ${formatBRL(c.valor)})`).join(', ');
    sugestoes.push({ tipo: 'atencao', texto: `Vence nos próximos 7 dias: ${lista}. Separa ${formatBRL(totalProximos)} agora pra não ser pego de surpresa.` });
  }

  // 3. Empréstimo (a âncora)
  const e = PLANO_FINANCEIRO.emprestimo;
  if (e.dia >= diaDoMes && e.dia <= diaDoMes + 7) {
    sugestoes.push({ tipo: 'alerta', texto: `Parcela do empréstimo (${formatBRL(e.valor)}) vence dia ${e.dia}. É a maior saída do mês — garante que está reservada.` });
  }

  // 4. Excedente do mês (regra de ouro)
  if (excedente > 50) {
    const metade = excedente / 2;
    sugestoes.push({ tipo: 'ok', texto: `Entrou ${formatBRL(excedente)} acima do piso este mês. Regra de ouro: ${formatBRL(metade)} pra reserva + ${formatBRL(metade)} pra abater o empréstimo. NÃO incha o padrão de vida.` });
  } else if (entradasMes > 0 && entradasMes < PLANO_FINANCEIRO.rendaPiso) {
    sugestoes.push({ tipo: 'atencao', texto: `Mês magro: entrou ${formatBRL(entradasMes)} (abaixo do piso de ${formatBRL(PLANO_FINANCEIRO.rendaPiso)}). Corta o supérfluo e prioriza boletos + empréstimo.` });
  }

  // 5. Saúde geral do mês (gasto vs sobra prevista)
  const livreDepoisFixos = rendaRef - comprometido; // = sobraMes
  const gastoVariavel = saidasMes; // saídas que o usuário registrou
  if (livreDepoisFixos > 0 && gastoVariavel > livreDepoisFixos) {
    sugestoes.push({ tipo: 'alerta', texto: `Já gastou ${formatBRL(gastoVariavel)} este mês — acima do que sobra depois dos fixos (${formatBRL(livreDepoisFixos)}). É aqui que o cartão entra. Trava os gastos não essenciais.` });
  }

  // 7. Projeção de fim do mês (ritmo de gastos)
  const diasNoMes = new Date(agora.getFullYear(), agora.getMonth() + 1, 0).getDate();
  const ritmoDiario = diaDoMes > 0 ? saidasMes / diaDoMes : 0;
  const gastoProjetado = ritmoDiario * diasNoMes;
  const projecaoSobra = livreDepoisFixos - gastoProjetado;
  if (saidasMes > 0) {
    if (projecaoSobra < 0) {
      sugestoes.push({ tipo: 'alerta', texto: `Projeção: no ritmo atual (${formatBRL(ritmoDiario)}/dia) você fecha o mês ${formatBRL(Math.abs(projecaoSobra))} no vermelho. Corta agora antes de virar dívida no cartão.` });
    } else {
      sugestoes.push({ tipo: 'ok', texto: `Projeção: no ritmo atual você termina o mês com ${formatBRL(projecaoSobra)} de folga. Segue firme.` });
    }
  }

  // 6. Reserva (meta mensal)
  const rsv = reservaTotais();
  const reservaMeta = PLANO_FINANCEIRO.potes.reserva.meta;
  if (rsv.mes >= reservaMeta) {
    sugestoes.push({ tipo: 'ok', texto: `Meta de reserva do mês batida! Guardou ${formatBRL(rsv.mes)} (meta ${formatBRL(reservaMeta)}). Total acumulado: ${formatBRL(rsv.total)}. 🎯` });
  } else if (rsv.mes > 0) {
    sugestoes.push({ tipo: 'atencao', texto: `Reserva do mês: ${formatBRL(rsv.mes)} de ${formatBRL(reservaMeta)}. Faltam ${formatBRL(reservaMeta - rsv.mes)} pra bater a meta. Acumulado: ${formatBRL(rsv.total)}.` });
  } else {
    sugestoes.push({ tipo: 'atencao', texto: `Você ainda não guardou nada na reserva este mês. Meta: ${formatBRL(reservaMeta)} — é o que te tira da dependência do cartão. Clica em "+ Guardar".` });
  }

  return {
    entradasMes, saidasMes, comprometido, sobraMes, excedente,
    gastoComidaSemana, tetoSemana, restanteSemana, podePorDia,
    proximos, totalProximos, rendaRef, sugestoes,
    reservaMes: rsv.mes, reservaTotal: rsv.total, reservaMeta,
    gastoProjetado, projecaoSobra, ritmoDiario, livreDepoisFixos
  };
}

function renderAnaliseFinanceira() {
  const paineis = ['painel-analise', 'painel-analise-fin']
    .map(id => document.getElementById(id))
    .filter(Boolean);
  if (paineis.length === 0) return;
  const a = analisarFinancas();

  const corPote = a.restanteSemana < 0 ? '#f81d13' : (a.restanteSemana <= a.tetoSemana * 0.2 ? '#f5a623' : '#31a24c');
  const pctComida = Math.min((a.gastoComidaSemana / a.tetoSemana) * 100, 100);
  const pctReserva = Math.min((a.reservaMes / a.reservaMeta) * 100, 100);
  const corReserva = a.reservaMes >= a.reservaMeta ? '#31a24c' : (a.reservaMes > 0 ? '#5b7cfa' : '#8a8a8e');

  const iconeSug = { ok: '✅', atencao: '⚠️', alerta: '🚨' };
  const corSug = { ok: '#31a24c', atencao: '#f5a623', alerta: '#f81d13' };

  const sugestoesHtml = a.sugestoes.map(s => `
    <div style="display:flex; gap:10px; align-items:flex-start; padding:10px 12px; background:rgba(255,255,255,0.03); border-left:3px solid ${corSug[s.tipo]}; border-radius:8px; margin-bottom:8px;">
      <span style="font-size:16px; line-height:1.2;">${iconeSug[s.tipo]}</span>
      <span style="font-size:13px; line-height:1.45;">${s.texto}</span>
    </div>
  `).join('');

  const html = `
    <div style="background:var(--card-bg, #1c1c1e); border:1px solid rgba(255,255,255,0.08); border-radius:14px; padding:18px; margin-bottom:20px;">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:14px;">
        <h2 style="margin:0; font-size:16px;">Análise Financeira do Dia</h2>
        <span style="font-size:11px; color:var(--text-muted);">${new Date().toLocaleDateString('pt-BR', { weekday:'long', day:'2-digit', month:'long' })}</span>
      </div>

      <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(140px, 1fr)); gap:10px; margin-bottom:16px;">
        <div style="background:rgba(255,255,255,0.03); border-radius:10px; padding:12px;">
          <div style="font-size:11px; color:var(--text-muted);">Renda do mês</div>
          <div style="font-size:18px; font-weight:700;">${formatBRL(a.rendaRef)}</div>
          ${a.excedente > 50 ? `<div style="font-size:11px; color:#31a24c;">+${formatBRL(a.excedente)} acima do piso</div>` : ''}
        </div>
        <div style="background:rgba(255,255,255,0.03); border-radius:10px; padding:12px;">
          <div style="font-size:11px; color:var(--text-muted);">Comprometido (fixos)</div>
          <div style="font-size:18px; font-weight:700; color:#f5a623;">${formatBRL(a.comprometido)}</div>
          <div style="font-size:11px; color:var(--text-muted);">boletos + assinaturas + empréstimo</div>
        </div>
        <div style="background:rgba(255,255,255,0.03); border-radius:10px; padding:12px;">
          <div style="font-size:11px; color:var(--text-muted);">Sobra pro mês</div>
          <div style="font-size:18px; font-weight:700; color:${a.sobraMes >= 0 ? '#31a24c' : '#f81d13'};">${formatBRL(a.sobraMes)}</div>
          <div style="font-size:11px; color:var(--text-muted);">comida + reserva + folga</div>
        </div>
      </div>

      <div style="margin-bottom:16px;">
        <div style="display:flex; justify-content:space-between; font-size:12px; margin-bottom:6px;">
          <span>Comida desta semana</span>
          <span style="color:var(--text-muted);">${formatBRL(a.gastoComidaSemana)} / ${formatBRL(a.tetoSemana)}</span>
        </div>
        <div style="height:8px; background:rgba(255,255,255,0.08); border-radius:6px; overflow:hidden;">
          <div style="height:100%; width:${pctComida}%; background:${corPote};"></div>
        </div>
      </div>

      <div style="margin-bottom:16px;">
        <div style="display:flex; justify-content:space-between; align-items:center; font-size:12px; margin-bottom:6px;">
          <span>Reserva deste mês <span style="color:var(--text-muted);">(acumulado: ${formatBRL(a.reservaTotal)})</span></span>
          <span style="display:flex; align-items:center; gap:8px;">
            <span style="color:var(--text-muted);">${formatBRL(a.reservaMes)} / ${formatBRL(a.reservaMeta)}</span>
            <button onclick="abrirAddReserva()" style="background:rgba(91,124,250,0.18); border:1px solid rgba(91,124,250,0.4); color:#5b7cfa; border-radius:6px; padding:2px 8px; font-size:11px; cursor:pointer;">+ Guardar</button>
          </span>
        </div>
        <div style="height:8px; background:rgba(255,255,255,0.08); border-radius:6px; overflow:hidden;">
          <div style="height:100%; width:${pctReserva}%; background:${corReserva};"></div>
        </div>
      </div>

      <div>${sugestoesHtml}</div>
    </div>
  `;

  paineis.forEach(p => { p.innerHTML = html; });
}

function verificarAnaliseDiaria() {
  renderAnaliseFinanceira();
  // Toast 1x por dia com a sugestão mais urgente
  const hoje = hojeLocal();
  if (estadoGet('ultimaAnaliseData') === hoje) return;
  const a = analisarFinancas();
  const prioridade = { alerta: 0, atencao: 1, ok: 2 };
  const top = [...a.sugestoes].sort((x, y) => prioridade[x.tipo] - prioridade[y.tipo])[0];
  if (top) {
    const tipoToast = top.tipo === 'alerta' ? 'error' : (top.tipo === 'atencao' ? 'info' : 'success');
    setTimeout(() => toast(`${top.texto}`, tipoToast), 1200);
  }
  estadoSet('ultimaAnaliseData', hoje);
}

// =====================
//  SUB-ABAS DO FINANCEIRO
// =====================
function trocarSubAbaFin(id) {
  document.querySelectorAll('.fin-subtab').forEach(el => { el.style.display = 'none'; });
  const alvo = document.getElementById(id);
  if (alvo) alvo.style.display = 'block';
  document.querySelectorAll('.fin-subtab-btn').forEach(btn => {
    const ativo = btn.getAttribute('data-fin-tab') === id;
    btn.classList.toggle('active', ativo);
    btn.style.color = ativo ? 'var(--text)' : 'var(--text-muted)';
    btn.style.borderBottom = ativo ? '2px solid #5b7cfa' : '2px solid transparent';
  });
  if (id === 'fin-ir') renderIR();
  if (id === 'fin-contas') carregarContas();
  if (id === 'fin-categorizar') carregarCategorizar();
  if (id === 'fin-apostas') carregarApostas();
  if (id === 'fin-metas') carregarMetas();
  if (id === 'fin-pj') carregarPJ();
  if (id === 'fin-relatorios') carregarRelatorios();
}

// =====================
//  PJ / MEI (dedicado)
// =====================
let _pjData = null;

async function carregarPJ() {
  const painel = document.getElementById('painel-pj');
  if (painel) painel.innerHTML = '<p style="color:var(--text-muted); font-size:13px;">Carregando...</p>';
  try {
    _pjData = await fetch('/api/pj').then(x => x.json());
  } catch (e) { _pjData = null; }
  renderPJ();
}

function renderPJ() {
  const painel = document.getElementById('painel-pj');
  if (!painel) return;
  const d = _pjData;
  if (!d) { painel.innerHTML = '<p style="color:var(--text-muted); font-size:13px;">Erro ao carregar.</p>'; return; }

  const t = d.teto;
  const corTeto = t.pct >= 100 ? '#f85149' : t.pct >= 80 ? '#e8950c' : '#3fb950';
  const projPctTeto = (t.projecaoAno / t.limite) * 100;
  const alertaProjecao = projPctTeto >= 100
    ? `<div style="background:rgba(248,81,73,0.12); border:1px solid rgba(248,81,73,0.3); border-radius:8px; padding:10px 12px; font-size:12px; color:#f85149; margin-top:8px;">⚠️ Projeção anual (${formatBRL(t.projecaoAno)}) ultrapassa o teto do MEI. Considere segurar o faturamento ou migrar de regime.</div>`
    : projPctTeto >= 80
    ? `<div style="background:rgba(232,149,12,0.12); border:1px solid rgba(232,149,12,0.3); border-radius:8px; padding:10px 12px; font-size:12px; color:#e8950c; margin-top:8px;">Atenção: projeção anual (${formatBRL(t.projecaoAno)}) está próxima do teto MEI (${formatBRL(t.limite)}).</div>`
    : '';

  const das = d.das.proximo;
  const dasHistoricoHtml = d.das.historico.length
    ? d.das.historico.map(h => `
        <div style="display:flex; justify-content:space-between; font-size:12px; padding:5px 0;">
          <span>${h.ym}${h.data_pagamento ? ' <span style="color:var(--text-muted); font-size:11px;">(' + new Date(h.data_pagamento).toLocaleDateString('pt-BR') + ')</span>' : ''}</span>
          <span style="color:${h.pago ? '#3fb950' : '#e8950c'};">${h.pago ? '✓ pago' : 'pendente'}${h.valor != null ? ' · ' + formatBRL(h.valor) : ''}</span>
        </div>`).join('')
    : '<p style="font-size:11px; color:var(--text-muted);">Sem histórico.</p>';

  painel.innerHTML = `
    <!-- Saldo + mês atual -->
    <div style="display:flex; gap:12px; margin-bottom:16px; flex-wrap:wrap;">
      <div style="flex:1; min-width:180px; background:var(--card-bg, #25262b); border:1px solid rgba(255,255,255,0.08); border-radius:12px; padding:14px;">
        <div style="font-size:11px; color:var(--text-muted); margin-bottom:6px;">Caixa PJ</div>
        <div style="font-size:22px; font-weight:700;">${formatBRL(d.saldo.caixa)}</div>
        ${d.saldo.cartao > 0 ? `<div style="font-size:11px; color:#e8950c; margin-top:4px;">Fatura cartão: −${formatBRL(d.saldo.cartao)}</div>` : ''}
      </div>
      <div style="flex:1; min-width:180px; background:var(--card-bg, #25262b); border:1px solid rgba(255,255,255,0.08); border-radius:12px; padding:14px;">
        <div style="font-size:11px; color:var(--text-muted); margin-bottom:6px;">Este mês (${d.mes.ym})</div>
        <div style="display:flex; justify-content:space-between; font-size:12px; padding:2px 0;"><span>Receitas</span><span style="color:#3fb950;">+${formatBRL(d.mes.entradas)}</span></div>
        <div style="display:flex; justify-content:space-between; font-size:12px; padding:2px 0;"><span>Despesas</span><span style="color:#f85149;">−${formatBRL(d.mes.saidas)}</span></div>
        <div style="display:flex; justify-content:space-between; font-size:13px; padding:6px 0 0; margin-top:4px; border-top:1px solid rgba(255,255,255,0.08); font-weight:700;"><span>Líquido</span><span style="color:${d.mes.liquido >= 0 ? '#3fb950' : '#f85149'};">${formatBRL(d.mes.liquido)}</span></div>
      </div>
    </div>

    <!-- Faturamento do ano vs teto MEI -->
    <div style="background:var(--card-bg, #25262b); border:1px solid rgba(255,255,255,0.08); border-radius:12px; padding:16px; margin-bottom:16px;">
      <div style="display:flex; justify-content:space-between; align-items:baseline; margin-bottom:8px;">
        <h2 style="font-size:15px; margin:0;">Faturamento do ano</h2>
        <span style="font-size:12px; color:var(--text-muted);">Teto MEI: ${formatBRL(t.limite)}</span>
      </div>
      <div style="display:flex; justify-content:space-between; font-size:13px; margin-bottom:6px;">
        <span style="font-weight:600;">${formatBRL(t.faturamentoAno)}</span>
        <span style="color:${corTeto};">${t.pct.toFixed(1)}% do teto</span>
      </div>
      <div style="height:10px; background:rgba(255,255,255,0.08); border-radius:6px; overflow:hidden; margin-bottom:8px;">
        <div style="height:100%; width:${Math.min(t.pct, 100)}%; background:${corTeto};"></div>
      </div>
      <div style="font-size:11px; color:var(--text-muted);">Restante até o teto: <b style="color:var(--text);">${formatBRL(t.restante)}</b> · Projeção do ano (ritmo atual): <b style="color:var(--text);">${formatBRL(t.projecaoAno)}</b></div>
      ${alertaProjecao}
    </div>

    <!-- DAS -->
    <div style="background:var(--card-bg, #25262b); border:1px solid rgba(255,255,255,0.08); border-radius:12px; padding:16px; margin-bottom:16px;">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
        <h2 style="font-size:15px; margin:0;">DAS mensal</h2>
        <span style="font-size:12px; color:var(--text-muted);">Vence dia 20 de cada mês</span>
      </div>
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px; padding:10px 12px; background:rgba(255,255,255,0.03); border-radius:8px;">
        <div>
          <div style="font-size:13px;">Próximo: <b>${das.ym}</b> <span style="color:var(--text-muted); font-size:11px;">(vence ${new Date(das.venc).toLocaleDateString('pt-BR')})</span></div>
          <div style="font-size:11px; color:${das.pago ? '#3fb950' : '#e8950c'};">${das.pago ? '✓ pago' : 'pendente'}${das.valor ? ' · ' + formatBRL(das.valor) : ''}</div>
        </div>
        <div style="display:flex; gap:6px;">
          ${das.pago
            ? `<button onclick="marcarDas('${das.ym}', false)" style="background:rgba(255,255,255,0.05); border:1px solid rgba(255,255,255,0.15); color:var(--text-secondary); border-radius:6px; padding:6px 14px; font-size:12px; cursor:pointer;">Desmarcar</button>`
            : `<button onclick="marcarDas('${das.ym}', true)" style="background:rgba(63,185,80,0.18); border:1px solid rgba(63,185,80,0.4); color:#3fb950; border-radius:6px; padding:6px 14px; font-size:12px; cursor:pointer;">Marcar como pago</button>`}
        </div>
      </div>
      <details>
        <summary style="cursor:pointer; font-size:12px; color:var(--text-muted); padding:4px 0;">Histórico (últimos ${d.das.historico.length})</summary>
        <div style="padding-top:6px;">${dasHistoricoHtml}</div>
      </details>
    </div>

    <p style="font-size:11px; color:var(--text-muted);">Categorias PJ: "PJ: Receita de serviço" e "PJ: Despesa dedutível" — use na aba Categorizar pra separar dedutíveis das despesas gerais e facilitar o IRPF.</p>`;
}

async function marcarDas(ym, pago) {
  let valor;
  if (pago) {
    const r = await promptModal({
      titulo: `DAS ${ym} — valor pago`,
      campos: [{ name: 'valor', label: 'Valor pago (R$) — opcional', tipo: 'number', placeholder: '0,00' }]
    });
    if (!r) return;
    const v = parseFloat(String(r.valor).replace(',', '.'));
    if (!isNaN(v) && v > 0) valor = v;
  }
  try {
    const res = await fetch('/api/pj/das', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ym, valor, pago })
    });
    if (!res.ok) { await toastErro(res, 'Erro'); return; }
    toast(pago ? 'DAS marcado como pago' : 'DAS desmarcado', 'success');
    carregarPJ();
  } catch (e) { toast('Erro: ' + (e.message || 'sem conexão'), 'error'); }
}

// =====================
//  RELATÓRIOS MENSAIS
// =====================
let _relLista = null;
let _relAtual = null;

async function carregarRelatorios() {
  const painel = document.getElementById('painel-relatorios');
  if (painel) painel.innerHTML = '<p style="color:var(--text-muted); font-size:13px;">Carregando...</p>';
  try {
    _relLista = await fetch('/api/relatorios').then(x => x.json());
    const ym = (_relLista.meses[0] && _relLista.meses[0].ym) || new Date().toISOString().substring(0, 7);
    _relAtual = await fetch(`/api/relatorios/${ym}`).then(x => x.json());
  } catch (e) { _relLista = null; _relAtual = null; }
  renderRelatorios();
}

let _relPeriodoAtivo = null; // 'mes:YYYY-MM' | 'range:from|to'

async function selecionarMesRelatorio(ym) {
  try {
    _relAtual = await fetch(`/api/relatorios/${ym}`).then(x => x.json());
    _relPeriodoAtivo = 'mes:' + ym;
    renderRelatorios();
  } catch (e) { toast('Erro: ' + (e.message || 'sem conexão'), 'error'); }
}

async function selecionarRangeRelatorio(periodo) {
  const hoje = new Date();
  const fmt = d => d.toISOString().substring(0, 10);
  let from, to = fmt(hoje);
  if (periodo === '7d') { const d = new Date(hoje); d.setDate(d.getDate() - 7); from = fmt(d); }
  else if (periodo === '30d') { const d = new Date(hoje); d.setDate(d.getDate() - 30); from = fmt(d); }
  else if (periodo === '90d') { const d = new Date(hoje); d.setDate(d.getDate() - 90); from = fmt(d); }
  else if (periodo === 'ano') { from = `${hoje.getFullYear()}-01-01`; }
  else return;
  try {
    const res = await fetch(`/api/relatorios/range?from=${from}&to=${to}`);
    if (!res.ok) { await toastErro(res, 'Erro'); return; }
    const j = await res.json();
    // Adapta o shape pra ser compatível com renderRelatorios (que espera ym, ymPrev, anterior)
    _relAtual = { ...j, ym: null, ymPrev: null, anterior: { entradas: 0, saidas: 0, deltaEntradas: 0, deltaSaidas: 0 } };
    _relPeriodoAtivo = 'range:' + periodo;
    renderRelatorios();
  } catch (e) { toast('Erro: ' + (e.message || 'sem conexão'), 'error'); }
}

const _rangeLabels = { '7d': '7 dias', '30d': '30 dias', '90d': '90 dias', 'ano': 'Este ano' };

function _labelMes(ym) {
  if (!ym) return '';
  const [a, m] = ym.split('-').map(Number);
  const nomes = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
  return `${nomes[m - 1]}/${String(a).slice(2)}`;
}

function renderRelatorios() {
  const painel = document.getElementById('painel-relatorios');
  if (!painel) return;
  const lista = _relLista;
  const r = _relAtual;
  if (!lista || !r) { painel.innerHTML = '<p style="color:var(--text-muted); font-size:13px;">Sem dados suficientes ainda.</p>'; return; }

  // Estilo helper pros chips
  const chipStyle = ativo => `background:${ativo ? 'rgba(91,124,250,0.2)' : 'rgba(255,255,255,0.05)'}; border:1px solid ${ativo ? 'rgba(91,124,250,0.4)' : 'rgba(255,255,255,0.1)'}; color:${ativo ? '#5b7cfa' : 'var(--text-secondary)'}; border-radius:6px; padding:4px 10px; font-size:11px; cursor:pointer; white-space:nowrap;`;

  // Chips de período custom (7d / 30d / 90d / ano)
  const chipsPeriodo = ['7d','30d','90d','ano'].map(p => {
    const ativo = _relPeriodoAtivo === 'range:' + p;
    return `<button onclick="selecionarRangeRelatorio('${p}')" style="${chipStyle(ativo)}">${_rangeLabels[p]}</button>`;
  }).join('');

  // Seletor de mês
  const seletor = lista.meses.map(m => {
    const ativo = _relPeriodoAtivo === 'mes:' + m.ym || (!_relPeriodoAtivo && m.ym === r.ym);
    return `<button onclick="selecionarMesRelatorio('${m.ym}')" style="${chipStyle(ativo)}">${_labelMes(m.ym)}</button>`;
  }).join('');

  // Delta
  const deltaSai = r.anterior.deltaSaidas;
  const deltaEnt = r.anterior.deltaEntradas;
  const setaSai = deltaSai > 0 ? '↑' : deltaSai < 0 ? '↓' : '·';
  const corSai = deltaSai > 0 ? '#f85149' : deltaSai < 0 ? '#3fb950' : 'var(--text-muted)';
  const setaEnt = deltaEnt > 0 ? '↑' : deltaEnt < 0 ? '↓' : '·';
  const corEnt = deltaEnt > 0 ? '#3fb950' : deltaEnt < 0 ? '#f85149' : 'var(--text-muted)';

  // Categorias
  const maxTot = Math.max(1, ...r.categorias.map(c => c.entradas + c.saidas));
  const catsHtml = r.categorias.length
    ? r.categorias.map(c => {
        const totalMov = c.entradas + c.saidas;
        const pct = (totalMov / maxTot) * 100;
        return `
          <div style="margin-bottom:8px;">
            <div style="display:flex; justify-content:space-between; font-size:12px; margin-bottom:4px;">
              <span>${escapeHtml(c.label)}</span>
              <span style="color:var(--text-muted); font-size:11px;">${c.entradas > 0 ? '<span style="color:#3fb950;">+'+formatBRL(c.entradas)+'</span> ' : ''}${c.saidas > 0 ? '<span style="color:#f85149;">−'+formatBRL(c.saidas)+'</span>' : ''}</span>
            </div>
            <div style="height:6px; background:rgba(255,255,255,0.06); border-radius:4px; overflow:hidden;">
              <div style="height:100%; width:${pct}%; background:#5b7cfa;"></div>
            </div>
          </div>`;
      }).join('')
    : '<p style="font-size:12px; color:var(--text-muted);">Sem movimentação neste mês.</p>';

  painel.innerHTML = `
    <div style="margin-bottom:16px;">
      <div style="font-size:12px; color:var(--text-muted); margin-bottom:8px;">Período:</div>
      <div style="display:flex; gap:6px; flex-wrap:wrap; margin-bottom:10px;">${chipsPeriodo}</div>
      <div style="font-size:12px; color:var(--text-muted); margin-bottom:8px;">Ou selecione um mês:</div>
      <div style="display:flex; gap:6px; flex-wrap:wrap;">${seletor}</div>
    </div>

    <!-- Resumo -->
    <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(140px, 1fr)); gap:12px; margin-bottom:16px;">
      <div style="background:var(--card-bg, #25262b); border:1px solid rgba(255,255,255,0.08); border-radius:12px; padding:14px;">
        <div style="font-size:11px; color:var(--text-muted); margin-bottom:4px;">Entradas</div>
        <div style="font-size:18px; font-weight:700; color:#3fb950;">${formatBRL(r.totais.entradas)}</div>
        ${r.anterior.entradas > 0 ? `<div style="font-size:11px; color:${corEnt}; margin-top:2px;">${setaEnt} ${formatBRL(Math.abs(deltaEnt))} vs mês anterior</div>` : ''}
      </div>
      <div style="background:var(--card-bg, #25262b); border:1px solid rgba(255,255,255,0.08); border-radius:12px; padding:14px;">
        <div style="font-size:11px; color:var(--text-muted); margin-bottom:4px;">Saídas</div>
        <div style="font-size:18px; font-weight:700; color:#f85149;">${formatBRL(r.totais.saidas)}</div>
        ${r.anterior.saidas > 0 ? `<div style="font-size:11px; color:${corSai}; margin-top:2px;">${setaSai} ${formatBRL(Math.abs(deltaSai))} vs mês anterior</div>` : ''}
      </div>
      <div style="background:var(--card-bg, #25262b); border:1px solid rgba(255,255,255,0.08); border-radius:12px; padding:14px;">
        <div style="font-size:11px; color:var(--text-muted); margin-bottom:4px;">Saldo</div>
        <div style="font-size:18px; font-weight:700; color:${r.totais.saldo >= 0 ? '#3fb950' : '#f85149'};">${formatBRL(r.totais.saldo)}</div>
        <div style="font-size:11px; color:var(--text-muted); margin-top:2px;">${r.totais.qtd} transação(ões)</div>
      </div>
    </div>

    <!-- PF vs PJ -->
    <div style="display:flex; gap:12px; margin-bottom:16px; flex-wrap:wrap;">
      <div style="flex:1; min-width:180px; background:var(--card-bg, #25262b); border:1px solid rgba(255,255,255,0.08); border-left:3px solid #5b7cfa; border-radius:12px; padding:14px;">
        <div style="font-size:12px; color:#5b7cfa; font-weight:600; margin-bottom:6px;">Pessoa Física</div>
        <div style="font-size:12px; padding:2px 0;">Entradas: <b style="color:#3fb950;">+${formatBRL(r.pf.entradas)}</b></div>
        <div style="font-size:12px; padding:2px 0;">Saídas: <b style="color:#f85149;">−${formatBRL(r.pf.saidas)}</b></div>
      </div>
      <div style="flex:1; min-width:180px; background:var(--card-bg, #25262b); border:1px solid rgba(255,255,255,0.08); border-left:3px solid #e8950c; border-radius:12px; padding:14px;">
        <div style="font-size:12px; color:#e8950c; font-weight:600; margin-bottom:6px;">Pessoa Jurídica (MEI)</div>
        <div style="font-size:12px; padding:2px 0;">Receitas: <b style="color:#3fb950;">+${formatBRL(r.pj.entradas)}</b></div>
        <div style="font-size:12px; padding:2px 0;">Despesas: <b style="color:#f85149;">−${formatBRL(r.pj.saidas)}</b></div>
      </div>
    </div>

    <!-- Categorias -->
    <div style="background:var(--card-bg, #25262b); border:1px solid rgba(255,255,255,0.08); border-radius:12px; padding:16px;">
      <h2 style="font-size:14px; margin:0 0 12px;">Movimentação por categoria</h2>
      ${catsHtml}
    </div>`;
}

// =====================
//  METAS FINANCEIRAS
// =====================
let _metasData = null;

async function carregarMetas() {
  const painel = document.getElementById('painel-metas');
  if (painel) painel.innerHTML = '<p style="color:var(--text-muted); font-size:13px;">Carregando...</p>';
  try {
    _metasData = await fetch('/api/metas').then(x => x.json());
  } catch (e) { _metasData = null; }
  renderMetas();
}

function renderMetas() {
  const painel = document.getElementById('painel-metas');
  if (!painel) return;
  const d = _metasData;
  if (!d) { painel.innerHTML = '<p style="color:var(--text-muted); font-size:13px;">Erro ao carregar.</p>'; return; }

  const b = d.base;
  const alerta = d.insuficiente
    ? `<div style="background:rgba(248,81,73,0.12); border:1px solid rgba(248,81,73,0.3); border-radius:8px; padding:10px 12px; font-size:12px; color:#f85149; margin-bottom:14px;">⚠️ No ritmo atual, você não consegue manter todas as metas com prazo. Considere alongar algum prazo ou reduzir o valor de alguma.</div>`
    : '';

  const painelBase = `
    <div style="background:var(--card-bg, #25262b); border:1px solid rgba(255,255,255,0.08); border-radius:12px; padding:16px; margin-bottom:16px;">
      <div style="font-size:12px; color:var(--text-muted); margin-bottom:10px;">Planejamento baseado nos últimos ${b.mesesAmostra} meses</div>
      <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(140px, 1fr)); gap:10px;">
        <div><div style="font-size:11px; color:var(--text-muted);">Renda média</div><div style="font-size:16px; font-weight:600;">${formatBRL(b.rendaMedia)}</div></div>
        <div><div style="font-size:11px; color:var(--text-muted);">Gasto médio</div><div style="font-size:16px; font-weight:600; color:#e8950c;">${formatBRL(b.gastoMedio)}</div></div>
        <div><div style="font-size:11px; color:var(--text-muted);">Sobra estimada</div><div style="font-size:16px; font-weight:700; color:#3fb950;">${formatBRL(b.sobraEstimada)}</div></div>
        <div><div style="font-size:11px; color:var(--text-muted);">Já comprometido em metas</div><div style="font-size:16px; font-weight:600;">${formatBRL(d.compromissosMensais)}</div></div>
        <div><div style="font-size:11px; color:var(--text-muted);">Livre pra metas s/ prazo</div><div style="font-size:16px; font-weight:600; color:${d.livre > 0 ? '#3fb950' : '#f85149'};">${formatBRL(d.livre)}</div></div>
      </div>
    </div>
    ${alerta}`;

  const cards = (d.metas || []).map(m => {
    const pct = m.pct || 0;
    const cor = m.concluida ? '#3fb950' : (pct >= 66 ? '#3fb950' : pct >= 33 ? '#e8950c' : '#5b7cfa');
    const prazoTxt = m.prazo
      ? `até ${new Date(m.prazo).toLocaleDateString('pt-BR', { day:'2-digit', month:'2-digit', year:'numeric' })}${m.mesesRest != null ? ` · ${m.mesesRest} mês(es)` : ''}`
      : (m.eta ? `sem prazo · ETA ${m.eta} mês(es)` : 'sem prazo');
    const mensalTxt = m.mensalNecessario != null && !m.concluida
      ? `<span style="color:var(--text-muted); font-size:12px;">Guarde <b style="color:var(--text);">${formatBRL(m.mensalNecessario)}/mês</b></span>`
      : '';
    const statusBadge = m.concluida
      ? '<span style="font-size:10px; background:rgba(63,185,80,0.2); color:#3fb950; padding:2px 8px; border-radius:6px;">concluída</span>'
      : '';
    return `
      <div style="background:var(--card-bg, #25262b); border:1px solid rgba(255,255,255,0.08); border-left:3px solid ${cor}; border-radius:12px; padding:14px; margin-bottom:10px;">
        <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:8px;">
          <div style="flex:1;">
            <div style="display:flex; align-items:center; gap:8px; margin-bottom:2px;">
              <span style="font-weight:600; font-size:14px;">${escapeHtml(m.nome)}</span>
              ${statusBadge}
            </div>
            <div style="font-size:11px; color:var(--text-muted);">${prazoTxt}</div>
          </div>
          <div style="text-align:right;">
            <div style="font-size:14px; font-weight:700;">${formatBRL(m.guardado)} <span style="color:var(--text-muted); font-weight:400; font-size:11px;">/ ${formatBRL(Number(m.valor_total))}</span></div>
            ${mensalTxt}
          </div>
        </div>
        <div style="height:8px; background:rgba(255,255,255,0.08); border-radius:6px; overflow:hidden; margin-bottom:8px;">
          <div style="height:100%; width:${pct}%; background:${cor};"></div>
        </div>
        <div style="display:flex; gap:6px;">
          <button onclick="depositarMeta(${m.id}, '${escapeHtml(m.nome).replace(/'/g, "\\'")}')" ${m.concluida ? 'disabled' : ''} style="flex:1; background:rgba(63,185,80,0.18); border:1px solid rgba(63,185,80,0.4); color:#3fb950; border-radius:6px; padding:6px; font-size:11px; cursor:pointer; ${m.concluida ? 'opacity:0.4; cursor:not-allowed;' : ''}">+ Guardar</button>
          <button onclick="editarMeta(${m.id})" style="background:rgba(255,255,255,0.05); border:1px solid rgba(255,255,255,0.15); color:var(--text-secondary); border-radius:6px; padding:6px 12px; font-size:11px; cursor:pointer;">Editar</button>
          <button onclick="removerMeta(${m.id}, '${escapeHtml(m.nome).replace(/'/g, "\\'")}')" style="background:rgba(248,81,73,0.12); border:1px solid rgba(248,81,73,0.3); color:#f85149; border-radius:6px; padding:6px 12px; font-size:11px; cursor:pointer;">Remover</button>
        </div>
      </div>`;
  }).join('');

  const listaHtml = d.metas.length
    ? cards
    : '<p style="color:var(--text-muted); font-size:13px; padding:20px 0;">Nenhuma meta ainda. Clique em "+ Nova meta" pra começar.</p>';

  painel.innerHTML = `
    ${painelBase}
    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
      <h2 style="font-size:15px; margin:0;">Suas metas</h2>
      <button onclick="novaMeta()" style="background:rgba(91,124,250,0.18); border:1px solid rgba(91,124,250,0.4); color:#5b7cfa; border-radius:6px; padding:6px 14px; font-size:12px; cursor:pointer;">+ Nova meta</button>
    </div>
    ${listaHtml}`;
}

async function novaMeta() {
  const r = await promptModal({
    titulo: 'Nova meta',
    campos: [
      { name: 'nome', label: 'O que você quer comprar/atingir', placeholder: 'Ex: Notebook novo' },
      { name: 'valor', label: 'Valor total estimado (R$)', tipo: 'number', placeholder: '0,00' },
      { name: 'prazo', label: 'Prazo desejado (opcional)', tipo: 'date' }
    ]
  });
  if (!r) return;
  const nome = (r.nome || '').trim();
  const valor = parseFloat(String(r.valor).replace(',', '.'));
  if (!nome) { toast('Informe o nome', 'error'); return; }
  if (isNaN(valor) || valor <= 0) { toast('Valor inválido', 'error'); return; }
  const body = { nome, valorTotal: valor };
  if (r.prazo) body.prazo = r.prazo;
  try {
    const res = await fetch('/api/metas', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!res.ok) { const e = await res.json(); toast(e.erro || 'Erro', 'error'); return; }
    toast('Meta criada', 'success');
    carregarMetas();
  } catch (e) { toast('Erro: ' + (e.message || 'sem conexão'), 'error'); }
}

async function depositarMeta(id, nome) {
  const r = await promptModal({
    titulo: `Guardar em: ${nome}`,
    campos: [{ name: 'valor', label: 'Quanto você guardou (R$)', tipo: 'number', placeholder: '0,00' }]
  });
  if (!r) return;
  const valor = parseFloat(String(r.valor).replace(',', '.'));
  if (isNaN(valor) || valor <= 0) { toast('Valor inválido', 'error'); return; }
  try {
    const res = await fetch(`/api/metas/${id}/depositos`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ valor }) });
    if (!res.ok) { await toastErro(res, 'Erro'); return; }
    toast(`+${formatBRL(valor)} guardado`, 'success');
    try { ganharXP(15); } catch (e) {}
    carregarMetas();
  } catch (e) { toast('Erro: ' + (e.message || 'sem conexão'), 'error'); }
}

async function editarMeta(id) {
  const meta = (_metasData.metas || []).find(m => m.id === id);
  if (!meta) return;
  const r = await promptModal({
    titulo: 'Editar meta',
    campos: [
      { name: 'nome', label: 'Nome', valor: meta.nome },
      { name: 'valor', label: 'Valor total (R$)', tipo: 'number', valor: Number(meta.valor_total).toFixed(2) },
      { name: 'prazo', label: 'Prazo (deixe vazio pra sem prazo)', tipo: 'date', valor: meta.prazo ? String(meta.prazo).substring(0,10) : '' }
    ]
  });
  if (!r) return;
  const body = {};
  if (r.nome) body.nome = r.nome.trim();
  const v = parseFloat(String(r.valor).replace(',', '.'));
  if (!isNaN(v) && v > 0) body.valorTotal = v;
  body.prazo = r.prazo || null;
  try {
    const res = await fetch(`/api/metas/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!res.ok) { await toastErro(res, 'Erro'); return; }
    toast('Meta atualizada', 'success');
    carregarMetas();
  } catch (e) { toast('Erro: ' + (e.message || 'sem conexão'), 'error'); }
}

async function removerMeta(id, nome) {
  if (!confirm(`Remover a meta "${nome}"? Todo o histórico de depósitos será apagado.`)) return;
  try {
    await fetch(`/api/metas/${id}`, { method: 'DELETE' });
    toast('Meta removida', 'success');
    carregarMetas();
  } catch (e) { toast('Erro: ' + (e.message || 'sem conexão'), 'error'); }
}

// =====================
//  APOSTAS (eu vs amigos)
// =====================
let _apostasData = null;

async function carregarApostas() {
  const painel = document.getElementById('painel-apostas');
  if (painel) painel.innerHTML = '<p style="color:var(--text-muted); font-size:13px;">Carregando...</p>';
  try {
    _apostasData = await fetch('/api/apostas').then(x => x.json());
  } catch (e) { _apostasData = null; }
  renderApostas();
}

function renderApostas() {
  const painel = document.getElementById('painel-apostas');
  if (!painel) return;
  const d = _apostasData;
  if (!d) { painel.innerHTML = '<p style="color:var(--text-muted); font-size:13px;">Erro ao carregar.</p>'; return; }

  // Resumo
  const resumo = `
    <div style="display:flex; gap:12px; margin-bottom:24px; flex-wrap:wrap;">
      <div style="flex:1; min-width:180px; background:var(--card-bg, #25262b); border:1px solid rgba(255,255,255,0.08); border-radius:12px; padding:16px;">
        <div style="font-size:12px; color:var(--text-muted); margin-bottom:8px;">Minhas apostas</div>
        <div style="display:flex; justify-content:space-between; font-size:12px; padding:2px 0;"><span>Apostado</span><span style="color:#f81d13;">−${formatBRL(d.minhas.apostado)}</span></div>
        <div style="display:flex; justify-content:space-between; font-size:12px; padding:2px 0;"><span>Ganho</span><span style="color:#31a24c;">+${formatBRL(d.minhas.ganho)}</span></div>
        <div style="display:flex; justify-content:space-between; font-size:14px; padding:6px 0 0; margin-top:4px; border-top:1px solid rgba(255,255,255,0.08); font-weight:700;"><span>Líquido</span><span style="color:${d.minhas.liquido >= 0 ? '#31a24c' : '#f81d13'};">${formatBRL(d.minhas.liquido)}</span></div>
      </div>
      <div style="flex:1; min-width:180px; background:var(--card-bg, #25262b); border:1px solid rgba(255,255,255,0.08); border-radius:12px; padding:16px;">
        <div style="font-size:12px; color:var(--text-muted); margin-bottom:8px;">A receber de amigos</div>
        <div style="font-size:22px; font-weight:700; color:#e8950c;">${formatBRL(d.totalReceber)}</div>
        <div style="font-size:11px; color:var(--text-muted); margin-top:4px;">${d.amigos.filter(a => a.status === 'pendente').length} amigo(s) com saldo em aberto</div>
      </div>
    </div>`;

  // Pendentes de classificação (separados por saída/entrada)
  function cardPend(p) {
    const dt = p.data ? new Date(p.data).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }) : '--';
    const s = p.tipo === 'entrada' ? '+' : '−';
    const nome = escapeHtml(limparDescricao(p.descricao).slice(0, 34)) || 'Aposta';
    return `
      <div style="background:var(--card-bg, #25262b); border:1px solid rgba(255,255,255,0.08); border-radius:10px; padding:10px 12px; margin-bottom:8px;">
        <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:8px;">
          <span style="font-size:13px; font-weight:500;">${nome}<br><span style="font-size:11px; color:var(--text-muted); font-weight:400;">${dt} · ${escapeHtml(p.banco || '')}</span></span>
          <span style="color:${p.tipo === 'entrada' ? '#31a24c' : '#f81d13'}; font-size:13px; white-space:nowrap;">${s}${formatBRL(Number(p.valor))}</span>
        </div>
        <div style="display:flex; gap:6px; margin-bottom:6px;">
          <button onclick="apostaClassificar('${p.id}','eu')" style="flex:1; background:rgba(91,124,250,0.18); border:1px solid rgba(91,124,250,0.4); color:#5b7cfa; border-radius:6px; padding:6px; font-size:11px; cursor:pointer;">Fui eu</button>
          <button onclick="apostaClassificarAmigo('${p.id}')" style="flex:1; background:rgba(232,149,12,0.18); border:1px solid rgba(232,149,12,0.4); color:#e8950c; border-radius:6px; padding:6px; font-size:11px; cursor:pointer;">De um amigo</button>
          <button onclick="abrirApostaConjunto('${p.id}', ${Number(p.valor)})" style="flex:1; background:rgba(255,255,255,0.05); border:1px solid rgba(255,255,255,0.15); color:var(--text-secondary); border-radius:6px; padding:6px; font-size:11px; cursor:pointer;">Em conjunto</button>
        </div>
        <button onclick="abrirNaoEhAposta('${p.id}')" style="width:100%; background:rgba(248,81,73,0.12); border:1px solid rgba(248,81,73,0.3); color:#f85149; border-radius:6px; padding:5px; font-size:11px; cursor:pointer;">Não é aposta</button>
      </div>`;
  }
  const pendSaidas = (d.pendentes || []).filter(p => p.tipo === 'saida');
  const pendEntradas = (d.pendentes || []).filter(p => p.tipo === 'entrada');
  let pendHtml;
  if (d.pendentes.length === 0) {
    pendHtml = '<p style="color:var(--text-muted); font-size:13px; margin-bottom:20px;">Nenhuma aposta pra classificar. 🎯</p>';
  } else {
    pendHtml = '<h2 style="font-size:15px; margin:0 0 4px;">Apostas pra classificar</h2><p style="font-size:12px; color:var(--text-muted); margin:0 0 12px;">Quem apostou? Em conjunto = parte sua + parte do amigo.</p>';
    if (pendSaidas.length) pendHtml += `<div style="font-size:12px; font-weight:600; color:#f81d13; margin:6px 0;">↓ Saídas — apostas feitas (${pendSaidas.length})</div>` + pendSaidas.map(cardPend).join('');
    if (pendEntradas.length) pendHtml += `<div style="font-size:12px; font-weight:600; color:#31a24c; margin:14px 0 6px;">↑ Entradas — recebido / ganho (${pendEntradas.length})</div>` + pendEntradas.map(cardPend).join('');
  }

  // Acerto de contas por amigo
  const amigosHtml = d.amigos.length
    ? d.amigos.map(a => {
        const cor = a.status === 'quitado' ? '#31a24c' : '#e8950c';
        return `
          <div style="background:var(--card-bg, #25262b); border:1px solid rgba(255,255,255,0.08); border-left:3px solid ${cor}; border-radius:10px; padding:12px; margin-bottom:8px;">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
              <span style="font-weight:600;">${escapeHtml(a.amigo)}</span>
              <span style="font-size:11px; background:${a.status === 'quitado' ? 'rgba(49,162,76,0.2)' : 'rgba(232,149,12,0.2)'}; color:${cor}; padding:2px 8px; border-radius:6px;">${a.status === 'quitado' ? 'quitado' : 'te deve ' + formatBRL(a.saldo)}</span>
            </div>
            <div style="font-size:11px; color:var(--text-muted); display:flex; gap:14px;">
              <span>Apostei por ele: ${formatBRL(a.apostado)}</span>
              <span>Já me pagou: ${formatBRL(a.recebido + a.pago)}</span>
            </div>
            <button onclick="registrarPagamentoAmigo('${escapeHtml(a.amigo).replace(/'/g, "\\'")}')" style="margin-top:8px; background:rgba(49,162,76,0.18); border:1px solid rgba(49,162,76,0.4); color:#31a24c; border-radius:6px; padding:4px 12px; font-size:11px; cursor:pointer;">Registrar pagamento</button>
          </div>`;
      }).join('')
    : '<p style="color:var(--text-muted); font-size:12px;">Nenhum amigo com apostas ainda.</p>';

  painel.innerHTML = `
    ${resumo}
    <div style="margin-bottom:24px;">${pendHtml}</div>
    <h2 style="font-size:15px; margin:0 0 12px;">Acerto de contas</h2>
    ${amigosHtml}`;
}

async function apostaClassificar(id, modo, extra) {
  try {
    const res = await fetch('/api/apostas/atribuir', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ transacaoId: id, modo, ...(extra || {}) })
    });
    if (!res.ok) { const d = await res.json(); toast(d.erro || 'Erro', 'error'); return; }
    carregarApostas();
  } catch (e) { toast('Erro: ' + (e.message || 'sem conexão'), 'error'); }
}

async function apostaClassificarAmigo(id) {
  const r = await promptModal({
    titulo: 'Aposta de um amigo',
    campos: [{ name: 'amigo', label: 'Nome do amigo (foi ele com o dinheiro dele)', placeholder: 'Ex: Erik' }]
  });
  if (!r) return;
  const n = (r.amigo || '').trim();
  if (!n) return;
  apostaClassificar(id, 'amigo', { amigo: n });
}

function abrirApostaConjunto(id, valorTotal) {
  const total = Number(valorTotal);
  const metade = (total / 2).toFixed(2);
  const modal = document.createElement('div');
  modal.id = 'conjunto-modal';
  modal.innerHTML = `
    <div id="conjunto-overlay" class="custom-modal" onclick="fecharApostaConjunto(event)">
      <div class="modal-content">
        <div class="modal-header">
          <h2>Aposta em conjunto</h2>
          <button class="modal-close" onclick="fecharApostaConjunto()">✕</button>
        </div>
        <div class="modal-body">
          <p style="font-size:12px; color:var(--text-muted); margin-bottom:14px;">Total da aposta: <b>${formatBRL(total)}</b></p>
          <div style="margin-bottom:12px;">
            <label style="font-size:13px; display:block; margin-bottom:4px;">Amigo que apostou junto</label>
            <input type="text" id="conj-amigo" placeholder="Nome do amigo" style="width:100%; background:rgba(255,255,255,0.05); border:1px solid rgba(255,255,255,0.1); color:var(--text); border-radius:6px; padding:8px; font-size:13px;">
          </div>
          <div style="margin-bottom:12px;">
            <label style="font-size:13px; display:block; margin-bottom:4px;">Minha parte (R$)</label>
            <input type="number" id="conj-minha" value="${metade}" step="0.01" oninput="_conjAtualiza(${total})" style="width:100%; background:rgba(255,255,255,0.05); border:1px solid rgba(255,255,255,0.1); color:var(--text); border-radius:6px; padding:8px; font-size:13px;">
          </div>
          <div style="font-size:13px; color:var(--text-muted);">Parte do amigo: <b id="conj-amigo-valor" style="color:var(--text);">${formatBRL(total / 2)}</b></div>
        </div>
        <div class="modal-footer">
          <button class="btn-secondary" onclick="fecharApostaConjunto()">Cancelar</button>
          <button class="btn-primary" onclick="salvarApostaConjunto('${id}', ${total})">Salvar</button>
        </div>
      </div>
    </div>`;
  document.body.appendChild(modal);
}

function _conjAtualiza(total) {
  const minha = parseFloat(document.getElementById('conj-minha').value) || 0;
  const amigo = Math.max(total - minha, 0);
  const el = document.getElementById('conj-amigo-valor');
  if (el) el.textContent = formatBRL(amigo);
}

function salvarApostaConjunto(id, total) {
  const amigo = (document.getElementById('conj-amigo').value || '').trim();
  const minha = parseFloat(document.getElementById('conj-minha').value);
  if (!amigo) { toast('Informe o nome do amigo', 'error'); return; }
  if (isNaN(minha) || minha < 0 || minha > total) { toast('Minha parte inválida', 'error'); return; }
  const valorAmigo = Math.round((total - minha) * 100) / 100;
  fecharApostaConjunto();
  apostaClassificar(id, 'conjunto', { amigo, valorAmigo });
}

function fecharApostaConjunto(e) {
  if (e && e.target.id !== 'conjunto-overlay') return;
  const m = document.getElementById('conjunto-modal');
  if (m) m.remove();
}

function abrirNaoEhAposta(id) {
  const modal = document.createElement('div');
  modal.id = 'nao-aposta-modal';
  modal.innerHTML = `
    <div id="nao-aposta-overlay" class="custom-modal" onclick="fecharNaoEhAposta(event)">
      <div class="modal-content">
        <div class="modal-header">
          <h2>Recategorizar transação</h2>
          <button class="modal-close" onclick="fecharNaoEhAposta()">✕</button>
        </div>
        <div class="modal-body">
          <p style="font-size:12px; color:var(--text-muted); margin-bottom:14px;">Essa transação não é aposta. Escolha a categoria correta — se houver uma regra aprendida errada, ela também será removida.</p>
          <div style="display:flex; gap:8px;">
            ${_catAutocompleteHtml('nao-aposta-cat', 'outros')}
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn-secondary" onclick="fecharNaoEhAposta()">Cancelar</button>
          <button class="btn-primary" onclick="salvarNaoEhAposta('${id}')">Recategorizar</button>
        </div>
      </div>
    </div>`;
  document.body.appendChild(modal);
}

async function salvarNaoEhAposta(id) {
  const el = document.getElementById('nao-aposta-cat');
  if (!el) return;
  const novaCategoria = await _catResolver(el.value);
  if (!novaCategoria) return;
  try {
    const res = await fetch('/api/apostas/desvincular', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ transacaoId: id, novaCategoria })
    });
    const d = await res.json();
    if (!res.ok) { toast(d.erro || 'Erro', 'error'); return; }
    fecharNaoEhAposta();
    toast(d.regraRemovida ? 'Recategorizado (regra errada removida)' : 'Recategorizado', 'success');
    carregarApostas();
  } catch (e) { toast('Erro: ' + (e.message || 'sem conexão'), 'error'); }
}

function fecharNaoEhAposta(e) {
  if (e && e.target.id !== 'nao-aposta-overlay') return;
  const m = document.getElementById('nao-aposta-modal');
  if (m) m.remove();
}

async function registrarPagamentoAmigo(amigo) {
  const r = await promptModal({
    titulo: `Pagamento de ${amigo}`,
    campos: [{ name: 'valor', label: 'Valor pago (R$)', tipo: 'number', placeholder: '0,00' }]
  });
  if (!r) return;
  const valor = parseFloat(String(r.valor).replace(',', '.'));
  if (isNaN(valor) || valor <= 0) { toast('Valor inválido', 'error'); return; }
  try {
    await fetch('/api/apostas/pagamento', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amigo, valor })
    });
    toast('Pagamento registrado', 'success');
    carregarApostas();
  } catch (e) { toast('Erro: ' + (e.message || 'sem conexão'), 'error'); }
}

// =====================
//  ALERTAS DE GASTO INCOMUM
// =====================
const LABELS_CAT_ALERTA = {
  alimentacao: 'Alimentação', transporte: 'Transporte', moradia: 'Moradia',
  lazer: 'Lazer', apostas: 'Apostas', saude: 'Saúde', educacao: 'Educação',
  compras: 'Compras', assinaturas: 'Assinaturas', contas_fixas: 'Contas fixas', outros: 'Outros'
};

async function carregarAlertas() {
  let alertas = [];
  try {
    const r = await fetch('/api/financeiro/alertas').then(x => x.json());
    alertas = r.alertas || [];
  } catch (e) { return; }
  if (alertas.length === 0) return;
  // Notifica 1x por dia
  const hoje = hojeLocal();
  if (estadoGet('ultimoAlertaData') === hoje) return;
  estadoSet('ultimoAlertaData', hoje);
  alertas.slice(0, 3).forEach((a, i) => {
    const label = LABELS_CAT_ALERTA[a.categoria] || a.categoria;
    setTimeout(() => toast(`⚠️ ${label}: R$ ${a.atual.toFixed(2)} este mês — ${a.acima}% acima da média`, 'info'), 1500 + i * 800);
  });
}

// =====================
//  CATEGORIZAÇÃO COM APRENDIZADO
// =====================
let _catLista = [];
let _catPendentes = [];
let _catRegras = [];

async function carregarCategorizar() {
  const painel = document.getElementById('painel-categorizar');
  if (painel) painel.innerHTML = '<p style="color:var(--text-muted); font-size:13px;">Carregando...</p>';
  try {
    const [l, p, r] = await Promise.all([
      fetch('/api/categorias/lista').then(x => x.json()),
      fetch('/api/categorias/pendentes').then(x => x.json()),
      fetch('/api/categorias/regras').then(x => x.json())
    ]);
    _catLista = l.categorias || [];
    _catPendentes = p.pendentes || [];
    _catRegras = r.regras || [];
  } catch (e) { _catPendentes = []; _catRegras = []; }
  renderCategorizar();
  atualizarBadgePendentes(_catPendentes.length);
}

function _catLabel(id) {
  const c = _catLista.find(x => x.id === id);
  return c ? c.label : id;
}

// Limpa códigos/números da descrição pra exibir só o nome legível
function limparDescricao(s) {
  return String(s || '')
    .replace(/\|/g, ' · ')
    .replace(/\bCp\s*:?\s*\d+\s*-?\s*/gi, '')   // "Cp :09089356-"
    .replace(/\b\d{4,}\b/g, '')                  // códigos longos
    .replace(/\s{2,}/g, ' ')
    .trim()
    .replace(/^[-·\s]+|[-·\s]+$/g, '')
    .replace(/-\s*·/g, '·')
    .trim() || 'Transação';
}
function _catOptions(sel) {
  return _catLista.map(c => `<option value="${c.id}" ${c.id === sel ? 'selected' : ''}>${c.label}</option>`).join('');
}

// Autocomplete de categoria: input com datalist. Retorna { id } quando confirmado.
// Se digitar um label que ainda não existe, chama /lista pra criar (com deduplicação).
function _catAutocompleteHtml(inputId, sel) {
  const listId = inputId + '-list';
  const label = sel && _catLista.find(c => c.id === sel);
  const valor = label ? label.label : '';
  const opts = _catLista.map(c => `<option value="${c.label}"></option>`).join('');
  return `
    <input type="text" id="${inputId}" list="${listId}" value="${escapeHtml(valor)}"
      placeholder="Digite ou escolha uma categoria"
      style="flex:1; background:rgba(255,255,255,0.05); border:1px solid rgba(255,255,255,0.1); color:var(--text); border-radius:6px; padding:6px 8px; font-size:12px;">
    <datalist id="${listId}">${opts}</datalist>`;
}

// Resolve o texto do input pra um id de categoria (existente ou criando nova).
// Retorna null se cancelado por causa de duplicata (usuário decide).
async function _catResolver(labelDigitado) {
  const digitado = String(labelDigitado || '').trim();
  if (!digitado) return null;
  // 1) casa por label (case-insensitive/sem acento)
  const norm = digitado.toLowerCase().normalize('NFD').replace(/[^a-z0-9]/g, '');
  const igual = _catLista.find(c => c.id === norm);
  if (igual) return igual.id;
  const igualLabel = _catLista.find(c => c.label.toLowerCase() === digitado.toLowerCase());
  if (igualLabel) return igualLabel.id;
  // 2) tenta criar (backend detecta similares)
  const res = await fetch('/api/categorias/lista', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ label: digitado })
  });
  const data = await res.json();
  if (data.ok) {
    if (data.criada || data.existente) {
      await carregarCatListaForcado();
      return data.categoria.id;
    }
  }
  if (Array.isArray(data.similares) && data.similares.length) {
    const nomes = data.similares.map(s => s.label).join(', ');
    const msg = `Já existe categoria parecida: "${nomes}".\n\nClique OK pra usar a existente "${data.similares[0].label}", ou Cancelar pra criar "${digitado}" mesmo assim.`;
    if (confirm(msg)) return data.similares[0].id;
    // Força criação
    const res2 = await fetch('/api/categorias/lista', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ label: digitado, forcar: true })
    });
    const d2 = await res2.json();
    if (d2.ok) { await carregarCatListaForcado(); return d2.categoria.id; }
  }
  toast('Não foi possível resolver a categoria', 'error');
  return null;
}

async function carregarCatListaForcado() {
  const l = await fetch('/api/categorias/lista').then(x => x.json()).catch(() => ({ categorias: [] }));
  _catLista = l.categorias || [];
}

// =====================
//  PROMPT MODAL (Electron bloqueia prompt() nativo — este é o substituto)
// =====================
// Uso: const r = await promptModal({ titulo, campos: [{ name, label, tipo:'text|number', valor, placeholder }] })
// Retorna null se cancelado, ou { name: valor } se salvo.
function promptModal({ titulo, campos, submitLabel = 'Salvar' }) {
  return new Promise(resolve => {
    const id = 'pm-' + Math.random().toString(36).slice(2, 8);
    const camposHtml = campos.map(c => `
      <div style="margin-bottom:12px;">
        <label style="font-size:13px; display:block; margin-bottom:4px;">${escapeHtml(c.label || c.name)}</label>
        <input id="${id}-${c.name}" type="${c.tipo || 'text'}" ${c.tipo === 'number' ? 'step="0.01"' : ''}
          value="${escapeHtml(c.valor == null ? '' : String(c.valor))}"
          placeholder="${escapeHtml(c.placeholder || '')}"
          style="width:100%; background:rgba(255,255,255,0.05); border:1px solid rgba(255,255,255,0.1); color:var(--text); border-radius:6px; padding:8px; font-size:13px;">
      </div>`).join('');
    const modal = document.createElement('div');
    modal.id = id;
    modal.innerHTML = `
      <div id="${id}-overlay" class="custom-modal">
        <div class="modal-content">
          <div class="modal-header">
            <h2>${escapeHtml(titulo || '')}</h2>
            <button class="modal-close" data-pm-close>✕</button>
          </div>
          <div class="modal-body">${camposHtml}</div>
          <div class="modal-footer">
            <button class="btn-secondary" data-pm-close>Cancelar</button>
            <button class="btn-primary" data-pm-save>${escapeHtml(submitLabel)}</button>
          </div>
        </div>
      </div>`;
    document.body.appendChild(modal);

    const finalizar = (result) => { modal.remove(); resolve(result); };
    modal.querySelectorAll('[data-pm-close]').forEach(b => b.onclick = () => finalizar(null));
    modal.querySelector(`#${id}-overlay`).onclick = (e) => { if (e.target.id === `${id}-overlay`) finalizar(null); };
    modal.querySelector('[data-pm-save]').onclick = () => {
      const out = {};
      for (const c of campos) {
        const el = document.getElementById(`${id}-${c.name}`);
        out[c.name] = el ? el.value : '';
      }
      finalizar(out);
    };
    // Foco no primeiro campo
    setTimeout(() => {
      const first = document.getElementById(`${id}-${campos[0] && campos[0].name}`);
      if (first) { first.focus(); first.select && first.select(); }
    }, 50);
  });
}

function atualizarBadgePendentes(n) {
  const b = document.getElementById('badge-pendentes');
  if (!b) return;
  if (n > 0) { b.textContent = n; b.style.display = 'inline-block'; }
  else b.style.display = 'none';
}

async function atualizarBadgeCategorizar() {
  try {
    const p = await fetch('/api/categorias/pendentes').then(x => x.json());
    atualizarBadgePendentes((p.pendentes || []).length);
  } catch (e) { /* silencioso */ }
}

function renderCategorizar() {
  const painel = document.getElementById('painel-categorizar');
  if (!painel) return;

  const filaHtml = _catPendentes.length === 0
    ? '<p style="color:var(--text-muted); font-size:13px;">Tudo categorizado! 🎉 Nada pendente.</p>'
    : _catPendentes.map(p => {
        const simbolo = p.tipo === 'entrada' ? '+' : '−';
        const sug = p.sugestao && _catLista.find(c => c.id === p.sugestao) ? p.sugestao : 'outros';
        const txs = p.transacoes || [];
        const maxShow = 12;
        const txHtml = txs.slice(0, maxShow).map(t => {
          const dt = t.data ? new Date(t.data).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' }) : '--';
          const s = t.tipo === 'entrada' ? '+' : '−';
          const badgePessoa = t.pessoa === 'PJ' ? ' <span style="color:#e8950c;">PJ</span>' : '';
          return `<div style="display:flex; justify-content:space-between; font-size:11px; color:var(--text-muted); padding:2px 0;">
            <span>${dt} · ${escapeHtml(t.banco || 'Conta')}${badgePessoa}</span>
            <span>${s}${formatBRL(t.valor)}</span>
          </div>`;
        }).join('');
        const maisTxt = txs.length > maxShow ? `<div style="font-size:11px; color:var(--text-muted); padding-top:2px;">+ ${txs.length - maxShow} outra(s)</div>` : '';
        return `
          <div style="background:var(--card-bg, #25262b); border:1px solid rgba(255,255,255,0.08); border-radius:10px; padding:12px; margin-bottom:8px;">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
              <span style="font-size:13px; flex:1; font-weight:500;">${escapeHtml(limparDescricao(p.exemplo).slice(0, 44))}</span>
              <span style="font-size:12px; color:var(--text-muted); white-space:nowrap;">${p.qtd}x · ${simbolo}${formatBRL(Number(p.total))}</span>
            </div>
            <div style="background:rgba(255,255,255,0.02); border-radius:6px; padding:6px 10px; margin-bottom:8px;">${txHtml}${maisTxt}</div>
            <div style="display:flex; gap:8px;">
              ${_catAutocompleteHtml(`cat-sel-${p.chave}`, sug)}
              <button onclick="aplicarCategoria('${p.chave}', ${JSON.stringify(p.exemplo || '').replace(/"/g, '&quot;')})" style="background:rgba(49,162,76,0.18); border:1px solid rgba(49,162,76,0.4); color:#31a24c; border-radius:6px; padding:6px 14px; font-size:12px; cursor:pointer;">Aplicar</button>
            </div>
          </div>`;
      }).join('');

  const regrasHtml = _catRegras.length === 0
    ? '<p style="color:var(--text-muted); font-size:12px;">Nenhuma regra aprendida ainda.</p>'
    : _catRegras.map(r => `
        <div style="display:flex; align-items:center; gap:8px; padding:7px 10px; background:rgba(255,255,255,0.03); border-radius:8px; margin-bottom:6px;">
          <span style="flex:1; font-size:12px;">${escapeHtml(limparDescricao(r.exemplo || r.chave).slice(0, 36))}</span>
          ${_catAutocompleteHtml(`regra-sel-${r.chave}`, r.categoria).replace('style="flex:1;', 'style="flex:0 0 160px;')}
          <button onclick="salvarEdicaoRegra('${r.chave}')" style="background:rgba(91,124,250,0.18); border:1px solid rgba(91,124,250,0.4); color:#5b7cfa; border-radius:6px; padding:3px 10px; font-size:11px; cursor:pointer;">Salvar</button>
          <span onclick="removerRegra('${r.chave}')" style="cursor:pointer; color:#f81d13; font-size:13px;">✕</span>
        </div>`).join('');

  painel.innerHTML = `
    <div style="margin-bottom:24px;">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
        <h2 style="font-size:15px; margin:0;">Pra categorizar</h2>
        <span style="font-size:11px; color:var(--text-muted);">${_catPendentes.length} estabelecimento(s) · ordenados por valor</span>
      </div>
      <p style="font-size:12px; color:var(--text-muted); margin:0 0 12px;">Categorize uma vez e o app aprende — as próximas transações do mesmo lugar entram sozinhas.</p>
      ${filaHtml}
    </div>
    <div>
      <h2 style="font-size:15px; margin:0 0 12px;">Regras aprendidas (${_catRegras.length})</h2>
      ${regrasHtml}
    </div>`;
}

async function aplicarCategoria(chave, exemplo) {
  const el = document.getElementById(`cat-sel-${chave}`);
  if (!el) return;
  const categoria = await _catResolver(el.value);
  if (!categoria) return;
  try {
    const res = await fetch('/api/categorias/aprender', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chave, categoria, exemplo })
    });
    const d = await res.json();
    if (!res.ok) { toast(d.erro || 'Erro', 'error'); return; }
    toast(`Categorizado (${d.aplicadas} transações)`, 'success');
    carregarCategorizar();
  } catch (e) { toast('Erro ao categorizar: ' + (e.message || 'sem conexão'), 'error'); }
}

async function salvarEdicaoRegra(chave) {
  const el = document.getElementById(`regra-sel-${chave}`);
  if (!el) return;
  const categoria = await _catResolver(el.value);
  if (!categoria) return;
  try {
    const res = await fetch(`/api/categorias/regras/${encodeURIComponent(chave)}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ categoria })
    });
    const d = await res.json();
    if (!res.ok) { toast(d.erro || 'Erro', 'error'); return; }
    toast('Regra atualizada', 'success');
    carregarCategorizar();
  } catch (e) { toast('Erro: ' + (e.message || 'sem conexão'), 'error'); }
}

async function removerRegra(chave) {
  if (!confirm('Remover esta regra? As transações voltam pra fila de categorização.')) return;
  try {
    await fetch(`/api/categorias/regras/${chave}`, { method: 'DELETE' });
    toast('Regra removida', 'success');
    carregarCategorizar();
  } catch (e) { toast('Erro: ' + (e.message || 'sem conexão'), 'error'); }
}

// =====================
//  ORÇAMENTOS POR CATEGORIA
// =====================
async function carregarCatLista() {
  if (_catLista.length) return;
  try {
    const l = await fetch('/api/categorias/lista').then(x => x.json());
    _catLista = l.categorias || [];
  } catch (e) { /* silencioso */ }
}

function getOrcamentosCat() {
  try { return JSON.parse(estadoGet('orcamentosCat') || '{}'); }
  catch (e) { return {}; }
}

async function renderOrcamentosCategorias() {
  const painel = document.getElementById('painel-orcamentos-cat');
  if (!painel) return;
  await carregarCatLista();
  const limites = getOrcamentosCat();

  const agora = new Date();
  const mes = `${agora.getFullYear()}-${String(agora.getMonth() + 1).padStart(2, '0')}`;
  const gasto = {};
  (allTransactions || []).forEach(t => {
    if (t.tipo === 'saida' && (t.data || '').substring(0, 7) === mes) {
      gasto[t.categoria] = (gasto[t.categoria] || 0) + parseFloat(t.valor);
    }
  });

  const comLimite = _catLista.filter(c => limites[c.id] > 0);
  let barras;
  if (comLimite.length === 0) {
    barras = '<p style="font-size:12px; color:var(--text-muted);">Nenhum limite definido ainda. Clique em Configurar pra definir um teto mensal por categoria.</p>';
  } else {
    barras = comLimite.map(c => {
      const lim = limites[c.id];
      const g = gasto[c.id] || 0;
      const pct = (g / lim) * 100;
      const cor = pct >= 100 ? '#f81d13' : pct >= 80 ? '#e8950c' : '#31a24c';
      return `
        <div style="margin-bottom:12px;">
          <div style="display:flex; justify-content:space-between; font-size:12px; margin-bottom:4px;">
            <span>${c.label}</span>
            <span style="color:var(--text-muted);">${formatBRL(g)} / ${formatBRL(lim)}</span>
          </div>
          <div style="height:8px; background:rgba(255,255,255,0.08); border-radius:6px; overflow:hidden;">
            <div style="height:100%; width:${Math.min(pct, 100)}%; background:${cor};"></div>
          </div>
          ${pct >= 80 ? `<div style="font-size:11px; color:${cor}; margin-top:3px;">${pct >= 100 ? 'Estourou o limite!' : 'Atenção: ' + Math.round(pct) + '% do limite'}</div>` : ''}
        </div>`;
    }).join('');
  }

  painel.innerHTML = `
    <div style="background:var(--card-bg, #25262b); border:1px solid rgba(255,255,255,0.08); border-radius:12px; padding:16px;">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
        <span style="font-size:12px; color:var(--text-muted);">Teto mensal por categoria (mês atual)</span>
        <button onclick="abrirConfigOrcamentosCat()" style="background:rgba(91,124,250,0.18); border:1px solid rgba(91,124,250,0.4); color:#5b7cfa; border-radius:6px; padding:4px 12px; font-size:12px; cursor:pointer;">Configurar</button>
      </div>
      ${barras}
    </div>`;
}

function abrirConfigOrcamentosCat() {
  const limites = getOrcamentosCat();
  const inputs = _catLista.map(c => `
    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
      <label style="font-size:13px;">${c.label}</label>
      <input type="number" id="orc-${c.id}" value="${limites[c.id] || ''}" placeholder="sem limite" step="0.01" style="width:130px; background:rgba(255,255,255,0.05); border:1px solid rgba(255,255,255,0.1); color:var(--text); border-radius:6px; padding:6px; font-size:13px;">
    </div>`).join('');
  const modal = document.createElement('div');
  modal.id = 'orc-cat-modal';
  modal.innerHTML = `
    <div id="orc-cat-overlay" class="custom-modal" onclick="fecharConfigOrcamentosCat(event)">
      <div class="modal-content">
        <div class="modal-header">
          <h2>Orçamentos por categoria</h2>
          <button class="modal-close" onclick="fecharConfigOrcamentosCat()">✕</button>
        </div>
        <div class="modal-body">
          <p style="font-size:12px; color:var(--text-muted); margin-bottom:14px;">Defina um teto mensal (deixe em branco pra sem limite).</p>
          ${inputs}
        </div>
        <div class="modal-footer">
          <button class="btn-secondary" onclick="fecharConfigOrcamentosCat()">Cancelar</button>
          <button class="btn-primary" onclick="salvarConfigOrcamentosCat()">Salvar</button>
        </div>
      </div>
    </div>`;
  document.body.appendChild(modal);
}

function salvarConfigOrcamentosCat() {
  const novo = {};
  _catLista.forEach(c => {
    const el = document.getElementById('orc-' + c.id);
    if (el && el.value && parseFloat(el.value) > 0) novo[c.id] = parseFloat(el.value);
  });
  estadoSet('orcamentosCat', JSON.stringify(novo));
  toast('Orçamentos salvos', 'success');
  fecharConfigOrcamentosCat();
  renderOrcamentosCategorias();
}

function fecharConfigOrcamentosCat(e) {
  if (e && e.target.id !== 'orc-cat-overlay') return;
  const m = document.getElementById('orc-cat-modal');
  if (m) m.remove();
}

// =====================
//  MULTI-CONTA (PF / PJ)
// =====================
let _contasData = null;

async function carregarContas() {
  const painel = document.getElementById('painel-contas');
  if (painel) painel.innerHTML = '<p style="color:var(--text-muted); font-size:13px;">Carregando...</p>';
  try {
    const [contasResp, statusResp] = await Promise.all([
      fetch('/api/openfinance/contas'),
      fetch('/api/openfinance/items-status').catch(() => null)
    ]);
    _contasData = await contasResp.json();
    if (statusResp && statusResp.ok) {
      const s = await statusResp.json();
      const statusMap = {};
      (s.items || []).forEach(i => { statusMap[i.item_id] = i; });
      (_contasData.contas || []).forEach(c => { c._sync = statusMap[c.item_id]; });
    }
  } catch (e) {
    _contasData = { contas: [], consolidado: null };
  }
  renderContas();
}

function _chipStatusSync(sync) {
  if (!sync) return '';
  const h = sync.horas_desde_sync;
  let cor, texto;
  if (sync.auto_sync) { cor = '#31a24c'; texto = 'auto'; }
  else if (h === null || h === undefined) { cor = '#6e6e78'; texto = 'nunca'; }
  else if (h < 24) { cor = '#31a24c'; texto = `há ${h}h`; }
  else if (h < 48) { cor = '#e8950c'; texto = `há ${Math.floor(h/24)}d`; }
  else { cor = '#f81d13'; texto = `há ${Math.floor(h/24)}d`; }
  return `<span title="${sync.ultima_sync || 'sem data'}" style="font-size:10px; background:${cor}22; color:${cor}; padding:2px 8px; border-radius:6px;">Sync ${texto}</span>`;
}

async function reconectarConta(itemId) {
  try {
    if (typeof PluggyConnect !== 'function') {
      toast('Widget do Pluggy não carregou. Recarrega a página.', 'error');
      return;
    }
    const r = await fetch('/api/openfinance/connect-token', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ itemId })
    });
    const d = await r.json();
    if (!r.ok || !d.accessToken) return toastErro(r, 'Falha ao gerar token de reconexão');
    const conn = new PluggyConnect({
      connectToken: d.accessToken,
      includeSandbox: false,
      onSuccess: async () => {
        toast('Reconectado — sincronizando…', 'success');
        try { await fetch('/api/openfinance/sync', { method: 'POST', headers: { 'Content-Type':'application/json' }, body: JSON.stringify({ itemId }) }); } catch (e) {}
        carregarContas();
      },
      onError: (err) => { console.error('[Pluggy]', err); toast('Erro na reconexão', 'error'); }
    });
    conn.init();
  } catch (e) {
    toast('Erro: ' + e.message, 'error');
  }
}

function _blocoConsolidado(titulo, d, cor) {
  const liquido = d.saldoBanco - d.saldoCredito;
  return `
    <div style="flex:1; background:var(--card-bg, #25262b); border:1px solid rgba(255,255,255,0.08); border-left:3px solid ${cor}; border-radius:12px; padding:16px;">
      <div style="font-size:13px; font-weight:700; color:${cor}; margin-bottom:10px;">${titulo}</div>
      <div style="display:flex; justify-content:space-between; font-size:12px; padding:3px 0;"><span style="color:var(--text-muted);">Em conta</span><span style="font-weight:600;">${formatBRL(d.saldoBanco)}</span></div>
      <div style="display:flex; justify-content:space-between; font-size:12px; padding:3px 0;"><span style="color:var(--text-muted);">Faturas cartão</span><span style="color:#f5a623;">−${formatBRL(d.saldoCredito)}</span></div>
      <div style="display:flex; justify-content:space-between; font-size:13px; padding:6px 0 3px; margin-top:4px; border-top:1px solid rgba(255,255,255,0.08);"><span>Líquido</span><span style="font-weight:700; color:${liquido >= 0 ? '#31a24c' : '#f81d13'};">${formatBRL(liquido)}</span></div>
      <div style="display:flex; justify-content:space-between; font-size:11px; padding:6px 0 0; color:var(--text-muted);"><span>Mês: +${formatBRL(d.entradasMes)}</span><span>−${formatBRL(d.saidasMes)}</span></div>
    </div>`;
}

function renderContas() {
  const painel = document.getElementById('painel-contas');
  if (!painel) return;
  const dados = _contasData;
  if (!dados || !dados.contas || dados.contas.length === 0) {
    painel.innerHTML = '<p style="color:var(--text-muted); font-size:13px;">Nenhum banco conectado ainda. Conecte na aba Visão Geral.</p>';
    return;
  }

  const c = dados.consolidado;
  const consolidadoHtml = `
    <h2 style="font-size:15px; margin:0 0 12px;">Consolidado</h2>
    <div style="display:flex; gap:12px; margin-bottom:24px; flex-wrap:wrap;">
      ${_blocoConsolidado('👤 Pessoa Física', c.PF, '#5b7cfa')}
      ${_blocoConsolidado('🏢 Pessoa Jurídica (MEI)', c.PJ, '#e8950c')}
    </div>`;

  const bancosHtml = dados.contas.map(b => {
    const ehPJ = b.pessoa === 'PJ';
    const badge = ehPJ
      ? '<span style="font-size:10px; background:rgba(232,149,12,0.2); color:#e8950c; padding:2px 8px; border-radius:6px;">PJ · MEI</span>'
      : '<span style="font-size:10px; background:rgba(91,124,250,0.2); color:#5b7cfa; padding:2px 8px; border-radius:6px;">PF</span>';
    const accountsHtml = b.accounts.map(a => `
      <div style="display:flex; justify-content:space-between; font-size:12px; padding:4px 0; color:var(--text-secondary);">
        <span>${a.tipo === 'CREDIT' ? 'Cartão' : 'Conta'} · ${escapeHtml(a.nome || '')}</span>
        <span style="color:${a.tipo === 'CREDIT' ? '#f5a623' : 'var(--text)'};">${a.tipo === 'CREDIT' ? '−' : ''}${formatBRL(Math.abs(Number(a.saldo)))}</span>
      </div>`).join('');
    const chipSync = _chipStatusSync(b._sync);
    const btnReconectar = (b._sync && b._sync.precisa_reconectar)
      ? `<button onclick="reconectarConta('${b.item_id}')" style="background:rgba(248,81,73,0.15); border:1px solid rgba(248,81,73,0.3); color:#f85149; border-radius:6px; padding:3px 10px; font-size:11px; cursor:pointer;">🔄 reconectar</button>`
      : '';
    return `
      <div style="background:var(--card-bg, #25262b); border:1px solid rgba(255,255,255,0.08); border-radius:12px; padding:16px; margin-bottom:12px;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px; flex-wrap:wrap; gap:8px;">
          <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
            <span style="font-weight:600; font-size:15px;">${escapeHtml(b.apelido)}</span>
            ${badge}
            ${chipSync}
          </div>
          <div style="display:flex; gap:6px; flex-wrap:wrap;">
            ${btnReconectar}
            <button onclick="definirPessoaConta('${b.item_id}','${ehPJ ? 'PF' : 'PJ'}')" style="background:rgba(255,255,255,0.05); border:1px solid rgba(255,255,255,0.1); color:var(--text-secondary); border-radius:6px; padding:3px 10px; font-size:11px; cursor:pointer;">marcar como ${ehPJ ? 'PF' : 'PJ'}</button>
            <button onclick="renomearConta('${b.item_id}')" style="background:rgba(255,255,255,0.05); border:1px solid rgba(255,255,255,0.1); color:var(--text-secondary); border-radius:6px; padding:3px 10px; font-size:11px; cursor:pointer;">renomear</button>
          </div>
        </div>
        ${accountsHtml}
        <div style="display:flex; justify-content:space-between; font-size:11px; margin-top:8px; padding-top:8px; border-top:1px solid rgba(255,255,255,0.08); color:var(--text-muted);">
          <span>Este mês: +${formatBRL(b.entradasMes)} / −${formatBRL(b.saidasMes)}</span>
          <span>Líquido: ${formatBRL(b.saldoBanco - b.saldoCredito)}</span>
        </div>
      </div>`;
  }).join('');

  painel.innerHTML = `
    ${consolidadoHtml}
    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
      <h2 style="font-size:15px; margin:0;">Suas contas</h2>
      <span style="font-size:11px; color:var(--text-muted);">Marque cada banco como PF ou PJ pra separar suas finanças do MEI</span>
    </div>
    ${bancosHtml}`;
}

async function definirPessoaConta(itemId, pessoa) {
  try {
    await fetch(`/api/openfinance/contas/${itemId}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pessoa })
    });
    toast(`Marcado como ${pessoa}`, 'success');
    carregarContas();
  } catch (e) { toast('Erro ao salvar: ' + (e.message || 'sem conexão'), 'error'); }
}

async function renomearConta(itemId) {
  const r = await promptModal({
    titulo: 'Renomear banco',
    campos: [{ name: 'apelido', label: 'Novo nome (ex: Nubank, Inter, Inter Empresas)' }]
  });
  if (!r) return;
  const nome = (r.apelido || '').trim();
  if (!nome) return;
  try {
    await fetch(`/api/openfinance/contas/${itemId}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apelido: nome })
    });
    toast('Renomeado', 'success');
    carregarContas();
  } catch (e) { toast('Erro ao renomear: ' + (e.message || 'sem conexão'), 'error'); }
}

// =====================
//  ORGANIZAÇÃO: BOLETOS + EMPRÉSTIMO
// =====================
function _mesAtualLocal() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function getContasFixas() {
  const lista = [...PLANO_FINANCEIRO.boletos.map(b => ({ ...b, grupo: 'boleto' }))];
  lista.push({ nome: 'Assinaturas (cartão)', valor: PLANO_FINANCEIRO.assinaturas, dia: null, grupo: 'cartao' });
  lista.push({ nome: 'Projetos (Discloud/Railway)', valor: PLANO_FINANCEIRO.projetos, dia: null, grupo: 'cartao' });
  lista.push({ ...PLANO_FINANCEIRO.emprestimo, grupo: 'emprestimo' });
  return lista.sort((a, b) => (a.dia || 99) - (b.dia || 99));
}

function getBoletosPagos() {
  try {
    const all = JSON.parse(estadoGet('boletosPagos') || '{}');
    return all[_mesAtualLocal()] || {};
  } catch (e) { return {}; }
}

function toggleBoletoPago(nome) {
  let all = {};
  try { all = JSON.parse(estadoGet('boletosPagos') || '{}'); } catch (e) {}
  const mes = _mesAtualLocal();
  if (!all[mes]) all[mes] = {};
  all[mes][nome] = !all[mes][nome];
  estadoSet('boletosPagos', JSON.stringify(all));
  renderOrganizacaoFinanceira();
}

function getEmprestimoParcelasPagas() {
  const v = parseInt(estadoGet('emprestimoParcelasPagas') || '0', 10);
  return isNaN(v) ? 0 : Math.max(0, Math.min(12, v));
}

function ajustarParcelaEmprestimo(delta) {
  let v = getEmprestimoParcelasPagas() + delta;
  v = Math.max(0, Math.min(12, v));
  estadoSet('emprestimoParcelasPagas', String(v));
  if (delta > 0) {
    const restantes = 12 - v;
    toast(restantes === 0 ? '🎉 Empréstimo QUITADO! Âncora afundada!' : `✅ Parcela paga! Faltam ${restantes} de 12.`, 'success');
    try { ganharXP(15); } catch (e) {}
  }
  renderOrganizacaoFinanceira();
}

function renderOrganizacaoFinanceira() {
  const painel = document.getElementById('painel-organizacao');
  if (!painel) return;

  const contas = getContasFixas();
  const pagos = getBoletosPagos();
  let totalPago = 0, totalPendente = 0;
  const itensHtml = contas.map(c => {
    const pago = !!pagos[c.nome];
    if (pago) totalPago += c.valor; else totalPendente += c.valor;
    const diaTxt = c.dia ? `dia ${c.dia}` : 'fatura';
    return `
      <div onclick="toggleBoletoPago('${c.nome.replace(/'/g, "\\'")}')" style="display:flex; align-items:center; gap:10px; padding:9px 12px; border-radius:8px; cursor:pointer; background:${pago ? 'rgba(49,162,76,0.10)' : 'rgba(255,255,255,0.03)'}; margin-bottom:6px;">
        <span style="font-size:16px;">${pago ? '✅' : '⬜'}</span>
        <span style="flex:1; font-size:13px; ${pago ? 'text-decoration:line-through; color:var(--text-muted);' : ''}">${c.nome}</span>
        <span style="font-size:11px; color:var(--text-muted);">${diaTxt}</span>
        <span style="font-size:13px; font-weight:600; min-width:90px; text-align:right;">${formatBRL(c.valor)}</span>
      </div>`;
  }).join('');

  // Empréstimo
  const pagas = getEmprestimoParcelasPagas();
  const restantes = 12 - pagas;
  const valorParcela = PLANO_FINANCEIRO.emprestimo.valor;
  const totalRestante = restantes * valorParcela;
  const pctEmp = (pagas / 12) * 100;
  const dataQuita = new Date();
  dataQuita.setMonth(dataQuita.getMonth() + restantes);
  const quitaTxt = restantes === 0 ? 'QUITADO 🎉' : dataQuita.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });

  painel.innerHTML = `
    <div style="background:var(--card-bg, #1c1c1e); border:1px solid rgba(255,255,255,0.08); border-radius:14px; padding:18px; margin-bottom:20px;">
      <h2 style="margin:0 0 14px; font-size:16px;">Contas fixas de ${new Date().toLocaleDateString('pt-BR', { month: 'long' })}</h2>
      ${itensHtml}
      <div style="display:flex; justify-content:space-between; margin-top:12px; padding-top:12px; border-top:1px solid rgba(255,255,255,0.08); font-size:13px;">
        <span style="color:#31a24c;">Pago: ${formatBRL(totalPago)}</span>
        <span style="color:#f5a623;">Falta pagar: <b>${formatBRL(totalPendente)}</b></span>
      </div>
    </div>

    <div style="background:var(--card-bg, #1c1c1e); border:1px solid rgba(255,255,255,0.08); border-radius:14px; padding:18px; margin-bottom:20px;">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
        <h2 style="margin:0; font-size:16px;">Empréstimo (a âncora)</h2>
        <span style="font-size:12px; color:var(--text-muted);">quita em ${quitaTxt}</span>
      </div>
      <div style="display:flex; justify-content:space-between; font-size:12px; margin-bottom:6px;">
        <span>${pagas} de 12 parcelas pagas</span>
        <span style="color:var(--text-muted);">restam ${formatBRL(totalRestante)}</span>
      </div>
      <div style="height:10px; background:rgba(255,255,255,0.08); border-radius:6px; overflow:hidden; margin-bottom:12px;">
        <div style="height:100%; width:${pctEmp}%; background:#31a24c;"></div>
      </div>
      <div style="display:flex; gap:8px;">
        <button onclick="ajustarParcelaEmprestimo(1)" style="flex:1; background:rgba(49,162,76,0.18); border:1px solid rgba(49,162,76,0.4); color:#31a24c; border-radius:8px; padding:8px; cursor:pointer; font-size:13px;">✓ Paguei uma parcela</button>
        <button onclick="ajustarParcelaEmprestimo(-1)" style="background:rgba(255,255,255,0.05); border:1px solid rgba(255,255,255,0.1); color:var(--text-muted); border-radius:8px; padding:8px 12px; cursor:pointer; font-size:13px;">↩ desfazer</button>
      </div>
    </div>
  `;
}

// =====================
//  RELATÓRIO MENSAL
// =====================
const LABELS_CAT = {
  alimentacao: '🍔 Alimentação', transporte: '🚗 Transporte', moradia: '🏠 Moradia',
  lazer: '🎮 Lazer', saude: '💊 Saúde', salario: '💼 Salário',
  freelance: '💻 Freelance', outros: '📦 Outros', outro: '📦 Outros'
};

function abrirRelatorioMensal() {
  const agora = new Date();
  const mesAtual = `${agora.getFullYear()}-${String(agora.getMonth() + 1).padStart(2, '0')}`;
  const mesPassadoD = new Date(agora.getFullYear(), agora.getMonth() - 1, 1);
  const mesPassado = `${mesPassadoD.getFullYear()}-${String(mesPassadoD.getMonth() + 1).padStart(2, '0')}`;

  function resumoDe(ym) {
    const tx = allTransactions.filter(t => (t.data || '').substring(0, 7) === ym);
    const ent = tx.filter(t => t.tipo === 'entrada').reduce((s, t) => s + parseFloat(t.valor), 0);
    const sai = tx.filter(t => t.tipo === 'saida').reduce((s, t) => s + parseFloat(t.valor), 0);
    const porCat = {};
    tx.filter(t => t.tipo === 'saida').forEach(t => {
      const c = t.categoria || 'outros';
      porCat[c] = (porCat[c] || 0) + parseFloat(t.valor);
    });
    return { ent, sai, porCat, saldo: ent - sai };
  }

  const atual = resumoDe(mesAtual);
  const ant = resumoDe(mesPassado);
  const difSaidas = atual.sai - ant.sai;

  const cats = Object.entries(atual.porCat).sort((a, b) => b[1] - a[1]);
  const maxCat = cats.length ? cats[0][1] : 1;
  const catsHtml = cats.length ? cats.map(([c, v]) => `
    <div style="margin-bottom:8px;">
      <div style="display:flex; justify-content:space-between; font-size:12px; margin-bottom:4px;">
        <span>${LABELS_CAT[c] || c}</span>
        <span style="color:var(--text-muted);">${formatBRL(v)}</span>
      </div>
      <div style="height:6px; background:rgba(255,255,255,0.08); border-radius:4px; overflow:hidden;">
        <div style="height:100%; width:${(v / maxCat) * 100}%; background:#5b7cfa;"></div>
      </div>
    </div>`).join('') : '<p style="color:var(--text-muted); font-size:13px;">Sem saídas registradas este mês.</p>';

  const modal = document.createElement('div');
  modal.id = 'relatorio-modal';
  modal.innerHTML = `
    <div id="relatorio-overlay" class="custom-modal" onclick="fecharRelatorioMensal(event)">
      <div class="modal-content">
        <div class="modal-header">
          <h2>Relatório de ${agora.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })}</h2>
          <button class="modal-close" onclick="fecharRelatorioMensal()">✕</button>
        </div>
        <div class="modal-body">
          <div style="display:flex; gap:10px; margin-bottom:18px;">
            <div style="flex:1; background:rgba(49,162,76,0.10); border-radius:10px; padding:12px;">
              <div style="font-size:11px; color:var(--text-muted);">Entrou</div>
              <div style="font-size:18px; font-weight:700; color:#31a24c;">${formatBRL(atual.ent)}</div>
            </div>
            <div style="flex:1; background:rgba(248,29,19,0.10); border-radius:10px; padding:12px;">
              <div style="font-size:11px; color:var(--text-muted);">Saiu</div>
              <div style="font-size:18px; font-weight:700; color:#f81d13;">${formatBRL(atual.sai)}</div>
            </div>
            <div style="flex:1; background:rgba(91,124,250,0.10); border-radius:10px; padding:12px;">
              <div style="font-size:11px; color:var(--text-muted);">Saldo</div>
              <div style="font-size:18px; font-weight:700; color:${atual.saldo >= 0 ? '#31a24c' : '#f81d13'};">${formatBRL(atual.saldo)}</div>
            </div>
          </div>
          <div style="font-size:12px; color:var(--text-muted); margin-bottom:16px;">
            ${ant.sai > 0 ? (difSaidas <= 0
              ? `📉 Você gastou ${formatBRL(Math.abs(difSaidas))} a MENOS que no mês passado. Mandou bem!`
              : `📈 Você gastou ${formatBRL(difSaidas)} a MAIS que no mês passado (${formatBRL(ant.sai)}). Fica de olho.`)
              : 'Sem dados do mês anterior pra comparar.'}
          </div>
          <h3 style="font-size:14px; margin:0 0 10px;">Para onde o dinheiro foi</h3>
          ${catsHtml}
        </div>
      </div>
    </div>`;
  document.body.appendChild(modal);
}

function fecharRelatorioMensal(e) {
  if (e && e.target.id !== 'relatorio-overlay') return;
  const m = document.getElementById('relatorio-modal');
  if (m) m.remove();
}

// =====================
//  IMPOSTO DE RENDA (organizador)
// =====================
const IR_DOCS = [
  'Informe de rendimentos (empregador / fontes pagadoras)',
  'Informes bancários e de investimentos',
  'Recibos e notas médicas (você e dependentes)',
  'Comprovantes de despesas com educação',
  'Comprovantes de previdência privada (PGBL)',
  'Recibos de aluguel (pago ou recebido)',
  'Comprovantes de doações',
  'Informe de bens (imóveis, veículos, consórcio)'
];

function getIRDados() {
  try {
    const d = JSON.parse(estadoGet('irDados') || '{}');
    return { documentos: d.documentos || {}, rendimentos: d.rendimentos || [], deducoes: d.deducoes || [], notas: d.notas || '' };
  } catch (e) { return { documentos: {}, rendimentos: [], deducoes: [], notas: '' }; }
}

function salvarIRDados(d) {
  estadoSet('irDados', JSON.stringify(d));
}

function toggleDocIR(idx) {
  const d = getIRDados();
  d.documentos[idx] = !d.documentos[idx];
  salvarIRDados(d);
  renderIR();
}

async function addRendimentoIR() {
  const r = await promptModal({
    titulo: 'Novo rendimento',
    campos: [
      { name: 'fonte', label: 'Fonte (ex: Empresa X, Freelance Y)' },
      { name: 'valor', label: 'Valor recebido no ano (R$)', tipo: 'number', placeholder: '0,00' }
    ]
  });
  if (!r) return;
  const fonte = (r.fonte || '').trim();
  if (!fonte) return;
  const valor = parseFloat(String(r.valor).replace(',', '.'));
  if (isNaN(valor) || valor <= 0) { toast('Valor inválido', 'error'); return; }
  const d = getIRDados();
  d.rendimentos.push({ fonte, valor });
  salvarIRDados(d);
  toast('Rendimento adicionado', 'success');
  renderIR();
}

function removeRendimentoIR(idx) {
  const d = getIRDados();
  d.rendimentos.splice(idx, 1);
  salvarIRDados(d);
  renderIR();
}

async function addDeducaoIR() {
  const r = await promptModal({
    titulo: 'Nova despesa dedutível',
    campos: [
      { name: 'tipo', label: 'Tipo (Saúde, Educação, Previdência, Dependente)' },
      { name: 'desc', label: 'Descrição (ex: Consulta Dr. Fulano)' },
      { name: 'valor', label: 'Valor (R$)', tipo: 'number', placeholder: '0,00' }
    ]
  });
  if (!r) return;
  const tipo = (r.tipo || '').trim();
  if (!tipo) return;
  const desc = (r.desc || '').trim();
  const valor = parseFloat(String(r.valor).replace(',', '.'));
  if (isNaN(valor) || valor <= 0) { toast('Valor inválido', 'error'); return; }
  const d = getIRDados();
  d.deducoes.push({ tipo, desc, valor });
  salvarIRDados(d);
  toast('Despesa dedutível adicionada', 'success');
  renderIR();
}

function removeDeducaoIR(idx) {
  const d = getIRDados();
  d.deducoes.splice(idx, 1);
  salvarIRDados(d);
  renderIR();
}

function salvarNotasIR() {
  const el = document.getElementById('ir-notas');
  if (!el) return;
  const d = getIRDados();
  d.notas = el.value;
  salvarIRDados(d);
  toast('Anotações salvas', 'success');
}

function renderIR() {
  const painel = document.getElementById('painel-ir');
  if (!painel) return;
  const d = getIRDados();

  const docsFeitos = IR_DOCS.filter((_, i) => d.documentos[i]).length;
  const docsHtml = IR_DOCS.map((doc, i) => {
    const ok = !!d.documentos[i];
    return `
      <div onclick="toggleDocIR(${i})" style="display:flex; align-items:center; gap:10px; padding:9px 12px; border-radius:8px; cursor:pointer; background:${ok ? 'rgba(49,162,76,0.10)' : 'rgba(255,255,255,0.03)'}; margin-bottom:6px;">
        <span style="font-size:16px;">${ok ? '✅' : '⬜'}</span>
        <span style="flex:1; font-size:13px; ${ok ? 'text-decoration:line-through; color:var(--text-muted);' : ''}">${doc}</span>
      </div>`;
  }).join('');

  const totalRend = d.rendimentos.reduce((s, r) => s + parseFloat(r.valor || 0), 0);
  const rendHtml = d.rendimentos.length ? d.rendimentos.map((r, i) => `
    <div style="display:flex; align-items:center; gap:8px; padding:8px 12px; background:rgba(255,255,255,0.03); border-radius:8px; margin-bottom:6px;">
      <span style="flex:1; font-size:13px;">${r.fonte}</span>
      <span style="font-size:13px; font-weight:600;">${formatBRL(r.valor)}</span>
      <span onclick="removeRendimentoIR(${i})" style="cursor:pointer; color:#f81d13; font-size:14px;">✕</span>
    </div>`).join('') : '<p style="color:var(--text-muted); font-size:13px;">Nenhum rendimento registrado.</p>';

  const totalDed = d.deducoes.reduce((s, r) => s + parseFloat(r.valor || 0), 0);
  const dedHtml = d.deducoes.length ? d.deducoes.map((r, i) => `
    <div style="display:flex; align-items:center; gap:8px; padding:8px 12px; background:rgba(255,255,255,0.03); border-radius:8px; margin-bottom:6px;">
      <span style="font-size:11px; background:rgba(91,124,250,0.2); color:#5b7cfa; padding:2px 8px; border-radius:6px;">${r.tipo}</span>
      <span style="flex:1; font-size:13px;">${r.desc || ''}</span>
      <span style="font-size:13px; font-weight:600;">${formatBRL(r.valor)}</span>
      <span onclick="removeDeducaoIR(${i})" style="cursor:pointer; color:#f81d13; font-size:14px;">✕</span>
    </div>`).join('') : '<p style="color:var(--text-muted); font-size:13px;">Nenhuma despesa dedutível registrada.</p>';

  painel.innerHTML = `
    <div style="background:rgba(245,166,35,0.10); border:1px solid rgba(245,166,35,0.3); border-radius:12px; padding:14px; margin-bottom:18px; font-size:13px; line-height:1.5;">
      ⚠️ <b>Isto é um organizador, não um cálculo de imposto.</b> Serve pra você juntar tudo e chegar no contador/Receita com a papelada pronta. Não substitui orientação de um contador.
    </div>

    <div style="background:var(--card-bg, #1c1c1e); border:1px solid rgba(255,255,255,0.08); border-radius:14px; padding:18px; margin-bottom:18px;">
      <h2 style="margin:0 0 12px; font-size:16px;">Documentos a juntar <span style="font-size:12px; color:var(--text-muted);">(${docsFeitos}/${IR_DOCS.length})</span></h2>
      ${docsHtml}
    </div>

    <div style="background:var(--card-bg, #1c1c1e); border:1px solid rgba(255,255,255,0.08); border-radius:14px; padding:18px; margin-bottom:18px;">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
        <h2 style="margin:0; font-size:16px;">Rendimentos do ano</h2>
        <button onclick="addRendimentoIR()" style="background:rgba(49,162,76,0.18); border:1px solid rgba(49,162,76,0.4); color:#31a24c; border-radius:6px; padding:4px 10px; font-size:12px; cursor:pointer;">+ Adicionar</button>
      </div>
      ${rendHtml}
      <div style="text-align:right; margin-top:10px; font-size:13px;">Total: <b>${formatBRL(totalRend)}</b></div>
    </div>

    <div style="background:var(--card-bg, #1c1c1e); border:1px solid rgba(255,255,255,0.08); border-radius:14px; padding:18px; margin-bottom:18px;">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
        <h2 style="margin:0; font-size:16px;">Despesas dedutíveis</h2>
        <button onclick="addDeducaoIR()" style="background:rgba(91,124,250,0.18); border:1px solid rgba(91,124,250,0.4); color:#5b7cfa; border-radius:6px; padding:4px 10px; font-size:12px; cursor:pointer;">+ Adicionar</button>
      </div>
      <p style="font-size:11px; color:var(--text-muted); margin:0 0 12px;">Saúde, educação, previdência (PGBL) e dependentes podem reduzir o imposto. Guarde os recibos.</p>
      ${dedHtml}
      <div style="text-align:right; margin-top:10px; font-size:13px;">Total dedutível: <b>${formatBRL(totalDed)}</b></div>
    </div>

    <div style="background:var(--card-bg, #1c1c1e); border:1px solid rgba(255,255,255,0.08); border-radius:14px; padding:18px;">
      <h2 style="margin:0 0 12px; font-size:16px;">Anotações</h2>
      <textarea id="ir-notas" placeholder="Pendências, dúvidas pro contador, prazos..." style="width:100%; min-height:90px; background:rgba(255,255,255,0.03); border:1px solid rgba(255,255,255,0.1); border-radius:8px; padding:10px; color:var(--text); font-size:13px; resize:vertical;">${(d.notas || '').replace(/</g, '&lt;')}</textarea>
      <button onclick="salvarNotasIR()" style="margin-top:8px; background:rgba(91,124,250,0.18); border:1px solid rgba(91,124,250,0.4); color:#5b7cfa; border-radius:8px; padding:6px 14px; font-size:13px; cursor:pointer;">Salvar anotações</button>
    </div>
  `;
}

// =====================
//  OPEN FINANCE (Pluggy)
// =====================
let _ofStatus = { configurado: false, items: [] };
let _ofSaldos = null;

async function carregarBancos() {
  try {
    const res = await fetch('/api/openfinance/status');
    _ofStatus = await res.json();
  } catch (e) {
    _ofStatus = { configurado: false, items: [] };
  }
  // Saldos reais das contas conectadas
  try {
    const r = await fetch('/api/openfinance/saldos');
    _ofSaldos = await r.json();
  } catch (e) {
    _ofSaldos = null;
  }
  renderBancos();
  aplicarSaldosReais();
}

// Sobrescreve o "Saldo Total" (dashboard + financeiro) com o saldo REAL em conta
function aplicarSaldosReais() {
  if (!_ofSaldos || !_ofSaldos.contas || _ofSaldos.contas.length === 0) return;
  const real = formatBRL(_ofSaldos.totalBanco);
  const dash = document.getElementById('dash-saldo');
  const fin = document.getElementById('saldo-total');
  if (dash) dash.textContent = real;
  if (fin) fin.textContent = real;
}

function renderBancos() {
  const painel = document.getElementById('painel-bancos');
  if (!painel) return;

  if (!_ofStatus.configurado) {
    painel.innerHTML = `
      <div style="background:var(--card-bg, #1c1c1e); border:1px solid rgba(255,255,255,0.08); border-radius:14px; padding:18px; margin-bottom:20px;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
          <h2 style="margin:0; font-size:16px;">Conectar banco (Open Finance)</h2>
        </div>
        <p style="font-size:13px; color:var(--text-muted); line-height:1.5; margin:0 0 12px;">
          Sincronize automaticamente toda movimentação dos seus bancos (Nubank, Inter, C6, PicPay...).
          Precisa configurar suas credenciais do Pluggy uma única vez.
        </p>
        <button onclick="mostrarSetupPluggy()" style="background:rgba(91,124,250,0.18); border:1px solid rgba(91,124,250,0.4); color:#5b7cfa; border-radius:8px; padding:8px 16px; font-size:13px; cursor:pointer;">Como configurar</button>
      </div>`;
    return;
  }

  const items = _ofStatus.items || [];
  const itemsHtml = items.length ? items.map(it => {
    const sync = it.ultima_sync ? new Date(it.ultima_sync).toLocaleString('pt-BR', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' }) : 'nunca';
    return `
      <div style="display:flex; align-items:center; gap:10px; padding:10px 12px; background:rgba(255,255,255,0.03); border-radius:8px; margin-bottom:6px;">
        <span style="font-size:16px;">🏦</span>
        <span style="flex:1; font-size:13px;">${escapeHtml(it.connector_nome || 'Banco')}</span>
        <span style="font-size:11px; color:var(--text-muted);">sync: ${sync}</span>
        <span onclick="desconectarBanco('${it.item_id}')" style="cursor:pointer; color:#f81d13; font-size:13px;">desconectar</span>
      </div>`;
  }).join('') : '<p style="font-size:13px; color:var(--text-muted);">Nenhum banco conectado ainda.</p>';

  // Resumo de saldo REAL (banco vs cartão)
  let saldoHtml = '';
  if (_ofSaldos && _ofSaldos.contas && _ofSaldos.contas.length > 0) {
    const contasHtml = _ofSaldos.contas.map(c => {
      const ehCartao = c.tipo === 'CREDIT';
      const dataSaldo = c.saldo_em ? new Date(c.saldo_em).toLocaleDateString('pt-BR', { day:'2-digit', month:'2-digit' }) : null;
      return `
        <div style="display:flex; justify-content:space-between; align-items:center; font-size:12px; padding:5px 0;">
          <span>${ehCartao ? '💳' : '🏦'} ${escapeHtml(c.nome || (ehCartao ? 'Cartão' : 'Conta'))}${dataSaldo ? ` <span style="color:var(--text-muted); font-size:10px;">(saldo de ${dataSaldo})</span>` : ''}</span>
          <span style="color:${ehCartao ? '#f5a623' : 'var(--text)'};">${ehCartao ? '−' : ''}${formatBRL(Math.abs(Number(c.saldo)))}</span>
        </div>`;
    }).join('');
    // Aviso de saldo desatualizado (> 2 dias)
    let avisoStale = '';
    if (_ofSaldos.saldoEmMaisAntigo) {
      const diasAtras = Math.floor((Date.now() - new Date(_ofSaldos.saldoEmMaisAntigo).getTime()) / 86400000);
      if (diasAtras >= 2) {
        avisoStale = `<div style="background:rgba(245,166,35,0.12); border:1px solid rgba(245,166,35,0.3); border-radius:8px; padding:8px 10px; margin-bottom:10px; font-size:11px; color:#f5c46b;">⚠️ Saldo de até ${diasAtras} dias atrás. Atualize a conexão no meu.pluggy.ai e clique em Sincronizar pra puxar o valor atual.</div>`;
      }
    }
    saldoHtml = `
      ${avisoStale}`;
    saldoHtml += `
      <div style="background:rgba(255,255,255,0.03); border-radius:10px; padding:14px; margin-bottom:14px;">
        <div style="display:flex; gap:10px; margin-bottom:10px;">
          <div style="flex:1; text-align:center;">
            <div style="font-size:11px; color:var(--text-muted);">Em conta</div>
            <div style="font-size:18px; font-weight:700; color:#31a24c;">${formatBRL(_ofSaldos.totalBanco)}</div>
          </div>
          <div style="flex:1; text-align:center;">
            <div style="font-size:11px; color:var(--text-muted);">Faturas de cartão</div>
            <div style="font-size:18px; font-weight:700; color:#f5a623;">${formatBRL(_ofSaldos.totalCredito)}</div>
          </div>
          <div style="flex:1; text-align:center;">
            <div style="font-size:11px; color:var(--text-muted);">Líquido</div>
            <div style="font-size:18px; font-weight:700; color:${_ofSaldos.saldoLiquido >= 0 ? '#31a24c' : '#f81d13'};">${formatBRL(_ofSaldos.saldoLiquido)}</div>
          </div>
        </div>
        <div style="border-top:1px solid rgba(255,255,255,0.08); padding-top:8px;">${contasHtml}</div>
      </div>`;
  }

  painel.innerHTML = `
    <div style="background:var(--card-bg, #1c1c1e); border:1px solid rgba(255,255,255,0.08); border-radius:14px; padding:18px; margin-bottom:20px;">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
        <h2 style="margin:0; font-size:16px;">Bancos conectados</h2>
        <div style="display:flex; gap:8px; flex-wrap:wrap;">
          <button onclick="sincronizarBancos()" style="background:rgba(49,162,76,0.18); border:1px solid rgba(49,162,76,0.4); color:#31a24c; border-radius:8px; padding:6px 12px; font-size:12px; cursor:pointer;">Sincronizar</button>
          <button onclick="importarPorItemId()" style="background:rgba(245,166,35,0.18); border:1px solid rgba(245,166,35,0.4); color:#f5c46b; border-radius:8px; padding:6px 12px; font-size:12px; cursor:pointer;">Item ID</button>
          <button onclick="conectarBanco()" style="background:rgba(91,124,250,0.18); border:1px solid rgba(91,124,250,0.4); color:#5b7cfa; border-radius:8px; padding:6px 12px; font-size:12px; cursor:pointer;">+ Conectar</button>
        </div>
      </div>
      ${saldoHtml}
      ${itemsHtml}
    </div>`;
}

async function conectarBanco() {
  if (typeof PluggyConnect === 'undefined') {
    toast('SDK do Pluggy não carregou. Verifica tua conexão e recarrega.', 'error');
    return;
  }
  try {
    const res = await fetch('/api/openfinance/connect-token', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}'
    });
    const data = await res.json();
    if (!res.ok) { toast(data.erro || 'Erro ao iniciar conexão', 'error'); return; }

    const pluggy = new PluggyConnect({
      connectToken: data.accessToken,
      includeSandbox: true,
      onSuccess: async (itemData) => {
        const item = itemData.item || {};
        const nome = (item.connector && item.connector.name) || 'Banco';
        await fetch('/api/openfinance/items', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ itemId: item.id, connectorNome: nome })
        });
        toast(`✅ ${nome} conectado! Sincronizando...`, 'success');
        await sincronizarBancos(item.id);
        carregarBancos();
      },
      onError: (err) => {
        toast('Falha ao conectar banco', 'error');
        console.error('Pluggy error:', err);
      }
    });
    pluggy.init();
  } catch (e) {
    toast('Erro ao conectar: ' + e.message, 'error');
  }
}

async function sincronizarBancos(itemId) {
  toast('🔄 Sincronizando transações...', 'info');
  try {
    const res = await fetch('/api/openfinance/sync', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(itemId ? { itemId } : {})
    });
    const data = await res.json();
    if (!res.ok) { toast(data.erro || 'Erro ao sincronizar', 'error'); return; }
    toast(`✅ ${data.importadas} novas transações importadas!`, 'success');
    if (typeof carregarFinanceiro === 'function') carregarFinanceiro();
  } catch (e) {
    toast('Erro ao sincronizar: ' + e.message, 'error');
  }
}

async function importarPorItemId() {
  const r = await promptModal({
    titulo: 'Importar por Item ID',
    campos: [{ name: 'itemId', label: 'Item ID do banco conectado no meu.pluggy.ai' }]
  });
  if (!r) return;
  const id = (r.itemId || '').trim();
  if (!id) { toast('Item ID vazio', 'error'); return; }
  toast('🔄 Validando e importando...', 'info');
  try {
    const res = await fetch('/api/openfinance/import-item', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ itemId: id })
    });
    const data = await res.json();
    if (!res.ok) { toast(data.erro || 'Erro ao importar', 'error'); return; }
    toast(`✅ ${data.connectorNome} importado! ${data.importadas} transações.`, 'success');
    if (typeof carregarFinanceiro === 'function') carregarFinanceiro();
    carregarBancos();
  } catch (e) {
    toast('Erro: ' + e.message, 'error');
  }
}

async function desconectarBanco(itemId) {
  if (!confirm('Desconectar este banco? As transações já importadas continuam salvas.')) return;
  try {
    await fetch(`/api/openfinance/items/${itemId}`, { method: 'DELETE' });
    toast('Banco desconectado', 'success');
    carregarBancos();
  } catch (e) {
    toast('Erro ao desconectar', 'error');
  }
}

function mostrarSetupPluggy() {
  const modal = document.createElement('div');
  modal.id = 'setup-pluggy-modal';
  modal.innerHTML = `
    <div id="setup-pluggy-overlay" class="custom-modal" onclick="fecharSetupPluggy(event)">
      <div class="modal-content">
        <div class="modal-header">
          <h2>⚙️ Configurar Open Finance (Pluggy)</h2>
          <button class="modal-close" onclick="fecharSetupPluggy()">✕</button>
        </div>
        <div class="modal-body" style="font-size:13px; line-height:1.6;">
          <p>Conexão automática usa o <b>Pluggy</b> (agregador brasileiro de Open Finance). Faça uma vez:</p>
          <ol style="padding-left:18px;">
            <li>Crie conta em <b>dashboard.pluggy.ai</b></li>
            <li>No painel, copie seu <b>Client ID</b> e <b>Client Secret</b></li>
            <li>No arquivo <code>.env</code> do app, adicione:<br>
              <code style="display:block; background:rgba(255,255,255,0.05); padding:8px; border-radius:6px; margin-top:6px;">PLUGGY_CLIENT_ID=seu_id_aqui<br>PLUGGY_CLIENT_SECRET=seu_secret_aqui</code>
            </li>
            <li>Reinicie o app</li>
            <li>Volte aqui e clique em <b>Conectar</b> — você autoriza direto no widget seguro do Pluggy (sua senha do banco nunca passa pelo app).</li>
          </ol>
          <p style="color:var(--text-muted);">Dica: o tier de desenvolvedor permite testar com bancos sandbox antes de conectar o banco real.</p>
        </div>
      </div>
    </div>`;
  document.body.appendChild(modal);
}

function fecharSetupPluggy(e) {
  if (e && e.target.id !== 'setup-pluggy-overlay') return;
  const m = document.getElementById('setup-pluggy-modal');
  if (m) m.remove();
}

function conectarWebSocket() {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${window.location.host}`;
  ws = new WebSocket(wsUrl);

  ws.addEventListener('open', () => {
    wsReconnectAttempts = 0;
    const sessionId = Math.random().toString(36).substring(7);
    ws.send(JSON.stringify({ tipo: 'auth', sessionId }));
  });

  ws.addEventListener('message', (event) => {
    try {
      handleWebSocketMessage(JSON.parse(event.data));
    } catch (err) { console.error(err); }
  });

  ws.addEventListener('close', () => {
    if (wsReconnectAttempts < wsMaxReconnectAttempts) {
      wsReconnectAttempts++;
      setTimeout(conectarWebSocket, wsReconnectDelay);
    }
  });
}

function handleWebSocketMessage(msg) {
  const { tipo } = msg;
  if (tipo?.startsWith('tarefa-')) carregarTarefas();
  else if (tipo?.startsWith('financeiro-')) carregarTransacoes();
  else if (tipo?.startsWith('alarme-')) carregarAlarmes();
  else if (tipo?.startsWith('recorrente-')) carregarRecorrentes();
  else if (tipo?.startsWith('evento-')) carregarEventos();
}

// =====================
//  CUSTOM CONFIRM MODAL
// =====================
function confirmModal(message, title = 'Confirmar ação', icon = '🗑️') {
  return new Promise((resolve) => {
    const overlay = document.getElementById('custom-modal');
    document.getElementById('modal-title').textContent = title;
    document.getElementById('modal-message').textContent = message;
    document.getElementById('modal-icon').textContent = icon;
    overlay.style.display = 'flex';

    const cancelBtn = document.getElementById('modal-cancel');
    const confirmBtn = document.getElementById('modal-confirm');

    const cleanup = (result) => {
      overlay.style.display = 'none';
      cancelBtn.onclick = null;
      confirmBtn.onclick = null;
      document.removeEventListener('keydown', escHandler);
      resolve(result);
    };

    const escHandler = (e) => {
      if (e.key === 'Escape') cleanup(false);
      if (e.key === 'Enter') cleanup(true);
    };

    cancelBtn.onclick = () => cleanup(false);
    confirmBtn.onclick = () => cleanup(true);
    overlay.onclick = (e) => {
      if (e.target === overlay) cleanup(false);
    };
    document.addEventListener('keydown', escHandler);
    setTimeout(() => confirmBtn.focus(), 100);
  });
}

// =====================
//  TOAST NOTIFICATIONS
// =====================
function toast(msg, tipo = 'success') {
  const container = document.getElementById('toast-container');
  const t = document.createElement('div');
  t.className = `toast toast-${tipo}`;
  const icons = { success: '✓', error: '✕', info: 'ℹ' };
  t.innerHTML = `<span>${icons[tipo] || ''}</span><span>${msg}</span>`;
  container.appendChild(t);
  setTimeout(() => t.remove(), 3000);
}

// Extrai a mensagem de erro real da resposta (do campo "erro" do backend),
// com fallback pra código HTTP (401 = "Sessão expirou", etc.)
async function toastErro(res, fallback) {
  let msg = fallback || 'Erro na operação';
  try {
    const d = await res.json();
    if (d && d.erro) msg = d.erro;
  } catch (e) { /* body vazio ou não é JSON */ }
  if (!msg || msg === 'Erro na operação') {
    if (res.status === 401) msg = 'Sessão expirou. Recarrega a página.';
    else if (res.status === 403) msg = 'Sem permissão pra isso.';
    else if (res.status === 404) msg = 'Não encontrado.';
    else if (res.status === 429) msg = 'Muitas requisições. Espera um pouco.';
    else if (res.status >= 500) msg = 'Erro no servidor. Tenta de novo em alguns segundos.';
  }
  toast(msg, 'error');
}

// =====================
//  DATE & TIME
// =====================
function atualizarData() {
  const hoje = new Date();
  const opcoes = { weekday: 'long', day: 'numeric', month: 'long' };
  document.getElementById('data-hoje').textContent = hoje.toLocaleDateString('pt-BR', opcoes);
}

function atualizarHora() {
  const agora = new Date();
  const hora = String(agora.getHours()).padStart(2, '0');
  const min = String(agora.getMinutes()).padStart(2, '0');
  document.getElementById('hora-agora').textContent = `${hora}:${min}`;
}

function saudacao() {
  const hora = new Date().getHours();
  let saud = 'dia';
  if (hora >= 12 && hora < 18) saud = 'tarde';
  else if (hora >= 18 || hora < 5) saud = 'noite';
  return `Boa ${saud}`;
}

// =====================
//  TABS NAVIGATION
// =====================
function trocarAba(tab) {
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
  document.querySelector(`.nav-btn[data-tab="${tab}"]`)?.classList.add('active');
  document.getElementById(tab)?.classList.add('active');
  if (tab === 'historico-page') {
    carregarStats();
    if (typeof renderHistorico === 'function') renderHistorico();
  }
}

document.querySelectorAll('.nav-btn').forEach(btn => {
  btn.addEventListener('click', () => trocarAba(btn.getAttribute('data-tab')));
});

// =====================
//  TASKS
// =====================
async function carregarTarefas() {
  try {
    const res = await fetch('/api/tasks');
    allTasks = await res.json();
    renderTarefas();        // Hoje primeiro
    renderTarefasAmanha();
    renderTarefasOntem();
    renderTarefasAnteontem();
    renderTarefasAmanhaPage();
    renderRecorrentes();    // Renderizar recorrentes
    renderTimeline();
    renderHistorico();
    atualizarDashboard();
    atualizarBadgesTarefas(); // Atualizar badges das seções
  } catch (err) {
    console.error('Erro tarefas:', err);
  }
}

function atualizarBadgesTarefas() {
  // Atualizar badges das seções (usando data local)
  const anteontemStr = anteontemLocal();
  const ontemStr = ontemLocal();
  const hojeStr = hojeLocal();
  const amanhaStr = amanhaLocal();

  const tarefasAnteontem = allTasks.filter(t => t.data_reset && t.data_reset.split('T')[0] === anteontemStr).length;
  const tarefasOntem = allTasks.filter(t => t.data_reset && t.data_reset.split('T')[0] === ontemStr).length;
  const tarefasHoje = allTasks.filter(t => t.data_reset && t.data_reset.split('T')[0] === hojeStr).length;
  const tarefasAmanha = allTasks.filter(t => t.data_reset && t.data_reset.split('T')[0] === amanhaStr).length;

  const badgeAnteontem = document.getElementById('badge-anteontem');
  const badgeOntem = document.getElementById('badge-ontem');
  const badgeHoje = document.getElementById('badge-hoje');
  const badgeAmanha = document.getElementById('badge-amanha');

  if (badgeAnteontem) badgeAnteontem.textContent = tarefasAnteontem;
  if (badgeOntem) badgeOntem.textContent = tarefasOntem;
  if (badgeHoje) badgeHoje.textContent = tarefasHoje;
  if (badgeAmanha) badgeAmanha.textContent = tarefasAmanha;
}

function renderTarefasDia(dataStr, listaId, emptyId) {
  const lista = document.getElementById(listaId);
  const empty = document.getElementById(emptyId);
  if (!lista) return;

  let filtered = allTasks.filter(t => t.data_reset && t.data_reset.split('T')[0] === dataStr);
  const totalDoDia = filtered.length;

  if (currentTaskFilter === 'pendentes') filtered = filtered.filter(t => !t.concluida);
  else if (currentTaskFilter === 'concluidas') filtered = filtered.filter(t => t.concluida);
  else if (currentTaskFilter === 'alta') filtered = filtered.filter(t => t.prioridade === 'alta');

  filtered.sort((a, b) => (a.hora || '99:99').localeCompare(b.hora || '99:99'));

  if (filtered.length === 0) {
    lista.innerHTML = totalDoDia > 0 ? `<div class="mini-item-empty">Nenhuma tarefa nesse filtro</div>` : '';
    if (empty) empty.style.display = totalDoDia === 0 ? 'block' : 'none';
    return;
  }
  if (empty) empty.style.display = 'none';
  lista.innerHTML = filtered.map(task => {
    const prioridade = task.prioridade || 'media';
    const categoria = task.categoria || 'geral';
    const catIcons = { geral: '📌', trabalho: '💼', estudos: '📚', saude: '💪', pessoal: '🏠' };
    const horaHtml = task.hora ? `<span class="task-hora">⏰ ${task.hora}</span>` : '';
    return `
      <li class="task-item ${task.concluida ? 'completed' : ''}">
        <input type="checkbox" class="task-check" ${task.concluida ? 'checked' : ''}
               onchange="marcarTarefa('${task.id}', this.checked)">
        <div class="task-content">
          <div class="task-text">${escapeHtml(task.titulo)}</div>
          <div class="task-meta">
            ${horaHtml}
            <span class="task-badge badge-${prioridade}">${prioridade}</span>
            <span class="task-cat">${catIcons[categoria] || '📌'} ${categoria}</span>
          </div>
        </div>
        <button class="btn-delete" onclick="deletarTarefa('${task.id}')" title="Deletar">✕</button>
      </li>`;
  }).join('');
}

function renderTarefasAnteontem() {
  renderTarefasDia(anteontemLocal(), 'lista-tarefas-anteontem', 'empty-tarefas-anteontem');
}

function renderTarefasOntem() {
  const lista = document.getElementById('lista-tarefas-ontem');
  const empty = document.getElementById('empty-tarefas-ontem');

  const ontemStr = ontemLocal();

  // Filtrar apenas tarefas de ontem
  let filtered = allTasks.filter(t => {
    if (!t.data_reset) return false;
    return t.data_reset.split('T')[0] === ontemStr;
  });

  // Aplicar filtros adicionais
  if (currentTaskFilter === 'pendentes') filtered = filtered.filter(t => !t.concluida);
  else if (currentTaskFilter === 'concluidas') filtered = filtered.filter(t => t.concluida);
  else if (currentTaskFilter === 'alta') filtered = filtered.filter(t => t.prioridade === 'alta');

  // Ordenar por hora
  filtered.sort((a, b) => {
    const horaA = a.hora || '99:99';
    const horaB = b.hora || '99:99';
    return horaA.localeCompare(horaB);
  });

  if (filtered.length === 0) {
    lista.innerHTML = '';
    const tarefasOntem = allTasks.filter(t => t.data_reset && t.data_reset.split('T')[0] === ontemLocal());
    empty.style.display = tarefasOntem.length === 0 ? 'block' : 'none';
    if (tarefasOntem.length > 0) {
      lista.innerHTML = `<div class="mini-item-empty">Nenhuma tarefa nesse filtro</div>`;
    }
  } else {
    empty.style.display = 'none';
    lista.innerHTML = filtered.map(task => {
      const prioridade = task.prioridade || 'media';
      const categoria = task.categoria || 'geral';
      const catIcons = {
        geral: '📌', trabalho: '💼', estudos: '📚', saude: '💪', pessoal: '🏠'
      };
      const horaHtml = task.hora ? `<span class="task-hora">⏰ ${task.hora}</span>` : '';
      return `
        <li class="task-item ${task.concluida ? 'completed' : ''}">
          <input type="checkbox" class="task-check" ${task.concluida ? 'checked' : ''}
                 onchange="marcarTarefa('${task.id}', this.checked)">
          <div class="task-content">
            <div class="task-text">${escapeHtml(task.titulo)}</div>
            <div class="task-meta">
              ${horaHtml}
              <span class="task-badge badge-${prioridade}">${prioridade}</span>
              <span class="task-cat">${catIcons[categoria] || '📌'} ${categoria}</span>
            </div>
          </div>
          <button class="btn-delete" onclick="deletarTarefa('${task.id}')" title="Deletar">✕</button>
        </li>
      `;
    }).join('');
  }
}

function renderTarefas() {
  const lista = document.getElementById('lista-tarefas');
  const empty = document.getElementById('empty-tarefas');

  // Filtrar apenas tarefas de hoje (usando data local para evitar bug de timezone)
  const hoje = hojeLocal();
  let filtered = allTasks.filter(t => {
    if (!t.data_reset) return false;
    return t.data_reset.split('T')[0] === hoje;
  });

  // Aplicar filtros adicionais
  if (currentTaskFilter === 'pendentes') filtered = filtered.filter(t => !t.concluida);
  else if (currentTaskFilter === 'concluidas') filtered = filtered.filter(t => t.concluida);
  else if (currentTaskFilter === 'alta') filtered = filtered.filter(t => t.prioridade === 'alta');

  // Ordenar por hora (tarefas com hora primeiro, depois sem hora)
  filtered.sort((a, b) => {
    const horaA = a.hora || '99:99';
    const horaB = b.hora || '99:99';
    return horaA.localeCompare(horaB);
  });

  if (filtered.length === 0) {
    lista.innerHTML = '';
    const tarefasHoje = allTasks.filter(t => t.data_reset && t.data_reset.split('T')[0] === hojeLocal());
    empty.style.display = tarefasHoje.length === 0 ? 'block' : 'none';
    if (tarefasHoje.length > 0) {
      lista.innerHTML = `<div class="mini-item-empty">Nenhuma tarefa nesse filtro</div>`;
    }
  } else {
    empty.style.display = 'none';
    lista.innerHTML = filtered.map(task => {
      const prioridade = task.prioridade || 'media';
      const categoria = task.categoria || 'geral';
      const catIcons = {
        geral: '📌', trabalho: '💼', estudos: '📚', saude: '💪', pessoal: '🏠'
      };
      const horaHtml = task.hora ? `<span class="task-hora">⏰ ${task.hora}</span>` : '';
      return `
        <li class="task-item ${task.concluida ? 'completed' : ''}">
          <input type="checkbox" class="task-check" ${task.concluida ? 'checked' : ''}
                 onchange="marcarTarefa('${task.id}', this.checked)">
          <div class="task-content">
            <div class="task-text">${escapeHtml(task.titulo)}</div>
            <div class="task-meta">
              ${horaHtml}
              <span class="task-badge badge-${prioridade}">${prioridade}</span>
              <span class="task-cat">${catIcons[categoria] || '📌'} ${categoria}</span>
            </div>
          </div>
          <button class="btn-delete" onclick="deletarTarefa('${task.id}')" title="Deletar">✕</button>
        </li>
      `;
    }).join('');
  }

  const tarefasHoje = allTasks.filter(t => t.data_reset && t.data_reset.split('T')[0] === hojeLocal());
  document.getElementById('total').textContent = tarefasHoje.length;
  document.getElementById('concluidas').textContent = tarefasHoje.filter(t => t.concluida).length;
}

async function adicionarTarefa() {
  const input = document.getElementById('nova-tarefa');
  const titulo = input.value.trim();
  const prioridade = document.getElementById('prioridade-tarefa').value;
  const categoria = document.getElementById('categoria-tarefa').value;
  const dataTarefa = document.getElementById('data-tarefa').value;
  const horaTarefa = document.getElementById('hora-tarefa').value;

  if (!titulo) {
    toast('Digite o nome da tarefa', 'error');
    return;
  }

  // Se não selecionou data, usa hoje (local)
  const dataReset = dataTarefa || hojeLocal();

  try {

    const res = await fetch('/api/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        titulo,
        prioridade,
        categoria,
        data_reset: dataReset,
        hora: horaTarefa || null
      })
    });

    if (!res.ok) {
      const erro = await res.text();
      toast('Erro: ' + erro, 'error');
      return;
    }

    input.value = '';
    // Resetar data para hoje (local) e limpar hora
    document.getElementById('data-tarefa').value = hojeLocal();
    document.getElementById('hora-tarefa').value = '';
    toast('✅ Tarefa adicionada!');
    carregarTarefas();
  } catch (err) {
    toast('Erro ao adicionar: ' + err.message, 'error');
  }
}

async function marcarTarefa(id, concluida) {
  try {
    await fetch(`/api/tasks/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ concluida })
    });
    if (concluida) {
      ganharXP(5); // 5 XP por tarefa concluída
      celebrarTarefa();
      // Verificar se completou todas as de hoje (meta!)
      await carregarTarefas();
      const hoje = hojeLocal();
      const hojeAll = allTasks.filter(t => t.data_reset && t.data_reset.split('T')[0] === hoje);
      const hojeConc = hojeAll.filter(t => t.concluida);
      if (hojeAll.length > 0 && hojeConc.length === hojeAll.length) {
        setTimeout(() => celebrarMeta(), 500);
      }
    } else {
      carregarTarefas();
    }
  } catch (err) {
    toast('Erro ao atualizar', 'error');
  }
}

async function deletarTarefa(id) {
  const ok = await confirmModal('Essa ação não pode ser desfeita.', 'Deletar tarefa?', '🗑️');
  if (!ok) return;
  try {
    await fetch(`/api/tasks/${id}`, { method: 'DELETE' });
    toast('Tarefa removida', 'info');
    carregarTarefas();
  } catch (err) {
    toast('Erro ao deletar', 'error');
  }
}

// Filter buttons tasks — atualiza todas as seções
document.querySelectorAll('.filter-btn[data-filter]').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.filter-btn[data-filter]').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentTaskFilter = btn.getAttribute('data-filter');
    renderTarefas();
    renderTarefasAmanha();
    renderTarefasOntem();
    renderTarefasAnteontem();
  });
});

// =====================
//  FINANCEIRO
// =====================
async function carregarTransacoes() {
  try {
    const res = await fetch('/api/financeiro');
    const data = await res.json();
    allTransactions = data.transacoes || [];

    document.getElementById('saldo-total').textContent = formatBRL(data.saldo);
    document.getElementById('total-entradas').textContent = formatBRL(data.entradas);
    document.getElementById('total-saidas').textContent = formatBRL(data.saidas);

    renderTransacoes();
    renderOrcamentosVisual();
    renderOrcamentosCategorias();
    verificarAnaliseDiaria();
    renderOrganizacaoFinanceira();
    carregarBancos();
    atualizarBadgeCategorizar();
    carregarAlertas();
    atualizarDashboard();
  } catch (err) {
    console.error('Erro transações:', err);
  }
}

// Popula os selects de conta/categoria com base nos dados atuais (chamado no render)
function _preencherFinSelects() {
  const selConta = document.getElementById('fin-conta');
  const selCat = document.getElementById('fin-categoria');
  if (!selConta || !selCat) return;

  const contasMap = {};
  if (_contasData && _contasData.contas) {
    _contasData.contas.forEach(b => {
      b.accounts.forEach(a => { contasMap[a.account_id] = b.apelido + (a.tipo === 'CREDIT' ? ' · Cartão' : ''); });
    });
  }
  const contasList = Object.entries(contasMap);
  const valorAtualConta = selConta.value;
  selConta.innerHTML = '<option value="todas">Qualquer conta</option>' +
    '<option value="manual">Adicionadas manualmente</option>' +
    contasList.map(([id, nome]) => `<option value="${id}">${escapeHtml(nome)}</option>`).join('');
  if (valorAtualConta && [...selConta.options].some(o => o.value === valorAtualConta)) selConta.value = valorAtualConta;

  const catsPresentes = new Set(allTransactions.map(t => t.categoria || 'outros'));
  const valorAtualCat = selCat.value;
  const labels = _catLista.length ? Object.fromEntries(_catLista.map(c => [c.id, c.label])) : {};
  selCat.innerHTML = '<option value="todas">Qualquer categoria</option>' +
    [...catsPresentes].sort().map(c => `<option value="${c}">${escapeHtml(labels[c] || c)}</option>`).join('');
  if (valorAtualCat && [...selCat.options].some(o => o.value === valorAtualCat)) selCat.value = valorAtualCat;
}

function _dataMinima(periodo) {
  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  if (periodo === '7d') { const d = new Date(hoje); d.setDate(d.getDate() - 7); return d; }
  if (periodo === '30d') { const d = new Date(hoje); d.setDate(d.getDate() - 30); return d; }
  if (periodo === 'mes') return new Date(hoje.getFullYear(), hoje.getMonth(), 1);
  if (periodo === 'mes-passado') return new Date(hoje.getFullYear(), hoje.getMonth() - 1, 1);
  if (periodo === 'ano') return new Date(hoje.getFullYear(), 0, 1);
  return null;
}
function _dataMaxima(periodo) {
  const hoje = new Date();
  if (periodo === 'mes-passado') { const d = new Date(hoje.getFullYear(), hoje.getMonth(), 1); d.setMilliseconds(-1); return d; }
  return null;
}

function atualizarFinFiltros() { renderTransacoes(); }
function limparFinFiltros() {
  const busca = document.getElementById('fin-busca'); if (busca) busca.value = '';
  const p = document.getElementById('fin-periodo'); if (p) p.value = '30d';
  const c = document.getElementById('fin-conta'); if (c) c.value = 'todas';
  const cat = document.getElementById('fin-categoria'); if (cat) cat.value = 'todas';
  currentFinFilter = 'todas';
  document.querySelectorAll('.filter-btn[data-fin-filter]').forEach(b => b.classList.toggle('active', b.getAttribute('data-fin-filter') === 'todas'));
  renderTransacoes();
}

function renderTransacoes() {
  const lista = document.getElementById('lista-transacoes');
  const empty = document.getElementById('empty-financeiro');

  _preencherFinSelects();

  const busca = (document.getElementById('fin-busca')?.value || '').toLowerCase().trim();
  const periodo = document.getElementById('fin-periodo')?.value || '30d';
  const contaSel = document.getElementById('fin-conta')?.value || 'todas';
  const catSel = document.getElementById('fin-categoria')?.value || 'todas';
  const dtMin = _dataMinima(periodo);
  const dtMax = _dataMaxima(periodo);

  let filtered = [...allTransactions];
  if (currentFinFilter === 'entrada') filtered = filtered.filter(t => t.tipo === 'entrada');
  else if (currentFinFilter === 'saida') filtered = filtered.filter(t => t.tipo === 'saida');
  if (busca) filtered = filtered.filter(t => (t.descricao || '').toLowerCase().includes(busca));
  if (dtMin) filtered = filtered.filter(t => new Date(t.data) >= dtMin);
  if (dtMax) filtered = filtered.filter(t => new Date(t.data) <= dtMax);
  if (contaSel === 'manual') filtered = filtered.filter(t => !t.account_id);
  else if (contaSel !== 'todas') filtered = filtered.filter(t => t.account_id === contaSel);
  if (catSel !== 'todas') filtered = filtered.filter(t => (t.categoria || 'outros') === catSel);

  if (filtered.length === 0) {
    lista.innerHTML = '';
    empty.style.display = allTransactions.length === 0 ? 'block' : 'none';
    if (allTransactions.length > 0) {
      lista.innerHTML = `<div class="mini-item-empty">Nenhuma transação com esses filtros</div>`;
    }
  } else {
    empty.style.display = 'none';
    const catIcons = {
      alimentacao: '🍔', transporte: '🚗', moradia: '🏠', lazer: '🎮',
      saude: '💊', salario: '💼', freelance: '💻', outros: '📦'
    };
    // Total dos filtros aplicados (mostra no topo pra contextualizar o filtro)
    const entradasSel = filtered.filter(t => t.tipo === 'entrada').reduce((s, t) => s + parseFloat(t.valor), 0);
    const saidasSel = filtered.filter(t => t.tipo === 'saida').reduce((s, t) => s + parseFloat(t.valor), 0);
    const cabecalho = `
      <li style="background:rgba(255,255,255,0.03); border-radius:8px; padding:8px 12px; margin-bottom:6px; display:flex; justify-content:space-between; font-size:12px;">
        <span style="color:var(--text-muted);">${filtered.length} transação(ões) filtradas</span>
        <span>
          <span style="color:#3fb950;">+${formatBRL(entradasSel)}</span>
          <span style="color:var(--text-muted); margin:0 6px;">·</span>
          <span style="color:#f85149;">−${formatBRL(saidasSel)}</span>
          <span style="color:var(--text-muted); margin:0 6px;">·</span>
          <span style="font-weight:600;">${formatBRL(entradasSel - saidasSel)}</span>
        </span>
      </li>`;
    lista.innerHTML = cabecalho + filtered.map(t => {
      const simbolo = t.tipo === 'entrada' ? '+' : '-';
      const data = new Date(t.data).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' });
      const cat = t.categoria || 'outros';
      return `
        <li class="transaction-item ${t.tipo}">
          <div class="transaction-info">
            <div class="transaction-desc">${escapeHtml(t.descricao || '(sem descrição)')}</div>
            <div class="transaction-meta">
              <span class="transaction-cat" onclick="editarCategoriaTx('${t.id}','${cat}')" title="Alterar categoria só desta transação" style="cursor:pointer; text-decoration:underline dotted; text-decoration-color:var(--text-muted);">${catIcons[cat] || '📦'} ${cat}</span>
              <span>${data}</span>
            </div>
          </div>
          <span class="transaction-valor">${simbolo} ${formatBRL(Math.abs(t.valor))}</span>
          <button class="btn-delete" onclick="deletarTransacao('${t.id}')" title="Deletar">✕</button>
        </li>
      `;
    }).join('');
  }
}

async function adicionarTransacao() {
  const tipo = document.getElementById('tipo-transacao').value;
  const valor = parseFloat(document.getElementById('valor-transacao').value);
  const descricao = document.getElementById('desc-transacao').value.trim();
  const categoria = document.getElementById('categoria-transacao').value;

  if (!valor || valor <= 0) {
    toast('Digite um valor válido', 'error');
    return;
  }

  try {
    await fetch('/api/financeiro', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tipo, valor, descricao, categoria })
    });
    document.getElementById('valor-transacao').value = '';
    document.getElementById('desc-transacao').value = '';
    toast(`${tipo === 'entrada' ? 'Entrada' : 'Saída'} registrada`);
    carregarTransacoes();
  } catch (err) {
    toast('Erro ao adicionar', 'error');
  }
}

// Edita SÓ a categoria desta transação (não vira regra pras futuras)
async function editarCategoriaTx(id, atual) {
  await carregarCatLista();
  const r = await promptModal({
    titulo: 'Alterar categoria desta transação',
    campos: [{ name: 'cat', label: 'Nova categoria (só nesta transação, não vira regra)', valor: atual }]
  });
  if (!r) return;
  const nova = await _catResolver(r.cat);
  if (!nova) return;
  if (nova === atual) return;
  try {
    const res = await fetch(`/api/financeiro/${id}/categoria`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ categoria: nova })
    });
    if (!res.ok) { await toastErro(res, 'Erro ao alterar categoria'); return; }
    toast('Categoria alterada', 'success');
    carregarFinanceiro();
  } catch (e) { toast('Erro: ' + (e.message || 'sem conexão'), 'error'); }
}

async function deletarTransacao(id) {
  const ok = await confirmModal('Essa transação será removida.', 'Deletar transação?', '💸');
  if (!ok) return;
  try {
    await fetch(`/api/financeiro/${id}`, { method: 'DELETE' });
    toast('Transação removida', 'info');
    carregarTransacoes();
  } catch (err) {
    toast('Erro ao deletar', 'error');
  }
}

document.querySelectorAll('.filter-btn[data-fin-filter]').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.filter-btn[data-fin-filter]').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentFinFilter = btn.getAttribute('data-fin-filter');
    renderTransacoes();
  });
});

// =====================
//  ALARMES
// =====================
async function carregarAlarmes() {
  try {
    const res = await fetch('/api/alarmes');
    allAlarms = await res.json();
    renderAlarmes();
    atualizarDashboard();
  } catch (err) {
    console.error('Erro alarmes:', err);
  }
}

// Verificador de notificações (a cada minuto)
let ultimoVerificadorHora = null;
setInterval(() => {
  const agora = new Date();
  const horaAtual = `${String(agora.getHours()).padStart(2, '0')}:${String(agora.getMinutes()).padStart(2, '0')}`;

  // Verificar alarmes
  allAlarms.forEach(alarme => {
    if (alarme.ativo && alarme.hora === horaAtual && alarme.hora !== ultimoVerificadorHora) {
      notificarAlarme(alarme);
    }
  });

  ultimoVerificadorHora = horaAtual;
}, 30000); // A cada 30 segundos

function renderAlarmes() {
  const lista = document.getElementById('lista-alarmes');
  const empty = document.getElementById('empty-alarmes');

  if (allAlarms.length === 0) {
    lista.innerHTML = '';
    empty.style.display = 'block';
    return;
  }

  empty.style.display = 'none';
  const repLabels = {
    uma_vez: 'Uma vez', diario: 'Todo dia', semanal: 'Semanal', mensal: 'Mensal'
  };

  lista.innerHTML = allAlarms.map(a => `
    <li class="alarm-item">
      <div class="alarm-hora">${a.hora}</div>
      <div class="alarm-info">
        <div class="alarm-msg">${escapeHtml(a.mensagem)}</div>
        <div class="alarm-rep">${repLabels[a.repeticao] || 'Todo dia'}</div>
      </div>
      <button class="btn-delete" onclick="deletarAlarme('${a.id}')" title="Deletar">✕</button>
    </li>
  `).join('');
}

async function adicionarAlarme() {
  const hora = document.getElementById('hora-alarme').value;
  const mensagem = document.getElementById('msg-alarme').value.trim();
  const repeticao = document.getElementById('repeticao-alarme').value;

  if (!hora || !mensagem) {
    toast('Preencha hora e mensagem', 'error');
    return;
  }

  try {
    await fetch('/api/alarmes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hora, mensagem, repeticao })
    });
    document.getElementById('hora-alarme').value = '';
    document.getElementById('msg-alarme').value = '';
    toast('Alarme criado');
    carregarAlarmes();
  } catch (err) {
    toast('Erro ao adicionar', 'error');
  }
}

async function deletarAlarme(id) {
  const ok = await confirmModal('O alarme será removido permanentemente.', 'Deletar alarme?', '⏰');
  if (!ok) return;
  try {
    await fetch(`/api/alarmes/${id}`, { method: 'DELETE' });
    toast('Alarme removido', 'info');
    carregarAlarmes();
  } catch (err) {
    toast('Erro ao deletar', 'error');
  }
}

// =====================
//  STATS 30 DIAS
// =====================
async function carregarStats() {
  try {
    const res = await fetch('/api/tasks/stats');
    const data = await res.json();
    renderStats(data);
  } catch (err) {
    console.error('Erro stats:', err);
  }
}

function renderStats(data) {
  const r = data.resumo || {};
  document.getElementById('dash-streak').textContent = r.streak || 0;
  document.getElementById('stats-concluidas').textContent = r.totalConcluidas || 0;
  document.getElementById('stats-taxa').textContent = r.taxaMedia || 0;
  document.getElementById('stats-media').textContent = r.mediaPorDia || 0;
  document.getElementById('stats-melhor-taxa').textContent = `${Math.round(r.melhorDia?.taxa || 0)}%`;

  if (r.melhorDia?.data) {
    const d = new Date(r.melhorDia.data);
    document.getElementById('stats-melhor-dia').textContent =
      `Melhor: ${d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })}`;
  }

  // Gráfico de barras (30 dias)
  renderChartBars(data.historico || []);

  // Categorias
  renderHorizontalBars('chart-categorias', data.categorias || {}, 'cat');

  // Prioridades
  renderHorizontalBars('chart-prioridades', data.prioridades || {}, 'pri');
}

let _chartRange = 30;
let _chartHistorico = [];

function setChartRange(n) {
  _chartRange = n;
  document.querySelectorAll('.chart-range-btn').forEach(b => {
    b.classList.toggle('active', Number(b.dataset.range) === n);
  });
  if (_chartHistorico.length) renderChartBars(_chartHistorico);
}

function renderChartBars(historicoFull) {
  _chartHistorico = historicoFull;
  const historico = historicoFull.slice(-_chartRange);
  if (historico.length === 0) {
    const canvas = document.getElementById('chart-bars');
    if (canvas) {
      const container = canvas.parentElement;
      container.innerHTML = '<div class="mini-item-empty">Sem dados ainda</div>';
    }
    return;
  }

  // Preparar dados para o gráfico
  const labels = historico.map(h => {
    const data = new Date(h.data);
    return data.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' });
  });

  const concluidas = historico.map(h => parseInt(h.concluidas) || 0);

  const accent = '#26e0c8';

  // Destruir gráfico anterior se existir
  if (performanceChart) {
    performanceChart.destroy();
  }

  const ctx = document.getElementById('chart-bars').getContext('2d');

  // Gradient verde → transparente pra área embaixo da linha (estilo Kirvano)
  const gradient = ctx.createLinearGradient(0, 0, 0, 300);
  gradient.addColorStop(0, 'rgba(38, 224, 200, 0.25)');
  gradient.addColorStop(1, 'rgba(38, 224, 200, 0.0)');

  performanceChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: labels,
      datasets: [{
        label: 'Concluídas',
        data: concluidas,
        borderColor: accent,
        backgroundColor: gradient,
        borderWidth: 2,
        fill: true,
        tension: 0.4,
        pointRadius: 0,
        pointHoverRadius: 5,
        pointBackgroundColor: accent,
        pointBorderColor: '#0a0c10',
        pointBorderWidth: 2
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      layout: { padding: { top: 10, right: 8, bottom: 4, left: 8 } },
      interaction: { intersect: false, mode: 'index' },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: 'rgba(10, 12, 16, 0.95)',
          borderColor: 'rgba(255,255,255,0.08)',
          borderWidth: 1,
          titleColor: '#ffffff',
          titleFont: { size: 12, weight: '600' },
          bodyColor: accent,
          bodyFont: { size: 13, weight: '600' },
          padding: 10,
          displayColors: false,
          callbacks: {
            label: (ctx) => ctx.parsed.y + (ctx.parsed.y === 1 ? ' tarefa' : ' tarefas')
          }
        }
      },
      scales: {
        y: {
          beginAtZero: true,
          ticks: { display: false },
          grid: {
            color: 'rgba(255, 255, 255, 0.04)',
            drawBorder: false,
            lineWidth: 1,
            drawTicks: false
          },
          border: { display: false },
          // ~5 linhas horizontais
          suggestedMax: undefined,
          afterBuildTicks: (axis) => {
            const max = axis.max || 5;
            const step = Math.max(1, Math.ceil(max / 4));
            const ticks = [];
            for (let v = 0; v <= max; v += step) ticks.push({ value: v });
            axis.ticks = ticks;
          }
        },
        x: {
          ticks: {
            color: '#55555c',
            font: { size: 11, weight: '400' },
            maxRotation: 0,
            padding: 6,
            autoSkip: true,
            maxTicksLimit: 8
          },
          grid: { display: false, drawBorder: false },
          border: { display: false }
        }
      }
    }
  });
}

function alternarTipoGrafico(tipo) {
  // Atualizar variável de tipo
  currentChartType = tipo;

  // Atualizar botões ativos
  document.querySelectorAll('.chart-btn').forEach(btn => {
    btn.classList.remove('active');
  });
  document.querySelector(`.chart-btn[data-type="${tipo}"]`).classList.add('active');

  // Re-renderizar o gráfico com o novo tipo
  carregarStats();
}

function renderHorizontalBars(targetId, dataObj, type) {
  const container = document.getElementById(targetId);
  const entries = Object.entries(dataObj).filter(([_, v]) => v > 0).sort((a, b) => b[1] - a[1]);

  if (entries.length === 0) {
    container.innerHTML = '<div class="mini-item-empty">Sem dados</div>';
    return;
  }

  const max = Math.max(...entries.map(e => e[1]));

  const icons = {
    trabalho: '💼', pessoal: '🏠', saude: '💪', estudos: '📚', geral: '📌',
    alta: '🔴', media: '🟡', baixa: '🟢'
  };

  container.innerHTML = `<div class="bar-list">` + entries.map(([k, v]) => {
    const pct = (v / max) * 100;
    return `
      <div class="bar-row">
        <div class="bar-label">${icons[k] || ''} ${k}</div>
        <div class="bar-track">
          <div class="bar-fill bar-fill-${k}" style="width: ${pct}%">${v}</div>
        </div>
      </div>
    `;
  }).join('') + `</div>`;
}

// =====================
//  QUICK ADD MODAL
// =====================
function abrirQuickAddModal(tipo) {
  const overlay = document.createElement('div');
  overlay.className = 'custom-modal';
  overlay.style.display = 'flex';
  overlay.id = 'quick-add-overlay';

  let conteudo = '';
  if (tipo === 'tarefa') {
    conteudo = `
      <div class="modal-content">
        <div class="modal-header">
          <h2>➕ Adicionar Tarefa Rápida</h2>
          <button class="modal-close" onclick="fecharQuickAdd()">✕</button>
        </div>
        <div class="modal-body">
          <input type="text" id="quick-tarefa-titulo" placeholder="Título da tarefa..." autofocus>
          <select id="quick-tarefa-categoria">
            <option value="">Categoria</option>
            <option value="trabalho">💼 Trabalho</option>
            <option value="pessoal">🏠 Pessoal</option>
            <option value="saude">💪 Saúde</option>
            <option value="estudos">📚 Estudos</option>
            <option value="geral">📌 Geral</option>
          </select>
          <select id="quick-tarefa-prioridade">
            <option value="">Prioridade</option>
            <option value="alta">🔴 Alta</option>
            <option value="media">🟡 Média</option>
            <option value="baixa">🟢 Baixa</option>
          </select>
          <input type="time" id="quick-tarefa-hora" placeholder="Hora (opcional)">
        </div>
        <div class="modal-footer">
          <button class="btn-secondary" onclick="fecharQuickAdd()">Cancelar</button>
          <button class="btn-primary" onclick="salvarQuickTarefa()">Adicionar</button>
        </div>
      </div>
    `;
  } else if (tipo === 'transacao') {
    conteudo = `
      <div class="modal-content">
        <div class="modal-header">
          <h2>💰 Adicionar Transação Rápida</h2>
          <button class="modal-close" onclick="fecharQuickAdd()">✕</button>
        </div>
        <div class="modal-body">
          <input type="text" id="quick-trans-descricao" placeholder="Descrição..." autofocus>
          <input type="number" id="quick-trans-valor" placeholder="Valor" step="0.01" min="0">
          <select id="quick-trans-tipo">
            <option value="entrada">📈 Entrada</option>
            <option value="saida">📉 Saída</option>
          </select>
          <select id="quick-trans-categoria">
            <option value="">Categoria</option>
            <option value="alimentacao">🍕 Alimentação</option>
            <option value="transporte">🚗 Transporte</option>
            <option value="saude">💊 Saúde</option>
            <option value="lazer">🎮 Lazer</option>
            <option value="outro">📌 Outro</option>
          </select>
        </div>
        <div class="modal-footer">
          <button class="btn-secondary" onclick="fecharQuickAdd()">Cancelar</button>
          <button class="btn-primary" onclick="salvarQuickTransacao()">Adicionar</button>
        </div>
      </div>
    `;
  } else if (tipo === 'evento') {
    // Pré-definir data/hora como hoje, agora
    const agora = new Date();
    const dataHoje = agora.toISOString().slice(0, 16);

    conteudo = `
      <div class="modal-content">
        <div class="modal-header">
          <h2>📅 Adicionar Evento Rápido</h2>
          <button class="modal-close" onclick="fecharQuickAdd()">✕</button>
        </div>
        <div class="modal-body">
          <input type="text" id="quick-evento-titulo" placeholder="Título..." autofocus>
          <div class="date-time-group">
            <div class="date-time-input">
              <label>Data & Hora</label>
              <input type="datetime-local" id="quick-evento-data" value="${dataHoje}" class="date-time-input-field">
            </div>
          </div>
          <textarea id="quick-evento-descricao" placeholder="Descrição (opcional)" rows="3"></textarea>
        </div>
        <div class="modal-footer">
          <button class="btn-secondary" onclick="fecharQuickAdd()">Cancelar</button>
          <button class="btn-primary" onclick="salvarQuickEvento()">Adicionar</button>
        </div>
      </div>
    `;
  }

  overlay.innerHTML = conteudo;
  overlay.onclick = (e) => {
    if (e.target === overlay) fecharQuickAdd();
  };
  document.body.appendChild(overlay);
  setTimeout(() => {
    const input = overlay.querySelector('input[autofocus]');
    if (input) input.focus();
  }, 100);
}

function fecharQuickAdd() {
  const overlay = document.getElementById('quick-add-overlay');
  if (overlay) overlay.remove();
}

async function salvarQuickTarefa() {
  const titulo = document.getElementById('quick-tarefa-titulo').value;
  const categoria = document.getElementById('quick-tarefa-categoria').value || 'geral';
  const prioridade = document.getElementById('quick-tarefa-prioridade').value || 'media';
  const hora = document.getElementById('quick-tarefa-hora').value;

  if (!titulo.trim()) {
    toast('Título obrigatório', 'error');
    return;
  }

  const dataReset = hojeLocal();

  try {
    const res = await fetch('/api/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        titulo,
        descricao: '',
        prioridade,
        categoria,
        data_reset: dataReset,
        hora: hora || null
      })
    });

    if (res.ok) {
      toast('✅ Tarefa adicionada!', 'success');
      fecharQuickAdd();
      carregarTarefas();
    }
  } catch (err) {
    toast('Erro ao adicionar', 'error');
    console.error(err);
  }
}

async function salvarQuickTransacao() {
  const descricao = document.getElementById('quick-trans-descricao').value;
  const valor = document.getElementById('quick-trans-valor').value;
  const tipo = document.getElementById('quick-trans-tipo').value;
  const categoria = document.getElementById('quick-trans-categoria').value || 'outro';

  if (!descricao.trim() || !valor) {
    toast('Preencha descrição e valor', 'error');
    return;
  }

  try {
    const res = await fetch('/api/financeiro', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        descricao,
        valor: parseFloat(valor),
        tipo,
        categoria
      })
    });

    if (res.ok) {
      toast('Transação adicionada!', 'success');
      fecharQuickAdd();
      carregarTransacoes();
      atualizarDashboard();
    }
  } catch (err) {
    toast('Erro ao adicionar', 'error');
    console.error(err);
  }
}

async function salvarQuickEvento() {
  const titulo = document.getElementById('quick-evento-titulo').value;
  const data = document.getElementById('quick-evento-data').value;
  const descricao = document.getElementById('quick-evento-descricao').value || '';

  if (!titulo.trim() || !data) {
    toast('Título e data obrigatórios', 'error');
    return;
  }

  try {
    const res = await fetch('/api/eventos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        titulo,
        descricao,
        data_hora: new Date(data).toISOString()
      })
    });

    if (res.ok) {
      toast('Evento adicionado!', 'success');
      fecharQuickAdd();
      carregarEventos();
    }
  } catch (err) {
    toast('Erro ao adicionar', 'error');
    console.error(err);
  }
}

// =====================
//  TIMELINE DO DIA
// =====================
function renderTimeline() {
  const hoje = hojeLocal();
  const tarefasHoje = allTasks.filter(t => {
    if (!t.data_reset) return false;
    return t.data_reset.split('T')[0] === hoje;
  });

  const periodos = {
    'timeline-tasks-manha': [],
    'timeline-tasks-tarde': [],
    'timeline-tasks-noite': [],
    'timeline-tasks-sem-hora': []
  };

  tarefasHoje.forEach(t => {
    if (!t.hora) {
      periodos['timeline-tasks-sem-hora'].push(t);
      return;
    }

    const [horas] = t.hora.split(':').map(Number);
    if (horas >= 5 && horas < 12) {
      periodos['timeline-tasks-manha'].push(t);
    } else if (horas >= 12 && horas < 18) {
      periodos['timeline-tasks-tarde'].push(t);
    } else {
      periodos['timeline-tasks-noite'].push(t);
    }
  });

  Object.entries(periodos).forEach(([containerId, tarefas]) => {
    const container = document.getElementById(containerId);
    if (!container) return;

    if (tarefas.length === 0) {
      container.innerHTML = '<div class="timeline-empty">Nenhuma tarefa</div>';
      return;
    }

    container.innerHTML = tarefas.map(t => `
      <div class="timeline-task ${t.concluida ? 'completed' : ''}" onclick="alternarTarefa('${t.id}')">
        <div class="timeline-task-check"></div>
        <span>${t.titulo}</span>
        ${t.hora ? `<span style="margin-left: auto; color: var(--text-muted); font-size: 12px;">${t.hora}</span>` : ''}
      </div>
    `).join('');
  });
}

// =====================
//  TAREFA ACTIONS
// =====================
async function alternarTarefa(id) {
  const tarefa = allTasks.find(t => t.id === id);
  if (!tarefa) return;

  try {
    const res = await fetch(`/api/tasks/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        concluida: !tarefa.concluida
      })
    });

    if (res.ok) {
      tarefa.concluida = !tarefa.concluida;

      // Celebrar se completou a tarefa
      if (tarefa.concluida) {
        celebrarTarefa();

        // Verificar se atingiu meta do dia
        const hoje = hojeLocal();
        const tarefasHoje = allTasks.filter(t => {
          if (!t.data_reset) return false;
          return t.data_reset.split('T')[0] === hoje;
        });
        const metaDia = 5; // 5 tarefas é a meta
        const concluidas = tarefasHoje.filter(t => t.concluida).length;

        if (concluidas === metaDia) {
          celebrarMeta();
        }
      }

      renderTarefas();
      renderTarefasAmanhaPage();
      renderTimeline();
      renderHistorico();
      atualizarDashboard();
    }
  } catch (err) {
    console.error('Erro ao alternar tarefa:', err);
  }
}

// =====================
//  NOTIFICAÇÕES NATIVAS
// =====================
function enviarNotificacao(titulo, opcoes = {}) {
  if (!('Notification' in window)) {
    return;
  }

  if (Notification.permission !== 'granted') {
    return;
  }

  const notifOpcoes = {
    icon: '/favicon.ico',
    badge: '/favicon.ico',
    ...opcoes
  };

  new Notification(titulo, notifOpcoes);
}

function notificarAlarme(alarme) {
  if (!notificacaoPermitida) return;

  enviarNotificacao('⏰ Alarme!', {
    body: alarme.mensagem,
    tag: 'alarme-' + alarme.id,
    requireInteraction: true
  });
}

function notificarTarefaVencida(tarefa) {
  if (!notificacaoPermitida) return;

  enviarNotificacao('📝 Tarefa vencida', {
    body: tarefa.titulo,
    tag: 'tarefa-' + tarefa.id
  });
}

function notificarEventoProximo(evento) {
  if (!notificacaoPermitida) return;

  const data = new Date(evento.data_hora);
  const horaStr = data.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

  enviarNotificacao('Evento em breve', {
    body: `${evento.titulo} às ${horaStr}`,
    tag: 'evento-' + evento.id
  });
}

// =====================
//  DASHBOARD
// =====================
function atualizarDashboard() {
  // Tarefas de HOJE apenas (corrigido: antes contava TODAS)
  const hoje = hojeLocal();
  const tarefasHoje = allTasks.filter(t => t.data_reset && t.data_reset.split('T')[0] === hoje);
  const total = tarefasHoje.length;
  const concluidas = tarefasHoje.filter(t => t.concluida).length;
  document.getElementById('dash-tarefas-total').textContent = total;
  document.getElementById('dash-tarefas-concluidas').textContent = concluidas;
  const pct = total > 0 ? (concluidas / total) * 100 : 0;
  document.getElementById('dash-tarefas-bar').style.width = `${pct}%`;

  // Financeiro
  let entradas = 0, saidas = 0;
  allTransactions.forEach(t => {
    if (t.tipo === 'entrada') entradas += parseFloat(t.valor);
    else saidas += parseFloat(t.valor);
  });
  const saldo = entradas - saidas;
  document.getElementById('dash-saldo').textContent = formatBRL(saldo);
  document.getElementById('dash-entradas').textContent = formatBRL(entradas).replace(/^R\$\s*/, '');
  document.getElementById('dash-saidas').textContent = formatBRL(saidas).replace(/^R\$\s*/, '');

  // Alarmes
  const alarmesAtivos = allAlarms.filter(a => a.ativo !== false).length;
  document.getElementById('dash-alarmes').textContent = alarmesAtivos;
  const proximoAlarme = encontrarProximoAlarme();
  document.getElementById('dash-proximo-alarme').textContent =
    proximoAlarme ? `Próximo: ${proximoAlarme.hora}` : 'Nenhum agendado';

  // Streak vem das stats — atualizado via carregarStats()

  // Top tarefas pendentes
  const pendentes = allTasks.filter(t => !t.concluida).slice(0, 4);
  const tarefasList = document.getElementById('dash-tarefas-list');
  if (pendentes.length === 0) {
    tarefasList.innerHTML = `<div class="mini-item-empty">Tudo em dia! 🎉</div>`;
  } else {
    tarefasList.innerHTML = pendentes.map(t => `
      <div class="mini-item">
        <span>${escapeHtml(t.titulo)}</span>
        <span class="task-badge badge-${t.prioridade || 'media'}">${t.prioridade || 'media'}</span>
      </div>
    `).join('');
  }

  // Últimas transações
  const ultimas = allTransactions.slice(0, 4);
  const transList = document.getElementById('dash-transacoes-list');
  if (ultimas.length === 0) {
    transList.innerHTML = `<div class="mini-item-empty">Nenhuma transação ainda</div>`;
  } else {
    transList.innerHTML = ultimas.map(t => {
      const simbolo = t.tipo === 'entrada' ? '+' : '-';
      const color = t.tipo === 'entrada' ? 'mini-up' : 'mini-down';
      return `
        <div class="mini-item">
          <span>${escapeHtml(t.descricao || '(sem descrição)')}</span>
          <span class="${color}">${simbolo} ${formatBRL(Math.abs(t.valor))}</span>
        </div>
      `;
    }).join('');
  }

  // Saldo real das contas conectadas tem prioridade sobre o fluxo de transações
  if (typeof aplicarSaldosReais === 'function') aplicarSaldosReais();

}

function encontrarProximoAlarme() {
  if (allAlarms.length === 0) return null;
  const agora = new Date();
  const horaAtual = agora.getHours() * 60 + agora.getMinutes();
  const futuros = allAlarms
    .filter(a => a.ativo !== false)
    .map(a => {
      const [h, m] = a.hora.split(':').map(Number);
      const minutos = h * 60 + m;
      return { ...a, minutos };
    })
    .filter(a => a.minutos > horaAtual)
    .sort((a, b) => a.minutos - b.minutos);
  return futuros[0] || allAlarms.filter(a => a.ativo !== false).sort((a,b) => a.hora.localeCompare(b.hora))[0];
}

// =====================
//  HELPERS
// =====================
function formatBRL(v) {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL'
  }).format(parseFloat(v) || 0);
}

function escapeHtml(s) {
  if (!s) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// =====================
//  TAREFAS RECORRENTES
// =====================
let allRecorrentes = [];

async function carregarRecorrentes() {
  try {
    const res = await fetch('/api/recorrentes');
    allRecorrentes = await res.json();
    renderRecorrentes();
  } catch (err) { console.error(err); }
}

function renderRecorrentes() {
  const lista = document.getElementById('lista-recorrentes');
  const empty = document.getElementById('empty-recorrentes');

  if (allRecorrentes.length === 0) {
    lista.innerHTML = '';
    empty.style.display = 'block';
    return;
  }
  empty.style.display = 'none';

  const dias = ['D','S','T','Q','Q','S','S'];
  const catIcons = { geral:'📌', trabalho:'💼', estudos:'📚', saude:'💪', pessoal:'🏠' };

  lista.innerHTML = allRecorrentes.map(r => {
    const diasAtivos = (r.dias_semana || '').split(',');
    const diasShow = dias.map((d, i) => {
      const ativo = diasAtivos.includes(i.toString());
      return `<span style="opacity:${ativo ? 1 : 0.25}; font-weight:${ativo ? 700 : 400}; color:${ativo ? 'var(--accent)' : 'var(--text-muted)'};">${d}</span>`;
    }).join(' ');

    return `
      <li class="task-item ${r.ativa ? '' : 'completed'}">
        <div class="task-content">
          <div class="task-text">🔁 ${escapeHtml(r.titulo)}</div>
          <div class="task-meta">
            <span class="task-badge badge-${r.prioridade}">${r.prioridade}</span>
            <span class="task-cat">${catIcons[r.categoria] || '📌'} ${r.categoria}</span>
            <span style="font-size: 11px; letter-spacing: 2px;">${diasShow}</span>
          </div>
        </div>
        <button class="alarm-toggle ${r.ativa ? 'active' : ''}" onclick="toggleRecorrente('${r.id}', ${!r.ativa})" title="${r.ativa ? 'Pausar' : 'Ativar'}"></button>
        <button class="btn-delete" onclick="deletarRecorrente('${r.id}')" title="Deletar">✕</button>
      </li>
    `;
  }).join('');
}

async function adicionarRecorrente() {
  const titulo = document.getElementById('rec-titulo').value.trim();
  const prioridade = document.getElementById('rec-prioridade').value;
  const categoria = document.getElementById('rec-categoria').value;

  if (!titulo) { toast('Digite o nome da tarefa', 'error'); return; }

  const dias = Array.from(document.querySelectorAll('.dia-btn.active'))
    .map(b => b.getAttribute('data-dia')).join(',');

  try {
    await fetch('/api/recorrentes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ titulo, prioridade, categoria, frequencia: 'diario', dias_semana: dias })
    });
    document.getElementById('rec-titulo').value = '';
    toast('Tarefa recorrente criada 🔁');
    carregarRecorrentes();
  } catch (err) { toast('Erro ao adicionar', 'error'); }
}

async function toggleRecorrente(id, ativa) {
  await fetch(`/api/recorrentes/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ativa })
  });
  toast(ativa ? 'Recorrente ativada' : 'Recorrente pausada', 'info');
  carregarRecorrentes();
}

async function deletarRecorrente(id) {
  const ok = await confirmModal('A tarefa não será mais recriada automaticamente.', 'Deletar recorrente?', '🔁');
  if (!ok) return;
  await fetch(`/api/recorrentes/${id}`, { method: 'DELETE' });
  toast('Recorrente removida', 'info');
  carregarRecorrentes();
}

// Toggle dos dias da semana
document.querySelectorAll('.dia-btn').forEach(btn => {
  btn.addEventListener('click', () => btn.classList.toggle('active'));
});

// =====================
//  CALENDÁRIO
// =====================
let calMesAtual = new Date();
let calDiaSelecionado = null;
let allEventos = [];

async function carregarEventos() {
  try {
    const mes = `${calMesAtual.getFullYear()}-${String(calMesAtual.getMonth() + 1).padStart(2, '0')}`;
    const res = await fetch(`/api/eventos?mes=${mes}`);
    allEventos = await res.json();
    renderCalendario();
  } catch (err) { console.error(err); }
}

function renderCalendario() {
  const grid = document.getElementById('cal-grid');
  const titulo = document.getElementById('cal-titulo');
  const ano = calMesAtual.getFullYear();
  const mes = calMesAtual.getMonth();

  titulo.textContent = calMesAtual.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });

  const primeiroDia = new Date(ano, mes, 1);
  const ultimoDia = new Date(ano, mes + 1, 0);
  const diaSemanaInicio = primeiroDia.getDay();
  const totalDias = ultimoDia.getDate();
  const hoje = new Date();
  const ehHojeMes = hoje.getFullYear() === ano && hoje.getMonth() === mes;

  // Eventos por dia
  const eventosPorDia = {};
  allEventos.forEach(e => {
    const dia = new Date(e.data).getDate();
    if (!eventosPorDia[dia]) eventosPorDia[dia] = [];
    eventosPorDia[dia].push(e);
  });

  let html = '';

  // Dias do mês anterior
  for (let i = diaSemanaInicio - 1; i >= 0; i--) {
    const d = new Date(ano, mes, -i);
    html += `<div class="cal-day other-month"><span class="cal-day-num">${d.getDate()}</span></div>`;
  }

  // Dias do mês atual
  for (let d = 1; d <= totalDias; d++) {
    const ehHoje = ehHojeMes && hoje.getDate() === d;
    const dataStr = `${ano}-${String(mes + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const selecionado = calDiaSelecionado === dataStr;
    const eventos = eventosPorDia[d] || [];

    const eventosHtml = eventos.slice(0, 3).map(e =>
      `<div class="cal-event cal-event-${e.cor || 'blue'}" title="${escapeHtml(e.titulo)}">${escapeHtml(e.titulo)}</div>`
    ).join('');
    const mais = eventos.length > 3 ? `<div class="cal-event-more">+${eventos.length - 3} mais</div>` : '';

    html += `
      <div class="cal-day ${ehHoje ? 'today' : ''} ${selecionado ? 'selected' : ''}"
           onclick="selecionarDia('${dataStr}')"
           ondblclick="abrirEventoModal('${dataStr}')">
        <span class="cal-day-num">${d}</span>
        <div class="cal-events">${eventosHtml}${mais}</div>
      </div>
    `;
  }

  // Completar grid (próximo mês)
  const totalSlots = diaSemanaInicio + totalDias;
  const slotsRestantes = totalSlots % 7 === 0 ? 0 : 7 - (totalSlots % 7);
  for (let i = 1; i <= slotsRestantes; i++) {
    html += `<div class="cal-day other-month"><span class="cal-day-num">${i}</span></div>`;
  }

  grid.innerHTML = html;
  if (calDiaSelecionado) exibirDetalhesDodia(calDiaSelecionado);
}

function navegarMes(delta) {
  calMesAtual.setMonth(calMesAtual.getMonth() + delta);
  carregarEventos();
}

function selecionarDia(dataStr) {
  calDiaSelecionado = dataStr;
  renderCalendario();
  exibirDetalhesDodia(dataStr);
}

function renderEventosDoDia() {
  if (!calDiaSelecionado) return;
  const container = document.getElementById('eventos-do-dia');
  const tituloEl = document.getElementById('eventos-titulo');
  const lista = document.getElementById('eventos-lista');

  const data = new Date(calDiaSelecionado + 'T12:00:00');
  tituloEl.textContent = `📌 ${data.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' })}`;

  const eventosDia = allEventos.filter(e => {
    const d = new Date(e.data).toISOString().split('T')[0];
    return d === calDiaSelecionado;
  });

  if (eventosDia.length === 0) {
    lista.innerHTML = `
      <div class="mini-item-empty">
        Nenhum evento nesse dia
        <br><br>
        <button class="btn-primary" onclick="abrirEventoModal('${calDiaSelecionado}')">+ Adicionar evento</button>
      </div>
    `;
  } else {
    lista.innerHTML = eventosDia.map(e => `
      <div class="evento-row ${e.cor || 'blue'}">
        <div class="evento-hora-box">${e.hora || '--:--'}</div>
        <div class="evento-info">
          <div class="evento-titulo">${escapeHtml(e.titulo)}</div>
          ${e.descricao ? `<div class="evento-desc">${escapeHtml(e.descricao)}</div>` : ''}
        </div>
        <button class="btn-delete" onclick="deletarEvento('${e.id}')">✕</button>
      </div>
    `).join('');
  }
  container.style.display = 'block';
}

function abrirEventoModal(dataStr = null) {
  document.getElementById('evento-modal').style.display = 'flex';
  document.getElementById('evento-titulo').value = '';
  document.getElementById('evento-descricao').value = '';
  document.getElementById('evento-hora').value = '';
  document.getElementById('evento-data').value = dataStr || hojeLocal();
  setTimeout(() => document.getElementById('evento-titulo').focus(), 100);
}

function fecharEventoModal() {
  document.getElementById('evento-modal').style.display = 'none';
}

async function salvarEvento() {
  const titulo = document.getElementById('evento-titulo').value.trim();
  const descricao = document.getElementById('evento-descricao').value.trim();
  const data = document.getElementById('evento-data').value;
  const hora = document.getElementById('evento-hora').value;
  const tipo = document.getElementById('evento-tipo').value;
  const cor = document.getElementById('evento-cor').value;

  if (!titulo || !data) { toast('Título e data obrigatórios', 'error'); return; }

  try {
    await fetch('/api/eventos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ titulo, descricao, data, hora, tipo, cor })
    });
    fecharEventoModal();
    toast('Evento criado 📅');
    carregarEventos();
  } catch (err) { toast('Erro ao salvar', 'error'); }
}

async function deletarEvento(id) {
  const ok = await confirmModal('Esse evento será removido.', 'Deletar evento?', '📅');
  if (!ok) return;
  await fetch(`/api/eventos/${id}`, { method: 'DELETE' });
  toast('Evento removido', 'info');
  carregarEventos();
}

// Fechar modal clicando fora
document.getElementById('evento-modal')?.addEventListener('click', (e) => {
  if (e.target.id === 'evento-modal') fecharEventoModal();
});

// =====================
//  KEYBOARD SHORTCUTS
// =====================
document.addEventListener('keydown', (e) => {
  // Ctrl/Cmd + 1-6 troca de aba
  if ((e.ctrlKey || e.metaKey) && e.key >= '1' && e.key <= '6') {
    e.preventDefault();
    const tabs = ['dashboard', 'rotina', 'recorrentes', 'calendario', 'financeiro', 'alarmes'];
    trocarAba(tabs[parseInt(e.key) - 1]);
  }
});

// Enter em inputs
document.getElementById('nova-tarefa')?.addEventListener('keypress', e => {
  if (e.key === 'Enter') adicionarTarefa();
});
document.getElementById('msg-alarme')?.addEventListener('keypress', e => {
  if (e.key === 'Enter') adicionarAlarme();
});
document.getElementById('desc-transacao')?.addEventListener('keypress', e => {
  if (e.key === 'Enter') adicionarTransacao();
});

// =====================
//  INIT
// =====================
window.addEventListener('load', () => {
  document.getElementById('saudacao').textContent = saudacao();
  atualizarData();
  atualizarHora();
  setInterval(atualizarHora, 1000);

  carregarTarefas();
  carregarTransacoes();
  carregarAlarmes();
  carregarStats();
  carregarRecorrentes();
  carregarEventos();

  // Sync do Open Finance ao abrir o app (1x/dia via localStorage lock)
  // Pega transações novas da Nubank sem esperar o cron 6/14h30/20h
  try {
    const ultimo = Number(localStorage.getItem('of_last_open_sync') || 0);
    const umDia = 20 * 60 * 60 * 1000; // 20h — pra sobrepor com o cron
    if (Date.now() - ultimo > umDia) {
      localStorage.setItem('of_last_open_sync', String(Date.now()));
      fetch('/api/openfinance/sync', { method: 'POST' })
        .then(r => r.ok ? r.json() : null)
        .then(d => { if (d && d.importadas > 0) carregarTransacoes(); })
        .catch(() => {});
    }
  } catch (e) { /* localStorage indisponível */ }

  conectarWebSocket();

  // Refresh a cada 30s
  setInterval(() => {
    carregarTarefas();
    carregarTransacoes();
    carregarAlarmes();
  }, 30000);

  // Stats a cada 60s
  setInterval(carregarStats, 60000);

  // Definir data padrão no input como hoje (local)
  const dataInput = document.getElementById('data-tarefa');
  if (dataInput) dataInput.value = hojeLocal();

  // Atualizar data da página de amanhã
  const amanhaDate = new Date();
  amanhaDate.setDate(amanhaDate.getDate() + 1);
  const amanhaStr = amanhaDate.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' });
  const amanhaPageLabel = document.getElementById('amanha-data');
  if (amanhaPageLabel) amanhaPageLabel.textContent = amanhaStr.charAt(0).toUpperCase() + amanhaStr.slice(1);
});

// =====================
// TAREFAS - ABAS (Hoje/Amanhã)
// =====================
let abaAtualTarefas = 'hoje';

// Função desativada - abas unificadas
function alternarAbasTarefas(aba) {
  // Agora mostra ambas simultaneamente
  renderTarefasAmanha();
}

function renderTarefasAmanha() {
  const amanhaStr = amanhaLocal();

  const tarefas = allTasks
    .filter(t => {
      if (!t.data_reset) return false;
      return t.data_reset.split('T')[0] === amanhaStr;
    })
    .sort((a, b) => {
      const horaA = a.hora || '99:99';
      const horaB = b.hora || '99:99';
      return horaA.localeCompare(horaB);
    });



  const lista = document.getElementById('lista-tarefas-amanha');
  const empty = document.getElementById('empty-tarefas-amanha');

  if (tarefas.length === 0) {
    lista.innerHTML = '';
    empty.style.display = 'block';
  } else {
    empty.style.display = 'none';
    lista.innerHTML = tarefas.map(task => {
      const prioridade = task.prioridade || 'media';
      const categoria = task.categoria || 'geral';
      const catIcons = {
        geral: '📌', trabalho: '💼', estudos: '📚', saude: '💪', pessoal: '🏠'
      };
      const horaHtml = task.hora ? `<span class="task-hora">⏰ ${task.hora}</span>` : '';
      return `
        <li class="task-item ${task.concluida ? 'completed' : ''}">
          <input type="checkbox" class="task-check" ${task.concluida ? 'checked' : ''}
                 onchange="marcarTarefa('${task.id}', this.checked)">
          <div class="task-content">
            <div class="task-text">${escapeHtml(task.titulo)}</div>
            <div class="task-meta">
              ${horaHtml}
              <span class="task-badge badge-${prioridade}">${prioridade}</span>
              <span class="task-cat">${catIcons[categoria] || '📌'} ${categoria}</span>
            </div>
          </div>
          <button class="btn-delete" onclick="deletarTarefa('${task.id}')" title="Deletar">✕</button>
        </li>
      `;
    }).join('');
  }
}

// =====================
// CALENDÁRIO - DETALHES DO DIA
// =====================
let calDiaDetalhes = null;

function exibirDetalhesDodia(dataStr) {
  calDiaDetalhes = dataStr;
  const detalhesDiv = document.getElementById('cal-detalhes-dia');

  const data = new Date(dataStr + 'T12:00:00');
  const titulo = data.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' });
  document.getElementById('detalhes-titulo').textContent = titulo.charAt(0).toUpperCase() + titulo.slice(1);

  // Filtrar tarefas do dia
  const tarefasDoDia = allTasks.filter(t => {
    if (!t.data_reset) return false;
    return t.data_reset.split('T')[0] === dataStr;
  });

  // Filtrar eventos do dia
  const eventosDoDia = allEventos.filter(e => e.data === dataStr);

  // Renderizar tarefas (ordenadas por hora)
  const tarefasOrdenadas = [...tarefasDoDia].sort((a, b) => {
    const horaA = a.hora || '99:99';
    const horaB = b.hora || '99:99';
    return horaA.localeCompare(horaB);
  });

  const tarefasHtml = tarefasOrdenadas.length > 0
    ? tarefasOrdenadas.map(t => {
        const catIcons = {
          geral: '📌', trabalho: '💼', estudos: '📚', saude: '💪', pessoal: '🏠'
        };
        const horaHtml = t.hora ? `⏰ ${t.hora} • ` : '';
        return `
          <div class="detalhes-item" style="border-left-color: ${t.concluida ? '#10b981' : t.prioridade === 'alta' ? '#ef4444' : t.prioridade === 'media' ? '#f59e0b' : '#10b981'};">
            <div class="detalhes-item-titulo" style="text-decoration: ${t.concluida ? 'line-through' : 'none'};">${escapeHtml(t.titulo)}</div>
            <div class="detalhes-item-meta">${horaHtml}${catIcons[t.categoria] || '📌'} ${t.categoria} • ${t.prioridade}</div>
          </div>
        `;
      }).join('')
    : '<div class="detalhes-empty">Nenhuma tarefa</div>';

  // Renderizar eventos
  const eventosHtml = eventosDoDia.length > 0
    ? eventosDoDia.map(e => {
        const hora = e.hora ? ` às ${e.hora}` : '';
        return `
          <div class="detalhes-item" style="border-left-color: ${e.cor === 'blue' ? '#3b82f6' : e.cor === 'green' ? '#10b981' : e.cor === 'orange' ? '#f59e0b' : e.cor === 'red' ? '#ef4444' : '#8b5cf6'};">
            <div class="detalhes-item-titulo">${escapeHtml(e.titulo)}</div>
            <div class="detalhes-item-meta">${e.tipo}${hora}</div>
          </div>
        `;
      }).join('')
    : '<div class="detalhes-empty">Nenhum evento</div>';

  document.getElementById('detalhes-tarefas').innerHTML = tarefasHtml;
  document.getElementById('detalhes-eventos').innerHTML = eventosHtml;
  document.getElementById('tarefas-count').textContent = tarefasDoDia.length;
  document.getElementById('eventos-count').textContent = eventosDoDia.length;

  // Feriados e aniversários (placeholders por enquanto)
  document.getElementById('detalhes-feriados').innerHTML = '<div class="detalhes-empty">Nenhum feriado</div>';
  document.getElementById('detalhes-aniversarios').innerHTML = '<div class="detalhes-empty">Nenhum aniversário</div>';
  document.getElementById('feriados-count').textContent = '0';
  document.getElementById('aniversarios-count').textContent = '0';

  detalhesDiv.style.display = 'block';
}

function fecharDetalhes() {
  document.getElementById('cal-detalhes-dia').style.display = 'none';
  calDiaDetalhes = null;
}

// =====================
// PÁGINA AMANHÃ
// =====================
let currentAmanhaFilter = 'todas';

function renderTarefasAmanhaPage() {
  const amanhaStr = amanhaLocal();

  // Filtrar tarefas de amanhã
  let tarefas = allTasks.filter(t => {
    if (!t.data_reset) return false;
    return t.data_reset.split('T')[0] === amanhaStr;
  });

  // Aplicar filtros
  if (currentAmanhaFilter === 'pendentes') {
    tarefas = tarefas.filter(t => !t.concluida);
  } else if (currentAmanhaFilter === 'concluidas') {
    tarefas = tarefas.filter(t => t.concluida);
  } else if (currentAmanhaFilter === 'alta') {
    tarefas = tarefas.filter(t => t.prioridade === 'alta');
  }

  // Ordenar por hora
  tarefas.sort((a, b) => {
    const horaA = a.hora || '99:99';
    const horaB = b.hora || '99:99';
    return horaA.localeCompare(horaB);
  });

  const lista = document.getElementById('lista-tarefas-amanha-page');
  const empty = document.getElementById('empty-tarefas-amanha-page');
  if (!lista || !empty) return; // aba/elementos removidos

  if (tarefas.length === 0) {
    lista.innerHTML = '';
    const tarefasAmanha = allTasks.filter(t => t.data_reset && t.data_reset.split('T')[0] === amanhaLocal());
    empty.style.display = tarefasAmanha.length === 0 ? 'block' : 'none';
    if (tarefasAmanha.length > 0) {
      lista.innerHTML = `<div class="mini-item-empty">Nenhuma tarefa nesse filtro</div>`;
    }
  } else {
    empty.style.display = 'none';
    lista.innerHTML = tarefas.map(task => {
      const prioridade = task.prioridade || 'media';
      const categoria = task.categoria || 'geral';
      const catIcons = {
        geral: '📌', trabalho: '💼', estudos: '📚', saude: '💪', pessoal: '🏠'
      };
      const horaHtml = task.hora ? `<span class="task-hora">⏰ ${task.hora}</span>` : '';
      return `
        <li class="task-item ${task.concluida ? 'completed' : ''}">
          <input type="checkbox" class="task-check" ${task.concluida ? 'checked' : ''}
                 onchange="marcarTarefa('${task.id}', this.checked)">
          <div class="task-content">
            <div class="task-text">${escapeHtml(task.titulo)}</div>
            <div class="task-meta">
              ${horaHtml}
              <span class="task-badge badge-${prioridade}">${prioridade}</span>
              <span class="task-cat">${catIcons[categoria] || '📌'} ${categoria}</span>
            </div>
          </div>
          <button class="btn-delete" onclick="deletarTarefa('${task.id}')" title="Deletar">✕</button>
        </li>
      `;
    }).join('');
  }

  const tarefasAmanha = allTasks.filter(t => t.data_reset && t.data_reset.split('T')[0] === amanhaLocal());
  document.getElementById('total-amanha').textContent = tarefasAmanha.length;
  document.getElementById('concluidas-amanha').textContent = tarefasAmanha.filter(t => t.concluida).length;
}

async function adicionarTarefaAmanha() {
  const input = document.getElementById('nova-tarefa-amanha');
  const titulo = input.value.trim();
  const prioridade = document.getElementById('prioridade-tarefa-amanha').value;
  const categoria = document.getElementById('categoria-tarefa-amanha').value;
  const horaTarefa = document.getElementById('hora-tarefa-amanha').value;

  if (!titulo) {
    toast('Digite o nome da tarefa', 'error');
    return;
  }

  const dataReset = amanhaLocal();

  try {
    const res = await fetch('/api/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ titulo, prioridade, categoria, data_reset: dataReset, hora: horaTarefa || null })
    });

    if (!res.ok) {
      const erro = await res.text();
      toast('Erro ao adicionar: ' + erro, 'error');
      return;
    }

    await res.json();

    input.value = '';
    document.getElementById('hora-tarefa-amanha').value = '';
    toast('Tarefa adicionada para amanhã');

    carregarTarefas();
  } catch (err) {
    console.error('[DEBUG] Erro catch:', err);
    toast('Erro: ' + err.message, 'error');
  }
}

function filtrarAmanhaFilter(filtro) {
  currentAmanhaFilter = filtro;

  // Atualizar botões ativos
  document.querySelectorAll('[data-amanha-filter]').forEach(btn => {
    btn.classList.toggle('active', btn.getAttribute('data-amanha-filter') === filtro);
  });

  renderTarefasAmanhaPage();
}

// =====================
//  HISTÓRICO & HEATMAP
// =====================

function renderHistorico() {
  // Calcular estatísticas
  const totalTarefas = allTasks.length;
  const concluidas = allTasks.filter(t => t.concluida).length;
  const taxaConc = totalTarefas > 0 ? Math.round((concluidas / totalTarefas) * 100) : 0;

  document.getElementById('hist-total-tarefas').textContent = totalTarefas;
  document.getElementById('hist-taxa-conclusao').textContent = taxaConc + '%';

  // Melhor dia (maior número de tarefas concluídas)
  const porDia = {};
  allTasks.forEach(t => {
    if (!t.data_reset) return;
    const dia = t.data_reset.split('T')[0];
    if (!porDia[dia]) porDia[dia] = { total: 0, concluidas: 0 };
    porDia[dia].total++;
    if (t.concluida) porDia[dia].concluidas++;
  });

  let melhorDia = 0;
  Object.values(porDia).forEach(d => {
    if (d.concluidas > melhorDia) melhorDia = d.concluidas;
  });
  document.getElementById('hist-melhor-dia').textContent = melhorDia;

  // Média diária
  const dias = Object.keys(porDia).length;
  const mediaDiaria = dias > 0 ? Math.round(concluidas / dias) : 0;
  document.getElementById('hist-media-diaria').textContent = mediaDiaria;

  // Render heatmap
  renderHeatmap(porDia);

  // Render tendências
  renderTendencias(porDia);

  // Render histórico de concluídas
  const concluiDasRecentemente = allTasks
    .filter(t => t.concluida)
    .sort((a, b) => new Date(b.updated_at || b.data_reset) - new Date(a.updated_at || a.data_reset))
    .slice(0, 10);

  const container = document.getElementById('historico-concluidas');
  if (concluiDasRecentemente.length === 0) {
    container.innerHTML = '<div class="mini-item-empty">Nenhuma tarefa concluída ainda</div>';
  } else {
    container.innerHTML = concluiDasRecentemente.map(t => {
      const data = new Date(t.updated_at || t.data_reset);
      const dataStr = data.toLocaleDateString('pt-BR', { day: 'numeric', month: 'short' });
      return `
        <div class="mini-item" style="opacity: 0.8;">
          <span>✅ ${t.titulo}</span>
          <span style="color: var(--text-muted); font-size: 12px;">${dataStr}</span>
        </div>
      `;
    }).join('');
  }
}

function renderHeatmap(porDia) {
  const container = document.getElementById('heatmap-container');
  const hoje = new Date();
  const um_ano_atras = new Date(hoje.getFullYear() - 1, hoje.getMonth(), hoje.getDate());

  let html = '<div class="heatmap">';

  // Gerar células para cada dia
  for (let d = new Date(um_ano_atras); d <= hoje; d.setDate(d.getDate() + 1)) {
    const diaStr = d.toISOString().split('T')[0];
    const info = porDia[diaStr];
    const taxa = info ? Math.round((info.concluidas / info.total) * 100) : 0;

    let cor = '#1a1a1a'; // Cinza padrão
    if (taxa >= 90) cor = '#10b981'; // Verde intenso
    else if (taxa >= 70) cor = '#6ee7b7'; // Verde claro
    else if (taxa >= 50) cor = '#fbbf24'; // Amarelo
    else if (taxa > 0) cor = '#f5a623'; // Laranja
    else if (info) cor = '#f81d13'; // Vermelho

    const dataFormatada = new Date(d).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' });

    html += `
      <div class="heatmap-cell" style="background: ${cor};" title="${dataFormatada}: ${taxa > 0 ? taxa + '%' : 'Sem tarefas'}">
      </div>
    `;
  }

  html += '</div>';

  // Legenda
  html += `
    <div class="heatmap-legend" style="margin-top: 16px; display: flex; gap: 12px; font-size: 12px; justify-content: center; flex-wrap: wrap;">
      <span><span style="display: inline-block; width: 12px; height: 12px; background: #1a1a1a; border-radius: 2px; margin-right: 4px;"></span>Sem dados</span>
      <span><span style="display: inline-block; width: 12px; height: 12px; background: #f81d13; border-radius: 2px; margin-right: 4px;"></span>0-49%</span>
      <span><span style="display: inline-block; width: 12px; height: 12px; background: #f5a623; border-radius: 2px; margin-right: 4px;"></span>50-69%</span>
      <span><span style="display: inline-block; width: 12px; height: 12px; background: #fbbf24; border-radius: 2px; margin-right: 4px;"></span>70-89%</span>
      <span><span style="display: inline-block; width: 12px; height: 12px; background: #10b981; border-radius: 2px; margin-right: 4px;"></span>90%+</span>
    </div>
  `;

  container.innerHTML = html;
}

function renderTendencias(porDia) {
  const container = document.getElementById('tendencias-container');
  const dias = Object.entries(porDia).sort((a, b) => new Date(b[0]) - new Date(a[0])).slice(0, 7);

  const tendencias = [];

  // Analisar padrões
  const taxas = dias.map(([_, d]) => (d.concluidas / d.total) * 100);
  const taxaMedia = taxas.length > 0 ? taxas.reduce((a, b) => a + b, 0) / taxas.length : 0;

  tendencias.push(`📊 Taxa média: ${Math.round(taxaMedia)}%`);

  if (dias.length >= 2) {
    const ultimaDias = dias.slice(0, 2);
    const progressao = ultimaDias[0][1].concluidas > ultimaDias[1][1].concluidas ? 'subindo ↗️' : 'caindo ↘️';
    tendencias.push(`📉 Tendência está ${progressao}`);
  }

  tendencias.push(`✅ Total de tarefas: ${allTasks.length}`);
  tendencias.push(`🔥 Maior dia: ${Object.values(porDia).reduce((max, d) => Math.max(max, d.concluidas), 0)} tarefas`);

  container.innerHTML = tendencias.map(t => `<div class="tendencia-item">${t}</div>`).join('');
}

// =====================
//  DETECTOR DE PROCRASTINAÇÃO
// =====================
function detectarProcrastinacao() {
  const hoje = new Date();

  allTasks.forEach(t => {
    if (t.concluida) return;

    // Calcular dias desde a criação/adição
    const dataCriacao = new Date(t.data_reset || new Date());
    const diasAtraso = Math.floor((hoje - dataCriacao) / (1000 * 60 * 60 * 24));

    if (diasAtraso > 14 && !t.aviso_procrastinacao) {
      toast(`⏰ Alerta: "${t.titulo}" tá pendente há ${diasAtraso} dias!`, 'error');
      t.aviso_procrastinacao = true;
    }
  });
}

// =====================
//  ANÁLISE DE CORRELAÇÃO
// =====================
function analisarCorrelacaoGasto() {
  // Analisar padrão de gastos
  const diasDaSemana = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sab'];
  const gastosPorDia = {};

  allTransactions.forEach(t => {
    if (t.tipo === 'saida') {
      const data = new Date(t.data);
      const dia = diasDaSemana[data.getDay()];
      gastosPorDia[dia] = (gastosPorDia[dia] || 0) + parseFloat(t.valor);
    }
  });

  let maiorGasto = 'Sexta';
  let maiorValor = 0;
  Object.entries(gastosPorDia).forEach(([dia, valor]) => {
    if (valor > maiorValor) {
      maiorValor = valor;
      maiorGasto = dia;
    }
  });

  if (maiorGasto === 'Sexta' || maiorGasto === 'Sab' || maiorGasto === 'Dom') {
    const insight = `💰 Você gasta mais nos fins de semana! Média de R$ ${Math.round(maiorValor / 4)}/dia.`;
    return insight;
  }

  return '';
}

// =====================
//  SUGESTÕES DE HORÁRIOS
// =====================
function sugerirMelhorHorario() {
  const horariosCount = {};
  const horariosSuccess = {};

  allTasks.filter(t => t.hora && t.concluida).forEach(t => {
    const hora = t.hora.substring(0, 2);
    horariosCount[hora] = (horariosCount[hora] || 0) + 1;
    horariosSuccess[hora] = (horariosSuccess[hora] || 0) + 1;
  });

  allTasks.filter(t => t.hora).forEach(t => {
    const hora = t.hora.substring(0, 2);
    horariosCount[hora] = (horariosCount[hora] || 0) + 1;
  });

  let melhorHora = null;
  let maiorTaxa = 0;
  Object.keys(horariosCount).forEach(hora => {
    const taxa = (horariosSuccess[hora] || 0) / horariosCount[hora];
    if (taxa > maiorTaxa) {
      maiorTaxa = taxa;
      melhorHora = hora;
    }
  });

  return melhorHora ? `${melhorHora}h` : null;
}

// =====================
//  INICIALIZAÇÃO DO APP
// =====================
async function inicializarApp() {
  // Carrega o estado persistente (banco) antes de qualquer leitura — com fallback local
  await carregarEstado();

  // Pré-definir data de hoje nos inputs (usando data local)
  const inputData = document.getElementById('data-tarefa');
  if (inputData) {
    inputData.value = hojeLocal();
  }

  // Carregar dados do app
  carregarDadosJogador();
  carregarOrcamentos();
  atualizarData();
  atualizarHora();
  saudacao();
  conectarWebSocket();
  carregarTarefas();
  carregarTransacoes();
  carregarAlarmes();
  carregarRecorrentes();
  carregarEventos();
  carregarStats();
  atualizarDashboard();
  verificarModoNoturno();
  
  // Atualizar hora a cada segundo
  setInterval(atualizarHora, 1000);
  // Detector de procrastinação a cada 1 minuto
  setInterval(detectarProcrastinacao, 60000);
}

// Inicializar quando DOM está pronto
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', inicializarApp);
} else {
  inicializarApp();
}
