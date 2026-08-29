const fs = require('fs');
const path = process.argv[2] || 'public/index.html';
let s = fs.readFileSync(path, 'utf8');

// Linhas com mojibake clássico (UTF-8 lido como Latin-1)
s = s.split(/\r?\n/).map((line) => {
  if (/Ã|â€|ðŸ/.test(line)) {
    return Buffer.from(line, 'latin1').toString('utf8');
  }
  return line;
}).join('\n');

const reps = [
  [/\uFFFDltimas/g, 'Últimas'],
  [/\uFFFD/g, ''],
  [/â†'/g, '→'],
  [/â†’/g, '→'],
  [/â†“/g, '↓'],
  [/â€"/g, '—'],
  [/â€"/g, '–'],
  [/â€¦/g, '…'],
];
for (const [a, b] of reps) s = s.replace(a, b);

fs.writeFileSync(path, s, 'utf8');
console.log('remaining FFFD', (s.match(/\uFFFD/g) || []).length);
console.log('Ultimas OK', s.includes('Últimas transações'));
