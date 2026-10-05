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
  for (const tipo of ['pc_notes_read', 'pc_qualquer_coisa_nova', 'tv_nova', 'soc_nova']) {
    const r = reconciliar('', [{ tipo, ok: true, texto: `feito: ${tipo}` }]);
    assert.match(r, new RegExp(`feito: ${tipo}`), tipo);
  }
});
