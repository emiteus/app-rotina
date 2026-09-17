// =====================
//  ASSISTENTE GLOBAL
// =====================
let _assistOpen = false;
let _assistHist = [];
let _assistBusy = false;
let _assistConversaId = null;
let _assistHistOpen = false;
let _assistCarregado = false;
const ASSIST_CONV_KEY = 'assist_conversa_id_v1';

function assistConvKey() {
  const uid = window.__currentUser?.id;
  return uid ? `${ASSIST_CONV_KEY}:${uid}` : ASSIST_CONV_KEY;
}

function assistLerConversaLocal() {
  try { return localStorage.getItem(assistConvKey()) || null; }
  catch (e) { return null; }
}
function assistSalvarConversaLocal(id) {
  try {
    const k = assistConvKey();
    if (id) localStorage.setItem(k, id);
    else localStorage.removeItem(k);
  } catch (e) { /* ignore */ }
}

function assistFmtRelativo(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const agora = Date.now();
  const diff = agora - d.getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return 'agora';
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h`;
  const dias = Math.floor(h / 24);
  if (dias === 1) return 'ontem';
  if (dias < 7) return `${dias}d`;
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' });
}

function assistSetTitulo(titulo, sub) {
  const t = document.getElementById('assist-titulo');
  const s = document.getElementById('assist-subtitulo');
  if (t) t.textContent = titulo || 'Jarvis';
  if (s) s.textContent = sub || 'Seu assistente pessoal';
}

function assistLimparMsgs() {
  const box = document.getElementById('assist-msgs');
  if (box) box.innerHTML = '';
}

function assistBoasVindas() {
  assistAddBubble('bot', 'Jarvis OS online. Missão, módulos, finanças — ou manda eu executar. High-risk pede **SIM**.');
  verificarStatusIA();
  assistRefreshOsStrip();
}

function assistQuickCmd(texto) {
  const input = document.getElementById('assist-input');
  if (!input) return;
  input.value = texto;
  const form = document.getElementById('assist-form');
  if (form) {
    if (typeof form.requestSubmit === 'function') form.requestSubmit();
    else form.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
  }
}

async function assistRefreshOsStrip() {
  const el = document.getElementById('assist-os');
  const panel = document.getElementById('assist-os-panel');
  const grid = document.getElementById('assist-os-panel-grid');
  if (!el) return;
  try {
    const [osR, missR] = await Promise.all([
      fetch('/api/ia/os'),
      fetch('/api/ia/missions')
    ]);
    if (!osR.ok) return;
    const os = await osR.json();
    const miss = missR.ok ? await missR.json() : null;
    const projects = (os.projects || []).filter((p) => p.snapshotKey || p.id === 'approtina' || p.wired === false);
    const projectsOn = projects.filter((p) => p.conectado).length;
    const budget = os.budget || {};
    const pills = [];
    pills.push({ cls: os.provider ? 'on' : 'off', text: os.provider || 'IA off' });
    pills.push({ cls: os.hitl ? 'on' : 'warn', text: os.hitl ? 'HITL' : 'HITL off' });
    pills.push({
      cls: projectsOn ? 'on' : 'off',
      text: `Projetos ${projectsOn}/${projects.length}`
    });
    pills.push({ cls: 'on', text: `${os.tools?.count || 0} tools` });
    if (budget.calls != null) {
      pills.push({ cls: 'on', text: `${budget.calls} calls/dia` });
    }
    if (miss?.active) {
      pills.push({
        cls: miss.active.status === 'waiting_approval' ? 'warn' : 'on',
        text: `Missão ${miss.active.status}`
      });
    }
    pills.push({ cls: 'on', text: 'Detalhes', action: 'toggle' });
    pills.push({ cls: 'on', text: 'OS', action: 'dash' });
    el.innerHTML = pills
      .map((p) => {
        let act = '';
        if (p.action === 'toggle') act = ' onclick="assistToggleOsPanel()"';
        if (p.action === 'dash') act = ' onclick="assistOpenDash()"';
        return `<button type="button" class="assist-os-pill ${p.cls}"${act}>${escapeHtml(p.text)}</button>`;
      })
      .join('');
    el.hidden = false;

    if (grid) {
      const projLines = projects
        .map((p) => {
          const st = !p.wired ? 'não ligado' : p.conectado ? 'ON' : 'off';
          return `${p.name}: <strong>${st}</strong>`;
        })
        .join('<br>');
      const missLine = miss?.active
        ? `<strong>${escapeHtml(miss.active.status)}</strong> — ${escapeHtml((miss.active.goal || '').slice(0, 48))}`
        : 'nenhuma ativa';
      grid.innerHTML = `
        <div class="assist-os-card">
          <div class="assist-os-card-title">Projetos</div>
          <div class="assist-os-card-body">${projLines}</div>
        </div>
        <div class="assist-os-card">
          <div class="assist-os-card-title">Sistema</div>
          <div class="assist-os-card-body">
            OS <strong>v${escapeHtml(os.version || '—')}</strong><br>
            HITL <strong>${os.hitl ? 'on' : 'off'}</strong> · ${escapeHtml(os.approvalThreshold || 'high')}<br>
            Budget <strong>${budget.calls || 0}</strong> calls · Missão: ${missLine}
          </div>
        </div>`;
    }

    window.__jarvisOsCache = { os, miss };
    if (os.provider) {
      assistSetTitulo('Jarvis', `OS v${os.version || '—'} · ${os.provider}`);
    }
  } catch (e) { /* silencioso */ }
}

function assistToggleOsPanel() {
  const panel = document.getElementById('assist-os-panel');
  if (!panel) return;
  panel.hidden = !panel.hidden;
}

function assistOpenDash() {
  const dash = document.getElementById('assist-dash');
  if (!dash) return;
  dash.hidden = false;
  assistRefreshDash();
}

function assistCloseDash() {
  const dash = document.getElementById('assist-dash');
  if (dash) dash.hidden = true;
}

async function assistRefreshDash() {
  await assistRefreshOsStrip();
  const body = document.getElementById('assist-dash-body');
  const title = document.getElementById('assist-dash-title');
  const sub = document.getElementById('assist-dash-sub');
  if (!body) return;
  const cache = window.__jarvisOsCache || {};
  let os = cache.os;
  let miss = cache.miss;
  if (!os) {
    try {
      const r = await fetch('/api/ia/os');
      os = await r.json();
    } catch (e) {
      body.innerHTML = '<p class="assist-dash-sub">Não deu pra carregar o OS.</p>';
      return;
    }
  }
  if (title) title.textContent = `Jarvis OS v${os.version || ''}`;
  if (sub) sub.textContent = `${os.provider || 'sem IA'} · HITL ${os.hitl ? 'on' : 'off'}`;

  const projects = os.projects || [];
  const high = (os.tools && os.tools.highRisk) || [];
  const budget = os.budget || {};
  const agents = os.agents || [];
  const missHtml = miss?.active
    ? `<div class="assist-dash-row"><span>Ativa</span><span>${escapeHtml(miss.active.status)}</span></div>
       <div class="assist-dash-row"><span>Objetivo</span><span>${escapeHtml((miss.active.goal || '').slice(0, 80))}</span></div>
       <div class="assist-dash-row"><span>Passo</span><span>${Number(miss.active.currentStep || 0) + 1}/${(miss.active.steps || []).length}</span></div>`
    : `<div class="assist-dash-row"><span>Status</span><span>nenhuma ativa</span></div>`;

  const projHtml = projects
    .map((p) => {
      const cls = !p.wired ? 'warn' : p.conectado ? 'on' : 'off';
      const st = !p.wired ? 'não ligado' : p.conectado ? 'ON' : 'off';
      return `<div class="assist-dash-row"><span><i class="assist-dash-dot ${cls}"></i>${escapeHtml(p.name)}</span><span>${st}</span></div>`;
    })
    .join('');

  body.innerHTML = `
    <section class="assist-dash-section">
      <h4>Projetos</h4>
      ${projHtml || '<div class="assist-dash-row"><span>Nenhum</span></div>'}
    </section>
    <section class="assist-dash-section">
      <h4>Missão</h4>
      ${missHtml}
    </section>
    <section class="assist-dash-section">
      <h4>Sistema</h4>
      <div class="assist-dash-row"><span>Tools</span><span>${os.tools?.count || 0}</span></div>
      <div class="assist-dash-row"><span>High-risk</span><span>${high.length}</span></div>
      <div class="assist-dash-row"><span>Calls hoje</span><span>${budget.calls || 0}</span></div>
      <div class="assist-dash-row"><span>Tokens</span><span>${budget.totalTokens || 0}</span></div>
      <div class="assist-dash-row"><span>Agentes</span><span>${agents.map((a) => a.id).filter((id) => id !== 'default').join(', ') || '—'}</span></div>
    </section>
    <section class="assist-dash-section">
      <h4>Atalhos</h4>
      <div class="assist-dash-row"><span>Missão</span><span>missão: … / executa missão</span></div>
      <div class="assist-dash-row"><span>HITL</span><span>SIM / NÃO</span></div>
      <div class="assist-dash-row"><span>Agente</span><span>/ops /finance /rotina</span></div>
    </section>`;
}

function toggleAssistente() {
  if (_assistOpen) fecharAssistente();
  else abrirAssistente();
}

function isAssistMobile() {
  return window.matchMedia('(max-width: 768px)').matches;
}

function abrirAssistente() {
  _assistOpen = true;
  const panel = document.getElementById('assist-panel');
  const fab = document.getElementById('assist-fab');
  const backdrop = document.getElementById('assist-backdrop');
  const mobile = isAssistMobile();
  document.body.classList.toggle('assist-open', true);
  document.body.classList.toggle('assist-mobile-tab', mobile);
  if (backdrop) {
    backdrop.hidden = false;
    requestAnimationFrame(() => backdrop.classList.add('open'));
  }
  if (panel) {
    // Garante que o browser aplique o estado fechado antes de animar a abertura
    void panel.offsetWidth;
    panel.classList.add('open');
  }
  if (fab) fab.classList.toggle('hidden', true);

  if (mobile) {
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    document.querySelector('.nav-btn[data-tab="assistente"]')?.classList.add('active');
    document.getElementById('assistente')?.classList.add('active');
  }

  if (!_assistCarregado) {
    _assistCarregado = true;
    assistAbrirUltimaOuNova();
  }
  setTimeout(() => document.getElementById('assist-input')?.focus(), 280);
}

function fecharAssistente(opts) {
  if (!_assistOpen && !document.getElementById('assist-panel')?.classList.contains('open')) {
    return;
  }
  _assistOpen = false;
  const panel = document.getElementById('assist-panel');
  const fab = document.getElementById('assist-fab');
  const backdrop = document.getElementById('assist-backdrop');
  const mobile = isAssistMobile();
  const manterAba = !!opts?.manterAba;

  // Painel e dashboard animam juntos (padding-right + translateX)
  if (panel) panel.classList.remove('open');
  if (backdrop) backdrop.classList.remove('open');
  document.body.classList.remove('assist-open');
  if (_assistHistOpen) assistFecharHistorico();

  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    document.body.classList.remove('assist-mobile-tab');
    if (backdrop) backdrop.hidden = true;
    if (fab) fab.classList.toggle('hidden', isAssistMobile());

    if (!manterAba && mobile) {
      const dash = document.querySelector('.nav-btn[data-tab="dashboard"]');
      document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
      dash?.classList.add('active');
      document.getElementById('dashboard')?.classList.add('active');
    }
  };

  if (panel) {
    const onEnd = (e) => {
      if (e.target !== panel) return;
      if (e.propertyName && e.propertyName !== 'transform' && e.propertyName !== 'opacity') return;
      panel.removeEventListener('transitionend', onEnd);
      finish();
    };
    panel.addEventListener('transitionend', onEnd);
    setTimeout(finish, 480);
  } else {
    finish();
  }
}


async function assistAbrirUltimaOuNova() {
  const salva = assistLerConversaLocal();
  if (salva) {
    try {
      await assistCarregarConversa(salva, { silencioso: true });
      return;
    } catch (e) {
      assistSalvarConversaLocal(null);
    }
  }
  assistNovaConversa({ semFoco: true });
}

function assistNovaConversa(opts) {
  _assistConversaId = null;
  _assistHist = [];
  assistSalvarConversaLocal(null);
  assistLimparMsgs();
  assistSetTitulo('Jarvis', 'Nova conversa');
  assistBoasVindas();
  assistFecharHistorico();
  if (!opts?.semFoco) {
    setTimeout(() => document.getElementById('assist-input')?.focus(), 40);
  }
  // Marca lista se estiver aberta
  document.querySelectorAll('.assist-hist-item').forEach(el => el.classList.remove('active'));
}

function assistToggleHistorico() {
  if (_assistHistOpen) assistFecharHistorico();
  else assistAbrirHistorico();
}

function assistFecharHistorico() {
  _assistHistOpen = false;
  const el = document.getElementById('assist-historico');
  const btn = document.getElementById('assist-hist-btn');
  const panel = document.getElementById('assist-panel');
  const backdrop = document.getElementById('assist-hist-backdrop');
  if (el) el.hidden = true;
  if (btn) btn.setAttribute('aria-expanded', 'false');
  if (panel) panel.classList.remove('hist-open');
  if (backdrop) backdrop.hidden = true;
}

async function assistAbrirHistorico() {
  _assistHistOpen = true;
  const el = document.getElementById('assist-historico');
  const btn = document.getElementById('assist-hist-btn');
  const panel = document.getElementById('assist-panel');
  const backdrop = document.getElementById('assist-hist-backdrop');
  if (el) el.hidden = false;
  if (btn) btn.setAttribute('aria-expanded', 'true');
  if (panel) panel.classList.add('hist-open');
  if (backdrop) backdrop.hidden = false;
  await assistRenderHistorico();
}

async function assistRenderHistorico() {
  const lista = document.getElementById('assist-historico-lista');
  if (!lista) return;
  lista.innerHTML = '<div class="assist-hist-empty">Carregando...</div>';
  try {
    const res = await fetch('/api/ia/conversas');
    const data = await res.json();
    if (!res.ok) throw new Error(data.erro || 'Falha ao listar');
    const conversas = data.conversas || [];
    if (!conversas.length) {
      lista.innerHTML = '<div class="assist-hist-empty">Nenhuma conversa ainda.</div>';
      return;
    }
    lista.innerHTML = conversas.map(c => {
      const active = c.id === _assistConversaId ? ' active' : '';
      const meta = `${assistFmtRelativo(c.atualizado_em)}${c.msgs ? `  ·  ${c.msgs} msg` : ''}`;
      const titulo = escapeHtml(c.titulo || 'Conversa');
      return `<div class="assist-hist-item${active}" data-id="${escapeHtml(c.id)}">
        <button type="button" class="assist-hist-item-body" onclick="assistCarregarConversa('${escapeHtml(c.id)}')">
          <span class="assist-hist-item-title">${titulo}</span>
          <span class="assist-hist-item-meta">${escapeHtml(meta)}</span>
        </button>
        <button type="button" class="assist-hist-del" title="Apagar" aria-label="Apagar" onclick="assistApagarConversa('${escapeHtml(c.id)}', event)">×</button>
      </div>`;
    }).join('');
  } catch (e) {
    lista.innerHTML = `<div class="assist-hist-empty">${escapeHtml(e.message || 'Erro')}</div>`;
  }
}

async function assistCarregarConversa(id, opts) {
  if (!id) return;
  const res = await fetch(`/api/ia/conversas/${encodeURIComponent(id)}`);
  const data = await res.json();
  if (!res.ok) throw new Error(data.erro || 'Conversa não encontrada');

  _assistConversaId = id;
  assistSalvarConversaLocal(id);
  assistLimparMsgs();

  const msgs = data.mensagens || [];
  _assistHist = msgs
    .filter(m => m.role === 'user' || m.role === 'assistant')
    .map(m => ({ role: m.role, content: m.content }));

  if (!msgs.length) {
    assistSetTitulo(data.conversa?.titulo || 'Jarvis', 'Nova conversa');
    assistBoasVindas();
  } else {
    assistSetTitulo(data.conversa?.titulo || 'Jarvis', 'Conversa salva');
    msgs.forEach(m => {
      if (m.role === 'user') assistAddBubble('user', m.content);
      else if (m.role === 'assistant') assistAddBubble('bot', m.content);
    });
  }

  if (!opts?.silencioso) assistFecharHistorico();
  else if (_assistHistOpen) assistRenderHistorico();

  const box = document.getElementById('assist-msgs');
  if (box) box.scrollTop = box.scrollHeight;
}

async function assistApagarConversa(id, ev) {
  if (ev) ev.stopPropagation();
  if (!id || !confirm('Apagar esta conversa?')) return;
  try {
    const res = await fetch(`/api/ia/conversas/${encodeURIComponent(id)}`, { method: 'DELETE' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.erro || 'Falha ao apagar');
    if (_assistConversaId === id) assistNovaConversa({ semFoco: true });
    if (_assistHistOpen) await assistRenderHistorico();
  } catch (e) {
    if (typeof toast === 'function') toast(e.message, 'error');
  }
}

async function verificarStatusIA() {
  try {
    const r = await fetch('/api/ia/status');
    const d = await r.json();
    if (!d.disponivel) {
      assistAddBubble('bot erro', 'IA desligada neste ambiente. Coloca GEMINI_API_KEY no .env (ou no Railway) e reinicia o servidor.');
    }
  } catch (e) { /* silencioso */ }
}

function assistSanitizeTexto(text) {
  let t = String(text || '').trim();
  if (!t) return 'Ok.';
  // Se a API vazou JSON cru, extrai só a mensagem
  if (/^\s*\{/.test(t) && /"resposta"\s*:/.test(t)) {
    const m = t.match(/"resposta"\s*:\s*"((?:\\.|[^"\\])*)"/);
    if (m) {
      try { t = JSON.parse(`"${m[1]}"`); }
      catch (e) { t = m[1].replace(/\\n/g, '\n').replace(/\\"/g, '"'); }
    } else {
      const parcial = t.match(/"resposta"\s*:\s*"((?:\\.|[^"\\])*)/);
      if (parcial) t = parcial[1].replace(/\\n/g, '\n').replace(/\\"/g, '"');
    }
  }
  return String(t).trim() || 'Ok.';
}

function assistFormatHtml(text) {
  const safe = escapeHtml(assistSanitizeTexto(text));
  return safe
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\n/g, '<br>');
}

function assistAddBubble(kind, text) {
  const box = document.getElementById('assist-msgs');
  if (!box) return;
  const el = document.createElement('div');
  el.className = 'assist-bubble ' + kind;
  if (kind.includes('thinking')) {
    el.innerHTML = '<span class="assist-typing" aria-hidden="true"><span></span><span></span><span></span></span><span class="assist-thinking-label">Pensando</span>';
    el.setAttribute('aria-label', 'Jarvis pensando');
  } else if (kind.includes('bot') || kind === 'acao') {
    el.innerHTML = assistFormatHtml(text);
  } else {
    el.textContent = text;
  }
  box.appendChild(el);
  box.scrollTop = box.scrollHeight;
  return el;
}

async function enviarAssistente(e) {
  e.preventDefault();
  if (_assistBusy) return;
  const input = document.getElementById('assist-input');
  const btn = document.getElementById('assist-send');
  const msg = (input?.value || '').trim();
  if (!msg) return;

  assistAddBubble('user', msg);
  input.value = '';
  _assistBusy = true;
  if (btn) btn.disabled = true;
  const thinking = assistAddBubble('bot thinking', 'Pensando...');

  try {
    const res = await fetch('/api/ia/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mensagem: msg,
        historico: _assistHist,
        conversa_id: _assistConversaId
      })
    });
    const data = await res.json();
    if (thinking) thinking.remove();
    if (!res.ok) throw new Error(data.erro || 'Falha no assistente');

    if (data.conversa_id) {
      _assistConversaId = data.conversa_id;
      assistSalvarConversaLocal(data.conversa_id);
      const titEl = document.getElementById('assist-titulo');
      if (titEl && (titEl.textContent === 'Jarvis' || titEl.textContent === 'Assistente' || !_assistHist.length)) {
        const t = msg.length > 40 ? msg.slice(0, 37) + '...' : msg;
        assistSetTitulo(t, 'Conversa salva');
      }
    }

    const resposta = assistSanitizeTexto(data.resposta || 'Ok.');
    assistAddBubble('bot', resposta);
    _assistHist.push({ role: 'user', content: msg });
    _assistHist.push({ role: 'assistant', content: resposta });
    if (_assistHist.length > 12) _assistHist = _assistHist.slice(-12);

    const feitos = (data.acoes || []).filter(a => a.ok);
    if (feitos.length) {
      feitos.forEach(a => {
        let txt = a.tipo;
        if (a.tipo === 'criar_despesa') txt = 'Despesa registrada';
        else if (a.tipo === 'criar_tarefa') txt = 'Tarefa criada';
        else if (a.tipo === 'criar_meta') txt = 'Meta criada';
        else if (a.tipo === 'marcar_habito') {
          const nome = a.titulo || 'Hábito';
          txt = a.ja ? `${nome} já estava marcado hoje` : `${nome} marcado`;
        } else if (a.tipo === 'criar_categoria') {
          txt = a.criada
            ? `Categoria criada: ${a.label || a.categoria}`
            : `Categoria já existia: ${a.label || a.categoria}`;
        } else if (a.tipo === 'recategorizar') {
          const lab = a.label || a.categoria || 'categoria';
          txt = `${a.qtd || 0} tx -> ${lab}`;
        } else if (a.tipo === 'renomear_categoria') {
          txt = `Renomeada: ${a.label || a.categoria}`;
        } else if (a.tipo === 'fundir_categorias') {
          txt = `Unificadas -> ${a.label || a.categoria} (${a.qtd || 0} tx)`;
        } else if (a.tipo === 'confirmar_despesa') {
          txt = a.ja ? `Já paga: ${a.titulo}` : `Paga: ${a.titulo}`;
        } else if (a.tipo === 'confirmar_receita') {
          txt = a.ja ? `Já recebida: ${a.titulo}` : `Recebida: ${a.titulo}`;
        } else if (a.tipo === 'criar_receita') {
          txt = `Receita: ${a.titulo} (+R$ ${Number(a.valor).toFixed(2)})`;
        } else if (a.tipo === 'depositar_meta') {
          txt = `+R$ ${Number(a.valor).toFixed(2)} em ${a.meta}`;
        } else if (a.tipo === 'concluir_tarefa') {
          txt = a.ja ? `Já concluída: ${a.titulo}` : `Concluída: ${a.titulo}`;
        } else if (a.tipo === 'criar_evento') {
          txt = `Evento: ${a.titulo} (${a.data})`;
        } else if (a.tipo === 'criar_alarme') {
          txt = `Alarme ${a.hora}`;
        } else if (a.tipo === 'criar_transacao') {
          txt = `${a.sentido === 'entrada' ? '+' : '-'}R$ ${Number(a.valor).toFixed(2)}`;
        } else if (a.tipo === 'deletar_transacao') {
          txt = `Apagadas ${a.qtd || 0} tx`;
        } else if (a.tipo === 'corrigir_data_tx') {
          txt = `Data -> ${a.data} (${a.qtd || 0} tx)`;
        } else if (a.tipo === 'marcar_das') {
          txt = a.pago ? `DAS ${a.ym} pago` : `DAS ${a.ym} reaberto`;
        }
        assistAddBubble('acao', txt);
      });
      if (feitos.some(a => a.tipo === 'criar_despesa' || a.tipo === 'confirmar_despesa') && typeof carregarDespesasMes === 'function') {
        carregarDespesasMes();
      }
      if (feitos.some(a => a.tipo === 'criar_receita' || a.tipo === 'confirmar_receita') && typeof carregarGanhos === 'function') {
        carregarGanhos();
      }
      if (feitos.some(a => a.tipo === 'criar_tarefa' || a.tipo === 'marcar_habito' || a.tipo === 'concluir_tarefa') && typeof carregarTarefas === 'function') {
        carregarTarefas();
      }
      if (feitos.some(a => a.tipo === 'marcar_habito' || a.tipo === 'concluir_tarefa') && typeof carregarDashboardExtras === 'function') {
        carregarDashboardExtras();
      }
      if (feitos.some(a => a.tipo === 'criar_meta' || a.tipo === 'depositar_meta') && typeof carregarMetas === 'function') {
        carregarMetas();
      }
      if (feitos.some(a => a.tipo === 'criar_evento') && typeof carregarEventos === 'function') {
        carregarEventos();
      }
      if (feitos.some(a => a.tipo === 'criar_alarme') && typeof carregarAlarmes === 'function') {
        carregarAlarmes();
      }
      if (feitos.some(a => a.tipo === 'marcar_das') && typeof carregarPJ === 'function') {
        carregarPJ();
      }
      if (feitos.some(a =>
        a.tipo === 'criar_categoria' || a.tipo === 'recategorizar' || a.tipo === 'renomear_categoria'
        || a.tipo === 'fundir_categorias' || a.tipo === 'criar_transacao' || a.tipo === 'deletar_transacao'
        || a.tipo === 'corrigir_data_tx'
      )) {
        if (typeof carregarCatListaForcado === 'function') await carregarCatListaForcado();
        else if (typeof carregarCatLista === 'function') await carregarCatLista();
        if (typeof carregarTransacoes === 'function') carregarTransacoes();
        if (typeof renderFinDonut === 'function') renderFinDonut();
        if (typeof carregarCategorizar === 'function') carregarCategorizar();
      }
    }
    const falhas = (data.acoes || []).filter(a => a && a.ok === false);
    falhas.forEach(a => {
      if (a.tipo) assistAddBubble('acao', `Não deu: ${a.erro || a.tipo}`);
    });
    assistRefreshOsStrip();
  } catch (err) {
    if (thinking) thinking.remove();
    assistAddBubble('bot erro', err.message || 'Não consegui responder agora.');
  } finally {
    _assistBusy = false;
    if (btn) btn.disabled = false;
    input?.focus();
  }
}

async function checkinHabitoUI(titulo, opts) {
  const nome = String(titulo || 'Academia').trim() || 'Academia';
  const fromAssist = !opts || opts.fromAssist !== false;
  if (fromAssist && !_assistOpen && typeof toggleAssistente === 'function') toggleAssistente();
  try {
    const res = await fetch('/api/tasks/checkin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ titulo: nome })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.erro || 'Falha no check-in');
    const marcado = data.titulo || nome;
    if (fromAssist) {
      if (data.ja) assistAddBubble('acao', `${marcado} já estava marcado hoje`);
      else assistAddBubble('acao', `${marcado} marcado`);
    }
    if (typeof carregarTarefas === 'function') carregarTarefas();
    if (typeof carregarDashboardExtras === 'function') carregarDashboardExtras();
    if (typeof carregarStats === 'function') carregarStats();
    if (typeof toast === 'function') toast(data.ja ? `${marcado}: já marcado hoje` : `${marcado} marcado`, 'success');
  } catch (e) {
    if (fromAssist) assistAddBubble('bot erro', e.message);
    else if (typeof toast === 'function') toast(e.message, 'error');
  }
}

function checkinAcademia(opts) {
  return checkinHabitoUI('Academia', opts);
}
