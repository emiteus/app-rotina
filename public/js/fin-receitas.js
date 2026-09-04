// =====================
//  RECEITA (cadastro manual)
// =====================
let _ganhosYm = null;
let _receitasData = null;

const LABELS_RECEITA_CHAVE = {
  laranjeira: 'Laranjeira',
  tylty: 'Lucas Tylty (encerrado)',
  cortes: 'Competição de cortes',
  infoproduto: 'Infoproduto',
  pj: 'PJ / MEI',
  outro: 'Outra receita'
};

const ORDEM_STATUS_RECEITA = { atrasado: 0, pendente: 1, recebido: 2 };

function labelReceitaChave(chave) {
  return LABELS_RECEITA_CHAVE[chave] || (chave || 'Receita').replace(/_/g, ' ');
}

function ganhosMesAnterior() {
  _ganhosYm = _shiftYm(_ganhosYm || _ymAgora(), -1);
  carregarGanhos();
}

function ganhosMesProximo() {
  _ganhosYm = _shiftYm(_ganhosYm || _ymAgora(), 1);
  carregarGanhos();
}

function abrirModalNovaReceita() {
  const m = document.getElementById('modal-nova-receita');
  const dataEl = document.getElementById('receita-data');
  if (dataEl && !dataEl.value) dataEl.value = new Date().toISOString().slice(0, 10);
  if (m) m.style.display = 'flex';
}

function fecharModalNovaReceita() {
  const m = document.getElementById('modal-nova-receita');
  if (m) m.style.display = 'none';
}

async function criarReceitaManual() {
  const chave = document.getElementById('receita-chave')?.value || 'outro';
  const titulo = document.getElementById('receita-titulo')?.value?.trim();
  const valor = parseFloat(document.getElementById('receita-valor')?.value);
  const recebidoEm = document.getElementById('receita-data')?.value || new Date().toISOString().slice(0, 10);
  const notas = document.getElementById('receita-notas')?.value?.trim();
  const jaRecebi = document.getElementById('receita-ja-recebi')?.checked !== false;
  if (!Number.isFinite(valor) || valor <= 0) {
    toast('Informe o valor', 'error');
    return;
  }
  try {
    const res = await fetch('/api/receitas', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ym: _ganhosYm || _ymAgora(),
        chave,
        titulo: titulo || labelReceitaChave(chave),
        valor,
        status: jaRecebi ? 'recebido' : 'pendente',
        recebido_em: jaRecebi ? recebidoEm : null,
        notas: notas || null,
        origem: 'manual'
      })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.erro || 'Erro');
    fecharModalNovaReceita();
    ['receita-titulo', 'receita-valor', 'receita-notas'].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.value = '';
    });
    toast(jaRecebi ? 'Receita registrada' : 'A receber registrado', 'success');
    await carregarGanhos();
  } catch (e) {
    toast(e.message, 'error');
  }
}

async function confirmarReceita(id) {
  const el = document.getElementById(`receita-${id}`);
  if (el) el.classList.add('confirmando');
  try {
    const item = (_receitasData?.receitas || []).find((r) => r.id === id);
    const valor = item?.valor_esperado || item?.valor_recebido;
    let res = await fetch(`/api/receitas/${encodeURIComponent(id)}/confirmar`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ valor_recebido: valor, confirmado_por: 'manual' })
    });
    if (res.status === 404) {
      res = await fetch(`/api/receitas/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ acao: 'confirmar', confirmado_por: 'manual', valor_recebido: valor })
      });
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.erro || `Erro ao confirmar (${res.status})`);
    toast('Receita confirmada', 'success');
    await carregarGanhos();
  } catch (e) {
    toast(e.message, 'error');
  } finally {
    if (el) el.classList.remove('confirmando');
  }
}

async function reabrirReceita(id) {
  try {
    const res = await fetch(`/api/receitas/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ acao: 'reabrir' })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.erro || 'Erro');
    toast(data.removida ? 'Receita removida' : 'Receita reaberta', 'success');
    await carregarGanhos();
  } catch (e) {
    toast(e.message, 'error');
  }
}

