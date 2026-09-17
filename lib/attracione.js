/**
 * Cliente Attracione (módulo Jarvis) — ops via X-Scraper-Token.
 */
function baseUrl() {
  return String(process.env.ATTRACIONE_URL || 'https://www.attracionecomp.com.br').replace(
    /\/+$/,
    ''
  );
}

function token() {
  return String(process.env.ATTRACIONE_SCRAPER_TOKEN || '').trim();
}

function attracioneReady() {
  return !!(baseUrl() && token().length >= 8);
}

async function attrFetch(path, opts = {}) {
  if (!attracioneReady()) {
    throw new Error('Attracione não configurado (ATTRACIONE_URL/SCRAPER_TOKEN)');
  }
  const res = await fetch(`${baseUrl()}${path}`, {
    ...opts,
    headers: {
      'X-Scraper-Token': token(),
      'Content-Type': 'application/json',
      ...(opts.headers || {})
    },
    signal: AbortSignal.timeout(opts.timeoutMs || 30000)
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data?.error || data?.message || `Attracione HTTP ${res.status}`;
    const err = new Error(typeof msg === 'string' ? msg : JSON.stringify(msg));
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

async function getAttracioneSnapshot() {
  if (!attracioneReady()) return { conectado: false };
  try {
    const [coleta, planilha] = await Promise.all([
      attrFetch('/api/scraper/coleta', { timeoutMs: 15000 }),
      attrFetch('/api/admin/ranking/planilha', { timeoutMs: 15000 }).catch((e) => ({
        erro: e.message
      }))
    ]);
    return {
      conectado: true,
      projeto: 'Attracione',
      operacao: {
        coleta_automatica: !!coleta.ligada,
        intervalo_min: coleta.intervaloMin,
        ultima: coleta.ultima || null,
        coleta_em_curso: !!(coleta.ig && coleta.ig.coletaEmCurso),
        passadas: coleta.passadas || null,
        sessao_ig: !!(coleta.ig && coleta.ig.sessaoLogada),
        thumbs_pendentes: coleta.thumbs || null,
        backups: (coleta.backups || []).slice(0, 3),
        backup_atrasado: !!(coleta.backupStatus && coleta.backupStatus.atrasado),
        contas_com_problema: ((coleta.avisos && coleta.avisos.contas) || [])
          .slice(0, 5)
          .map((c) => ({
            quem: c.quem,
            plataforma: c.plataforma,
            conta: c.conta,
            sem_achar: c.rodadasSemAchar || 0
          })),
        plataformas_quebradas: (coleta.avisos && coleta.avisos.plataformasQuebradas) || []
      },
      ranking: planilha?.linhas
        ? {
            competicao: planilha.competicao,
            startDate: planilha.startDate,
            endDate: planilha.endDate,
            top: (planilha.linhas || []).slice(0, 10).map((l) => ({
              pos: l.posicao,
              nome: l.nomeCompleto,
              views: l.views,
              premio: l.valor
            }))
          }
        : planilha
    };
  } catch (e) {
    return { conectado: false, erro: e.message };
  }
}

async function dispararColeta(plataforma) {
  const body = plataforma ? { plataforma } : {};
  return attrFetch('/api/scraper/coleta', {
    method: 'POST',
    body: JSON.stringify(body),
    timeoutMs: 120000
  });
}

async function dispararBackup() {
  return attrFetch('/api/scraper/backup', {
    method: 'POST',
    body: '{}',
    timeoutMs: 60000
  });
}

async function rankingComp(n) {
  const q = new URLSearchParams();
  if (n != null && String(n).trim()) q.set('n', String(n).trim());
  return attrFetch(`/api/admin/ranking/planilha?${q}`, { timeoutMs: 20000 });
}

module.exports = {
  attracioneReady,
  getAttracioneSnapshot,
  dispararColeta,
  dispararBackup,
  rankingComp
};
