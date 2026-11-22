/**
 * Resposta final do Jarvis montada a partir das ações: o resultado de uma tool do PC/TV/redes que deu certo
 * não pode sumir só porque outra ação do mesmo turno falhou, nem por a tool ser nova (30/09/2026:
 * pc_notes_search não estava na lista fixa e a busca nas notas desaparecia da resposta).
 * Sem banco: só a função de montar a resposta.
 * Rodar: node --test tests/resposta-acoes.test.js
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { _reconciliarRespostaComAcoes: reconciliar } = require('../routes/ia');

test('busca nas notas aparece mesmo com outra ação falhando no mesmo turno', () => {
  const r = reconciliar('', [
    { tipo: 'pc_spotify_now', ok: false, erro: 'Spotify não conectado neste PC' },
    { tipo: 'pc_notes_search', ok: true, texto: 'Você mexeu por último em Minerador e CineRush.' }
  ]);
  assert.match(r, /Minerador e CineRush/);
});

test('qualquer tool nova do PC, da TV ou das redes entra sem precisar de lista', () => {
  for (const tipo of ['pc_notes_read', 'pc_qualquer_coisa_nova', 'tv_nova', 'home_light', 'soc_nova']) {
    const r = reconciliar('', [{ tipo, ok: true, texto: `feito: ${tipo}` }]);
    assert.match(r, new RegExp(`feito: ${tipo}`), tipo);
  }
});

// 22/11/2026: "Jarvis, acenda a luz" voltava "Acendi a Lâmpada NEO 10W." sem ação (copiando o histórico) e a
// 2ª tentativa, no mesmo Haiku, repetia igual. Agora a 2ª tentativa leva um aviso — só quando ele fingiu que fez.
const { _avisoAcaoFingida: aviso, _respostaClaimMutacao: claim } = require('../routes/ia');

test('resposta que finge ter feito ganha aviso na 2ª tentativa, citando o que ele disse', () => {
  for (const r of ['Acendi a Lâmpada NEO 10W.', 'Acendendo a luz.', 'Apaguei a luz do quarto.', 'Pronto, lâmpada acesa.', 'Ligando a TV.']) {
    const a = aviso(r);
    assert.match(a, /NADA foi feito/, r);
    assert.ok(a.includes(r), `cita a resposta: ${r}`);
  }
});

test('pergunta, negação ou conversa não ganham aviso (a 2ª tentativa segue como antes)', () => {
  for (const r of ['Quer que eu acenda a luz?', 'Ainda não acendi nada.', 'Qual luz, senhor? A do quarto ou a RGB do PC?', '', null]) {
    assert.strictEqual(aviso(r), '', String(r));
  }
});

test('"acendendo"/"apagando" sem ação contam como fingir que fez', () => {
  assert.strictEqual(claim('Acendendo a luz.'), true);
  assert.strictEqual(claim('Apagando a luz da sala.'), true);
  assert.strictEqual(claim('Ainda não apaguei.'), false);
});
