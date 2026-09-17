/** Seed preferências Jarvis do owner. */
require('dotenv').config({ quiet: true });
const { get } = require('../lib/db');
const { saveJarvisPrefs, getJarvisPrefs } = require('../lib/jarvis-prefs');
const { OWNER_LOGIN } = require('../lib/plano-owner');

async function main() {
  const u = await get(`SELECT id FROM usuarios WHERE lower(login) = $1`, [OWNER_LOGIN]);
  if (!u?.id) throw new Error('owner não encontrado');
  await saveJarvisPrefs(u.id, {
    tratamento: 'chefe',
    cumprimento_curto: true,
    extras: { tratamento_alt: 'Teus' }
  });
  console.log('prefs', await getJarvisPrefs(u.id));
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
