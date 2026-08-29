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

function assistLerConversaLocal() {
  try { return localStorage.getItem(ASSIST_CONV_KEY) || null; }
  catch (e) { return null; }
}
function assistSalvarConversaLocal(id) {
  try {
    if (id) localStorage.setItem(ASSIST_CONV_KEY, id);
    else localStorage.removeItem(ASSIST_CONV_KEY);
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
  if (t) t.textContent = titulo || 'Assistente';
  if (s) s.textContent = sub || 'Pergunta qualquer coisa dos seus dados';
}

function assistLimparMsgs() {
  const box = document.getElementById('assist-msgs');
  if (box) box.innerHTML = '';
}

function assistBoasVindas() {
  assistAddBubble('bot', 'Pergunta qualquer coisa dos seus dados: tarefas, hÃ¡bitos, gastos, despesas, metas, agendaâ€¦ Ou pede pra registrar â€” tipo â€œboleto de 240 no dia 18â€.');
  verificarStatusIA();
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
  const mobile = isAssistMobile();
  document.body.classList.toggle('assist-open', true);
  document.body.classList.toggle('assist-mobile-tab', mobile);
  if (panel) panel.classList.add('open');
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
  setTimeout(() => document.getElementById('assist-input')?.focus(), 50);
}

function fecharAssistente(opts) {
  _assistOpen = false;
  const panel = document.getElementById('assist-panel');
  const fab = document.getElementById('assist-fab');
  document.body.classList.remove('assist-open', 'assist-mobile-tab');
  if (panel) panel.classList.remove('open');
  if (fab) fab.classList.toggle('hidden', isAssistMobile());
  if (_assistHistOpen) assistFecharHistorico();

  // Mobile: Ã— volta pro dashboard (a menos que outra aba esteja sendo aberta)
  if (!opts?.manterAba && isAssistMobile()) {
    const dash = document.querySelector('.nav-btn[data-tab="dashboard"]');
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    dash?.classList.add('active');
    document.getElementById('dashboard')?.classList.add('active');
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
  assistSetTitulo('Assistente', 'Nova conversa');
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
  lista.innerHTML = '<div class="assist-hist-empty">Carregandoâ€¦</div>';
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
      const meta = `${assistFmtRelativo(c.atualizado_em)}${c.msgs ? ` Â· ${c.msgs} msg` : ''}`;
      const titulo = escapeHtml(c.titulo || 'Conversa');
      return `<div class="assist-hist-item${active}" data-id="${escapeHtml(c.id)}">
        <button type="button" class="assist-hist-item-body" onclick="assistCarregarConversa('${escapeHtml(c.id)}')">
          <span class="assist-hist-item-title">${titulo}</span>
          <span class="assist-hist-item-meta">${escapeHtml(meta)}</span>
        </button>
        <button type="button" class="assist-hist-del" title="Apagar" aria-label="Apagar" onclick="assistApagarConversa('${escapeHtml(c.id)}', event)">Ã—</button>
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
  if (!res.ok) throw new Error(data.erro || 'Conversa nÃ£o encontrada');

  _assistConversaId = id;
  assistSalvarConversaLocal(id);
  assistLimparMsgs();

  const msgs = data.mensagens || [];
  _assistHist = msgs
    .filter(m => m.role === 'user' || m.role === 'assistant')
    .map(m => ({ role: m.role, content: m.content }));

  if (!msgs.length) {
    assistSetTitulo(data.conversa?.titulo || 'Assistente', 'Nova conversa');
    assistBoasVindas();
  } else {
    assistSetTitulo(data.conversa?.titulo || 'Assistente', 'Conversa salva');
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
  // Se a API vazou JSON cru, extrai sÃ³ a mensagem
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
    el.setAttribute('aria-label', 'Assistente pensando');
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
  const thinking = assistAddBubble('bot thinking', 'Pensandoâ€¦');

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
      if (titEl && (titEl.textContent === 'Assistente' || !_assistHist.length)) {
        const t = msg.length > 40 ? msg.slice(0, 37) + 'â€¦' : msg;
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
          const nome = a.titulo || 'HÃ¡bito';
          txt = a.ja ? `${nome} jÃ¡ estava marcado hoje` : `${nome} marcado`;
        } else if (a.tipo === 'criar_categoria') {
          txt = a.criada
            ? `Categoria criada: ${a.label || a.categoria}`
            : `Categoria jÃ¡ existia: ${a.label || a.categoria}`;
        } else if (a.tipo === 'recategorizar') {
          const lab = a.label || a.categoria || 'categoria';
          txt = `${a.qtd || 0} tx â†’ ${lab}`;
        } else if (a.tipo === 'renomear_categoria') {
          txt = `Renomeada: ${a.label || a.categoria}`;
        } else if (a.tipo === 'fundir_categorias') {
          txt = `Unificadas â†’ ${a.label || a.categoria} (${a.qtd || 0} tx)`;
        } else if (a.tipo === 'confirmar_despesa') {
          txt = a.ja ? `JÃ¡ paga: ${a.titulo}` : `Paga: ${a.titulo}`;
        } else if (a.tipo === 'confirmar_receita') {
          txt = a.ja ? `JÃ¡ recebida: ${a.titulo}` : `Recebida: ${a.titulo}`;
        } else if (a.tipo === 'criar_receita') {
          txt = `Receita: ${a.titulo} (+R$ ${Number(a.valor).toFixed(2)})`;
        } else if (a.tipo === 'depositar_meta') {
          txt = `+R$ ${Number(a.valor).toFixed(2)} em ${a.meta}`;
        } else if (a.tipo === 'concluir_tarefa') {
          txt = a.ja ? `JÃ¡ concluÃ­da: ${a.titulo}` : `ConcluÃ­da: ${a.titulo}`;
        } else if (a.tipo === 'criar_evento') {
          txt = `Evento: ${a.titulo} (${a.data})`;
        } else if (a.tipo === 'criar_alarme') {
          txt = `Alarme ${a.hora}`;
        } else if (a.tipo === 'criar_transacao') {
          txt = `${a.sentido === 'entrada' ? '+' : '-'}R$ ${Number(a.valor).toFixed(2)}`;
        } else if (a.tipo === 'deletar_transacao') {
          txt = `Apagadas ${a.qtd || 0} tx`;
        } else if (a.tipo === 'corrigir_data_tx') {
          txt = `Data â†’ ${a.data} (${a.qtd || 0} tx)`;
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
      if (a.tipo) assistAddBubble('acao', `NÃ£o deu: ${a.erro || a.tipo}`);
    });
  } catch (err) {
    if (thinking) thinking.remove();
    assistAddBubble('bot erro', err.message || 'NÃ£o consegui responder agora.');
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
      if (data.ja) assistAddBubble('acao', `${marcado} jÃ¡ estava marcado hoje`);
      else assistAddBubble('acao', `${marcado} marcado`);
    }
    if (typeof carregarTarefas === 'function') carregarTarefas();
    if (typeof carregarDashboardExtras === 'function') carregarDashboardExtras();
    if (typeof carregarStats === 'function') carregarStats();
    if (typeof toast === 'function') toast(data.ja ? `${marcado}: jÃ¡ marcado hoje` : `${marcado} marcado`, 'success');
  } catch (e) {
    if (fromAssist) assistAddBubble('bot erro', e.message);
    else if (typeof toast === 'function') toast(e.message, 'error');
  }
}

function checkinAcademia(opts) {
  return checkinHabitoUI('Academia', opts);
}
