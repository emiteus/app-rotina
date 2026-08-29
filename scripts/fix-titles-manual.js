require('dotenv').config({ quiet: true });
const { pool } = require('../lib/db');
const fixes = [
  ['8a91bf9a-22a8-4483-ab70-0e3006f67167', 'Laranjeira – produzir 10 vídeos'],
  ['d3325c32-ba14-4b7f-b8c5-fec06fe71106', 'Gerar 10 vídeos de filmes'],
];
(async () => {
  for (const [id, titulo] of fixes) {
    await pool.query(`UPDATE tasks SET titulo = $1 WHERE id = $2`, [titulo, id]);
    console.log('fixed', titulo);
  }
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
