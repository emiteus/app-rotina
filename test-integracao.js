const fs = require('fs');
const path = require('path');

console.log('\n🔍 TESTE DE INTEGRAÇÃO\n');

const appJs = fs.readFileSync('./public/app.js', 'utf-8');
const indexHtml = fs.readFileSync('./public/index.html', 'utf-8');
const styleCss = fs.readFileSync('./public/style.css', 'utf-8');

let passed = 0;
let failed = 0;

function test(name, condition) {
  if (condition) {
    console.log(`✅ ${name}`);
    passed++;
  } else {
    console.log(`❌ ${name}`);
    failed++;
  }
}

// 1. HTML inclui confetti.js
test('HTML inclui confetti.js CDN', indexHtml.includes('canvas-confetti'));

// 2. HTML tem aba de histórico
test('HTML tem aba Histórico no sidebar', indexHtml.includes('data-tab="historico"'));

// 3. HTML tem botão de achievements
test('HTML tem botão de Achievements', indexHtml.includes('abrirAchievements()'));

// 4. HTML tem botão de resumo diário
test('HTML tem botão de Resumo Diário', indexHtml.includes('abrirResumoDiario()'));

// 5. HTML tem display de XP
test('HTML tem elemento de XP', indexHtml.includes('id="player-xp"'));

// 6. HTML tem quick add buttons completos
test('Quick Add tem botão Pomodoro', indexHtml.includes('abrirPomodoro()'));
test('Quick Add tem botão Orçamento', indexHtml.includes('abrirConfigOrcamentos()'));

// 7. CSS tem estilos para achievements
test('CSS tem estilos para achievements', styleCss.includes('.achievement-card'));

// 8. CSS tem estilos para modo zen
test('CSS tem estilos para modo zen', styleCss.includes('body.modo-zen'));

// 9. CSS tem estilos para modo noturno
test('CSS tem estilos para modo noturno', styleCss.includes('body.modo-noturno'));

// 10. CSS tem estilos para heatmap
test('CSS tem estilos para heatmap', styleCss.includes('.heatmap'));

// 11. App.js chama carregarDadosJogador no load
test('App carrega dados do jogador ao iniciar', appJs.includes('carregarDadosJogador()'));

// 12. App.js chama verificarAchievements no dashboard
test('App verifica achievements ao atualizar', appJs.includes('verificarAchievements()'));

// 13. App.js chama renderHistorico ao carregar tarefas
test('App renderiza histórico ao carregar tarefas', appJs.includes('renderHistorico()'));

// 14. App.js chama renderTimeline ao carregar tarefas
test('App renderiza timeline ao carregar tarefas', appJs.includes('renderTimeline()'));

// 15. App.js integra frases motivacionais no alternarTarefa
test('App mostra frase ao completar tarefa', appJs.includes('celebrarTarefa()'));

// 16. App.js integra celebração no Pomodoro
test('App celebra ao completar Pomodoro', appJs.includes('celebrarPomodoro()'));

// 17. HTML tem seção de Timeline
test('HTML tem Timeline do Dia', indexHtml.includes('timeline-container'));

// 18. HTML tem painel de orçamentos
test('HTML tem painel de orçamentos', indexHtml.includes('id="painel-orcamentos"'));

// 19. HTML tem seção de histórico
test('HTML tem página de Histórico', indexHtml.includes('id="historico-page"'));

// 20. HTML tem heatmap container
test('HTML tem container de heatmap', indexHtml.includes('id="heatmap-container"'));

console.log(`\n📊 RESULTADOS:`);
console.log(`   ✅ Passou: ${passed}`);
console.log(`   ❌ Falhou: ${failed}`);
console.log(`   📈 Taxa de sucesso: ${Math.round((passed / (passed + failed)) * 100)}%`);

if (failed === 0) {
  console.log('\n✨ TODAS AS INTEGRAÇÕES ESTÃO CORRETAS!\n');
  process.exit(0);
} else {
  console.log(`\n⚠️  ${failed} integração(ões) com problemas\n`);
  process.exit(1);
}
