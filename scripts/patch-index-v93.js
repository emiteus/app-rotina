const fs = require('fs');
const path = 'public/index.html';
let s = fs.readFileSync(path, 'utf8');

const reps = [
  [/Atividade — <span id="chart-range-label">180 dias<\/span>/g, 'Histórico de atividade'],
  [/font-size:14px;">[^<]*<span id="stats-taxa"/g, 'font-size:14px;">· <span id="stats-taxa"'],
  [/\s*<div class="chart-range-toggle">[\s\S]*?<\/div>\n        <\/div>\n        <div class="chart-container">/,
    '\n        </div>\n        <div class="chart-container">'],
  [/<!--[^\n]*altimas transações[^\n]*-->/g, '<!-- Últimas transações — lista discreta com link pra Financeiro -->'],
  [/<h3>[^\n]*altimas transações<\/h3>/g, '<h3>Últimas transações</h3>'],
  [/Ver todas â†'/g, 'Ver todas →'],
  [/Ver todas â†’/g, 'Ver todas →'],
  [/â†'/g, '→'],
  [/â†’/g, '→'],
  [/â†“/g, '↓'],
  [/â†'/g, '↑'],
  [/â€"/g, '—'],
  [/â€"/g, '–'],
  [/â€¦/g, '…'],
  [/â€¹/g, '‹'],
  [/â€º/g, '›'],
  [/Ã—/g, '×'],
];

for (const [a, b] of reps) s = s.replace(a, b);

fs.writeFileSync(path, s, 'utf8');
console.log('patched index.html');
console.log('chart-range gone', !s.includes('chart-range-toggle'));
console.log('Ultimas', s.includes('Últimas transações'));
console.log('replacement char count', (s.match(/\uFFFD/g) || []).length);
