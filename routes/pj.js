const express = require('express');
const { run, all, get } = require('../lib/db');

const router = express.Router();

const TETO_MEI_ANO = 81000; // Faturamento anual máximo do MEI

// GET /api/pj — resumo PJ do mês + ano vs teto MEI + próximo DAS
router.get('/', async (req, res) => {
  try {
    const agora = new Date();
    const ym = `${agora.getFullYear()}-${String(agora.getMonth() + 1).padStart(2, '0')}`;
    const ano = agora.getFullYear();

    // Movimentações do mês atual (só contas PJ)
    const mes = await get(`
      SELECT
        COALESCE(SUM(CASE WHEN f.tipo='entrada' THEN valor END),0) AS entradas,
        COALESCE(SUM(CASE WHEN f.tipo='saida'   THEN valor END),0) AS saidas
      FROM financeiro f
      JOIN openfinance_accounts a ON a.account_id = f.account_id
      JOIN openfinance_items i    ON i.item_id    = a.item_id
      WHERE i.pessoa = 'PJ'
        AND TO_CHAR(f.data, 'YYYY-MM') = $1`, [ym]);

    // Faturamento do ano (apenas entradas em contas PJ)
    const anoAtual = await get(`
      SELECT COALESCE(SUM(f.valor),0) AS entradas
      FROM financeiro f
      JOIN openfinance_accounts a ON a.account_id = f.account_id
      JOIN openfinance_items i    ON i.item_id    = a.item_id
      WHERE i.pessoa = 'PJ' AND f.tipo = 'entrada'
        AND EXTRACT(YEAR FROM f.data) = $1`, [ano]);

    // Saldo consolidado PJ (agora)
    const saldo = await get(`
      SELECT
        COALESCE(SUM(CASE WHEN tipo='BANK'   THEN saldo END),0) AS caixa,
        COALESCE(SUM(CASE WHEN tipo='CREDIT' THEN saldo END),0) AS cartao
      FROM openfinance_accounts a
      JOIN openfinance_items i ON i.item_id = a.item_id
      WHERE i.pessoa = 'PJ'`);

    // Faturamento por mês (12 meses do ano) — pra gráfico
    const porMes = await all(`
      SELECT TO_CHAR(f.data, 'YYYY-MM') AS ym, SUM(f.valor) AS total
      FROM financeiro f
      JOIN openfinance_accounts a ON a.account_id = f.account_id
      JOIN openfinance_items i    ON i.item_id    = a.item_id
      WHERE i.pessoa = 'PJ' AND f.tipo = 'entrada'
        AND EXTRACT(YEAR FROM f.data) = $1
      GROUP BY ym
      ORDER BY ym`, [ano]);

    // Próximo DAS (vence dia 20 de cada mês)
    const diaVenc = 20;
    let dataDas;
    if (agora.getDate() <= diaVenc) {
      dataDas = new Date(agora.getFullYear(), agora.getMonth(), diaVenc);
    } else {
      dataDas = new Date(agora.getFullYear(), agora.getMonth() + 1, diaVenc);
    }
    const ymDas = `${dataDas.getFullYear()}-${String(dataDas.getMonth() + 1).padStart(2, '0')}`;
    const dasAtual = await get(`SELECT ym, valor, pago, data_pagamento FROM mei_das WHERE ym = $1`, [ymDas]);
    // Últimos 6 pagamentos
    const historico = await all(`SELECT ym, valor, pago, data_pagamento FROM mei_das ORDER BY ym DESC LIMIT 6`);

    const faturamentoAno = Number(anoAtual.entradas) || 0;
    const pctTeto = (faturamentoAno / TETO_MEI_ANO) * 100;
    const restanteTeto = Math.max(TETO_MEI_ANO - faturamentoAno, 0);
    // Projeção anual baseada no ritmo atual (média dos meses passados até agora)
    const mesAtualNum = agora.getMonth() + 1;
    const projecaoAno = mesAtualNum > 0 ? (faturamentoAno / mesAtualNum) * 12 : 0;

    res.json({
      mes: {
        ym,
        entradas: Number(mes.entradas),
        saidas: Number(mes.saidas),
        liquido: Number(mes.entradas) - Number(mes.saidas)
      },
      saldo: {
        caixa: Number(saldo.caixa),
        cartao: Number(saldo.cartao),
        liquido: Number(saldo.caixa) - Number(saldo.cartao)
      },
      teto: {
        limite: TETO_MEI_ANO,
        faturamentoAno,
        restante: restanteTeto,
        pct: Math.min(pctTeto, 100),
        excedeu: faturamentoAno > TETO_MEI_ANO,
        projecaoAno: Math.round(projecaoAno * 100) / 100
      },
      porMes: porMes.map(r => ({ ym: r.ym, total: Number(r.total) })),
      das: {
        proximo: { ym: ymDas, venc: dataDas.toISOString().substring(0, 10), pago: dasAtual ? !!dasAtual.pago : false, valor: dasAtual ? Number(dasAtual.valor) : null },
        historico: historico.map(h => ({ ym: h.ym, valor: h.valor != null ? Number(h.valor) : null, pago: !!h.pago, data_pagamento: h.data_pagamento }))
      }
    });
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

// POST /api/pj/das — registra pagamento (ou desmarca)
router.post('/das', async (req, res) => {
  const { ym, valor, pago } = req.body || {};
  if (!ym) return res.status(400).json({ erro: 'ym obrigatório' });
  try {
    await run(
      `INSERT INTO mei_das (ym, valor, pago, data_pagamento)
       VALUES ($1, $2, $3, CASE WHEN $3 THEN CURRENT_DATE ELSE NULL END)
       ON CONFLICT (ym) DO UPDATE
         SET valor = COALESCE(EXCLUDED.valor, mei_das.valor),
             pago = EXCLUDED.pago,
             data_pagamento = CASE WHEN EXCLUDED.pago THEN CURRENT_DATE ELSE NULL END`,
      [ym, valor != null ? parseFloat(valor) : null, !!pago]
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

module.exports = router;