function renderReceitas() {
  const data = _receitasData;
  const painel = document.getElementById('painel-receitas');
  const resumoEl = document.getElementById('ganhos-resumo');
  if (!painel || !data) return;

  const r = data.resumo || {};
  const totalRecebido = Number(r.recebido || 0);
  if (resumoEl) {
    resumoEl.innerHTML = `
      <div class="despesas-kpi ok"><span class="label">Recebido</span><span class="valor">${formatBRL(totalRecebido)}</span></div>
      <div class="despesas-kpi"><span class="label">Piso fixo</span><span class="valor">${formatBRL(r.piso || 0)}</span></div>
      <div class="despesas-kpi pendente"><span class="label">Pendente</span><span class="valor">${formatBRL(r.pendente || 0)}</span></div>
      <div class="despesas-kpi atrasado"><span class="label">Atrasado</span><span class="valor">${formatBRL(r.atrasado || 0)}</span></div>
    `;
  }

  const fixas = (data.receitas || []).filter((x) => x.tipo === 'fixa' && x.status !== 'ignorado').sort((a, b) => {
    const sa = ORDEM_STATUS_RECEITA[a.status] ?? 9;
    const sb = ORDEM_STATUS_RECEITA[b.status] ?? 9;
    if (sa !== sb) return sa - sb;
    return (a.dia_previsto ?? 99) - (b.dia_previsto ?? 99);
  });
  const variaveis = (data.receitas || []).filter((x) => x.tipo === 'variavel' && x.status !== 'ignorado').sort((a, b) => {
    const sa = ORDEM_STATUS_RECEITA[a.status] ?? 9;
    const sb = ORDEM_STATUS_RECEITA[b.status] ?? 9;
    if (sa !== sb) return sa - sb;
    const da = a.recebido_em || '';
    const db = b.recebido_em || '';
    return db.localeCompare(da);
  });

  const cardReceita = (item) => {
    const dia = item.dia_previsto ? `previsto dia ${item.dia_previsto}` : 'sem data prevista';
    const recebidoInfo = item.recebido_em
      ? ` · recebido ${new Date(`${String(item.recebido_em).slice(0, 10)}T12:00:00`).toLocaleDateString('pt-BR')}`
      : '';
    const valorShow = item.status === 'recebido'
      ? Number(item.valor_recebido ?? item.valor_esperado)
      : Number(item.valor_esperado);
    let acoes = '';
    if (item.status === 'recebido') {
      acoes = `<button type="button" onclick="reabrirReceita('${item.id}')">${item.tipo === 'fixa' ? 'Reabrir' : 'Remover'}</button>`;
    } else {
      acoes = `<button type="button" class="btn-primary" style="padding:6px 10px; font-size:12px;" onclick="confirmarReceita('${item.id}')">Recebi</button>`;
    }
    const sub = item.tipo === 'variavel'
      ? `${escapeHtml(labelReceitaChave(item.chave))}${recebidoInfo}${item.notas ? ` · ${escapeHtml(item.notas)}` : ''}`
      : `${dia}${recebidoInfo}${item.notas ? ` · ${escapeHtml(item.notas)}` : ''}`;
    return `
      <div class="receita-item" id="receita-${item.id}">
        <div class="info">
          <div class="titulo">${escapeHtml(item.titulo)}</div>
          <div class="meta">${sub}</div>
        </div>
        <span class="badge-status ${item.status === 'recebido' ? 'pago' : item.status}">${item.status}</span>
        <div class="valor">${formatBRL(valorShow)}</div>
        <div class="acoes">${acoes}</div>
      </div>`;
  };

  let html = '';
  html += `<div class="receitas-grupo">
    <h3><span>Renda fixa</span><span class="receitas-grupo-meta">${fixas.length} Â· piso ${formatBRL(r.piso || 0)}</span></h3>`;
  html += fixas.length
    ? fixas.map(cardReceita).join('')
    : '<p class="receitas-empty">Nenhuma renda fixa neste mÃªs.</p>';
  html += '</div>';

  html += `<div class="receitas-grupo">
    <h3><span>Renda variÃ¡vel</span><span class="receitas-grupo-meta">${variaveis.length} Â· ${formatBRL(r.variavel || 0)}</span></h3>`;
  html += variaveis.length
    ? variaveis.map(cardReceita).join('')
    : '<p class="receitas-empty">Nenhuma receita variÃ¡vel. Use + Nova receita ou peÃ§a pro assistente.</p>';
  html += '</div>';

  painel.innerHTML = html;
}

async function carregarGanhos() {
  const labelEl = document.getElementById('ganhos-mes-label');
  const resumoEl = document.getElementById('ganhos-resumo');
  const painel = document.getElementById('painel-receitas');
  if (!resumoEl || !painel) return;

  const ym = _ganhosYm || _ymAgora();
  if (labelEl) labelEl.textContent = _labelYm(ym);

  resumoEl.innerHTML = '<div class="despesas-kpi"><span class="label">Carregandoâ€¦</span><span class="valor">â€”</span></div>';
  painel.innerHTML = '<p style="color:var(--text-muted); font-size:13px;">Carregando receitasâ€¦</p>';

  try {
    const data = await fetch(`/api/receitas?ym=${encodeURIComponent(ym)}`).then((r) => r.json());
    if (data.erro) throw new Error(data.erro);
    _receitasData = data;
    renderReceitas();
  } catch (e) {
    resumoEl.innerHTML = '';
    painel.innerHTML = `<div class="extrato-empty">${escapeHtml(e.message)}</div>`;
  }
}
