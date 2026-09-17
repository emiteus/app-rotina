/** One-shot: rewrite ia.js chat section into processarChat + thin route. */
const fs = require('fs');
const path = require('path');
const p = path.join(__dirname, '..', 'routes', 'ia.js');
let s = fs.readFileSync(p, 'utf8');
const marker = '// POST /api/ia/chat';
const start = s.indexOf(marker);
if (start < 0) {
  console.error('no marker');
  process.exit(1);
}
const head = s.slice(0, start);

const tail = `// Núcleo do assistente — usado pelo chat web e pelo WhatsApp
async function processarChat({ userId, mensagem, conversaId = null, historico = [] }) {
  const uid = userId;
  if (!uid) {
    const e = new Error('userId obrigatório');
    e.status = 400;
    throw e;
  }
  if (!providerAtivo()) {
    const e = new Error('IA não configurada. Defina GEMINI_API_KEY ou ANTHROPIC_API_KEY.');
    e.status = 400;
    throw e;
  }
  mensagem = String(mensagem || '').trim();
  if (!mensagem) {
    const e = new Error('mensagem é obrigatória');
    e.status = 400;
    throw e;
  }
  historico = Array.isArray(historico) ? historico : [];

  try {
    conversaId = await garantirConversa(conversaId, mensagem, uid);

    if (!historico.length) {
      const msgsDb = await all(\`
        SELECT role, content FROM assist_mensagens
        WHERE conversa_id = $1 AND role IN ('user','assistant')
        ORDER BY criado_em DESC, id DESC
        LIMIT 12
      \`, [conversaId]);
      historico = msgsDb.reverse().map(m => ({ role: m.role, content: m.content }));
    }

    await salvarMensagem(conversaId, 'user', mensagem, uid);

    const conv = await get(\`SELECT titulo FROM assist_conversas WHERE id = $1 AND user_id = $2\`, [conversaId, uid]);
    if (conv && (!conv.titulo || conv.titulo === 'Nova conversa')) {
      await run(\`UPDATE assist_conversas SET titulo = $1 WHERE id = $2 AND user_id = $3\`, [tituloDeMensagem(mensagem), conversaId, uid]);
    }

    const snap = await snapshotAssistente({ lite: true, userId: uid });

    const acoesRapidas = inferirAcoesDaMensagem(mensagem, snap, []);
    const TIPOS_FAST = new Set([
      'recategorizar', 'fundir_categorias', 'renomear_categoria', 'criar_categoria',
      'confirmar_despesa', 'confirmar_receita', 'criar_receita',
      'marcar_das', 'marcar_habito', 'depositar_meta'
    ]);
    if (acoesRapidas.length && acoesRapidas.every(a => TIPOS_FAST.has(a.tipo))) {
      const acoesExec = await executarAcoes(acoesRapidas, uid);
      if (acoesExec.some(a => a && a.ok)) {
        const resposta = reconciliarRespostaComAcoes('', acoesExec);
        await salvarMensagem(conversaId, 'assistant', resposta, uid);
        return {
          resposta, acoes: acoesExec, snapshot: snap,
          provider: 'local', usage: null, conversa_id: conversaId
        };
      }
      const soRecat = acoesRapidas.length === 1 && acoesRapidas[0].tipo === 'recategorizar';
      const recatFalhou = acoesExec.find(a => a && a.tipo === 'recategorizar' && a.ok === false);
      if (soRecat && recatFalhou) {
        const resposta = reconciliarRespostaComAcoes('', acoesExec);
        await salvarMensagem(conversaId, 'assistant', resposta, uid);
        return {
          resposta, acoes: acoesExec, snapshot: snap,
          provider: 'local', usage: null, conversa_id: conversaId
        };
      }
    }

    const systemPrompt = \`Você é o assistente pessoal do App Rotina. Português brasileiro, direto, tom de amigo útil. Trata o usuário por "você".

Missão: responder QUALQUER pergunta sobre o app e os dados do usuário que estiverem no JSON de contexto abaixo — tarefas, hábitos, financeiro, despesas do mês, metas, alarmes, eventos/calendário, recorrentes, saldos, plano financeiro, MEI/DAS, histórico e streak. Se a informação existir no contexto, use-a. Se não existir no contexto, diga que não tem esse dado no app agora (não invente).

Contexto atual (fonte da verdade):
\${JSON.stringify(snap)}

Como usar o contexto:
- Períodos: "hoje/ontem/amanhã" → tarefas.*; "essa semana" → habitos[].semana_concluidas ou tarefas.stats_7d; "esse mês" → despesas_mes, financeiro.mes_atual, habitos[].mes_concluidas.
- Finanças: financeiro.d7/d30/mes_atual, ultimas_transacoes (com id), categorias, gastos_por_categoria_30d, saldos_contas, plano_financeiro, despesas_mes, receitas_mes.
- Receita ≠ entrada do banco: receitas_mes é manual (Laranjeira, cortes, infoproduto). Entradas do extrato NÃO são receita.
- Confirmações ("já paguei X"): despesas_mes. ("recebi Laranjeira"): confirmar_receita. Receita variável: criar_receita.
- Produtividade: tarefas (hoje, atrasadas, próximos), stats_7d/30d, streak_dias_completos, historico_tarefas_recentes, recorrentes, consistencia_horario.
- Agenda: eventos_proximos, alarmes.
- Hábitos: só Academia (feito_hoje, semana e mês).

Ações (quando o usuário pedir pra fazer algo no app — VOCÊ executa; NÃO mande ele ir na tela manualmente):
- registrar pendência/dívida/despesa/tarefa/meta → criar_*
- "já paguei X" / confirmar conta → confirmar_despesa
- "recebi Laranjeira" / confirmar renda fixa → confirmar_receita
- registrar receita variável → criar_receita
- "guardei R$Y na meta Z" → depositar_meta
- "concluí a tarefa X" → concluir_tarefa
- "fui na academia" → marcar_habito
- criar evento/alarme → criar_evento / criar_alarme
- lançar entrada/saída manual → criar_transacao
- apagar tx / corrigir data → deletar_transacao / corrigir_data_tx
- DAS pago → marcar_das
- sincronizar bancos / reconciliar despesas → sincronizar_bancos / reconciliar_despesas
- categorias → criar/renomear/fundir/recategorizar
- Preferir ids do contexto. Se faltar dado, pergunte e NÃO emita ação.

Responda APENAS um JSON válido completo:
{"resposta":"texto em markdown simples (máx 120 palavras). Use **negrito** em números-chave.","acoes":[]}

Tipos de ação:
- {"tipo":"criar_despesa","titulo":"...","valor_esperado":123.45,"dia_vencimento":15,"categoria":"contas_fixas|moradia|outros"}
- {"tipo":"confirmar_despesa","titulo":"Netflix"} ou {"tipo":"confirmar_despesa","id":"..."}
- {"tipo":"confirmar_receita","titulo":"Laranjeira"} ou {"tipo":"confirmar_receita","chave":"laranjeira","valor":1000}
- {"tipo":"criar_receita","titulo":"Attracione","valor":4000,"chave":"cortes","recebido_em":"YYYY-MM-DD"}
- {"tipo":"criar_tarefa","titulo":"...","prioridade":"alta|media|baixa","data_reset":"YYYY-MM-DD"}
- {"tipo":"concluir_tarefa","titulo":"..."} ou {"tipo":"concluir_tarefa","id":"..."}
- {"tipo":"criar_meta","nome":"...","valor_total":1000,"prazo":"YYYY-MM-DD"|null}
- {"tipo":"depositar_meta","nome":"Viagem","valor":200}
- {"tipo":"marcar_habito","titulo":"Academia"}
- {"tipo":"criar_evento","titulo":"...","data":"YYYY-MM-DD","hora":"HH:MM"|null}
- {"tipo":"criar_alarme","hora":"07:30","mensagem":"..."}
- {"tipo":"criar_transacao","tipo_tx":"entrada|saida","valor":50,"descricao":"...","data":"YYYY-MM-DD","categoria":"outros"}
- {"tipo":"deletar_transacao","ids":["uuid"]} ou com "filtros"
- {"tipo":"corrigir_data_tx","data":"YYYY-MM-DD","ids":["uuid"]} ou com "filtros"
- {"tipo":"marcar_das","ym":"2026-08","pago":true,"valor":null}
- {"tipo":"reconciliar_despesas","ym":"2026-09"}
- {"tipo":"sincronizar_bancos"}
- {"tipo":"criar_categoria","categoria_label":"..."}
- {"tipo":"renomear_categoria","de":"...","categoria_label":"..."}
- {"tipo":"fundir_categorias","de":["a","b"],"categoria_label":"..."}
- {"tipo":"recategorizar","categoria_label":"...","ids":["uuid"]} ou "filtros"

Regras:
- "resposta" é o texto que o usuário lê — nunca JSON cru.
- NUNCA diga que fez se não emitir a ação em "acoes".
- Análise sem alterar: responda com acoes:[].
- No máximo 1 emoji. Valores em R$.\`;

    let texto;
    let usage;
    let provider;
    try {
      ({ texto, usage, provider } = await chamarIA({
        system: systemPrompt,
        user: mensagem,
        historico,
        maxTokens: 2200,
        jsonMode: true,
        timeout: 28000
      }));
    } catch (errGemini) {
      const fallback = inferirAcoesDaMensagem(mensagem, snap, []);
      if (fallback.length) {
        const acoesExec = await executarAcoes(fallback, uid);
        const resposta = reconciliarRespostaComAcoes('', acoesExec);
        await salvarMensagem(conversaId, 'assistant', resposta, uid);
        return {
          resposta, acoes: acoesExec, snapshot: snap,
          provider: 'local-fallback', usage: null, conversa_id: conversaId
        };
      }
      throw errGemini;
    }

    let parsed = null;
    try { parsed = parseJSON(texto); } catch (e) { parsed = null; }

    const respostaBruta = textoAssistenteSeguro(texto, parsed);
    const acoesMerged = inferirAcoesDaMensagem(mensagem, snap, parsed && parsed.acoes);
    const acoesExec = await executarAcoes(acoesMerged, uid);
    const resposta = reconciliarRespostaComAcoes(respostaBruta, acoesExec);
    await salvarMensagem(conversaId, 'assistant', resposta, uid);

    return {
      resposta, acoes: acoesExec, snapshot: snap,
      provider, usage, conversa_id: conversaId
    };
  } catch (err) {
    if (err.status) throw err;
    const e = new Error(mensagemGemini(err));
    e.status = 503;
    e.cause = err;
    throw e;
  }
}

// POST /api/ia/chat — assistente global
router.post('/chat', async (req, res) => {
  const uid = requireUserId(req, res);
  if (!uid) return;
  const mensagem = String(req.body?.mensagem || '').trim();
  if (!mensagem) return res.status(400).json({ erro: 'mensagem é obrigatória' });
  try {
    const out = await processarChat({
      userId: uid,
      mensagem,
      conversaId: req.body?.conversa_id ? String(req.body.conversa_id) : null,
      historico: Array.isArray(req.body?.historico) ? req.body.historico : []
    });
    res.json(out);
  } catch (err) {
    if (err.status === 400) return res.status(400).json({ erro: err.message });
    res.status(503).json({ erro: err.message || 'Erro no assistente' });
  }
});

module.exports = router;
module.exports.processarChat = processarChat;
`;

fs.writeFileSync(p, head + tail);
console.log('ok', p, 'bytes', (head + tail).length);
