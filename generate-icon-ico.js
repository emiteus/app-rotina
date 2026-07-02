// Gera um ICO multi-resolução de verdade (16,32,48,64,128,256) a partir de um SVG vetorial.
// Corrige o bug anterior, que salvava um único PNG 256px renomeado pra .ico (ruim nos tamanhos pequenos).
const sharp = require('sharp');
const fs = require('fs');

const createIconSVG = (size) => `
  <svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="grad" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" style="stop-color:#6366f1;stop-opacity:1" />
        <stop offset="100%" style="stop-color:#8b5cf6;stop-opacity:1" />
      </linearGradient>
    </defs>
    <rect width="${size}" height="${size}" rx="${size * 0.18}" fill="url(#grad)"/>
    <path d="M ${size / 2} ${size * 0.15} L ${size * 0.65} ${size * 0.5} L ${size * 0.55} ${size * 0.55} L ${size * 0.35} ${size * 0.9} L ${size * 0.45} ${size * 0.65} L ${size * 0.35} ${size * 0.6} Z"
          fill="white" stroke="white" stroke-width="2" stroke-linejoin="round"/>
  </svg>`;

// Monta um arquivo .ico a partir de uma lista de PNGs (Windows aceita entradas PNG-comprimidas)
function buildIco(images) {
  const count = images.length;
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);     // reserved
  header.writeUInt16LE(1, 2);     // type 1 = icon
  header.writeUInt16LE(count, 4); // número de imagens

  const entries = Buffer.alloc(16 * count);
  let offset = 6 + 16 * count;
  const datas = [];

  images.forEach((img, i) => {
    const e = i * 16;
    entries.writeUInt8(img.size >= 256 ? 0 : img.size, e + 0);  // width (0 = 256)
    entries.writeUInt8(img.size >= 256 ? 0 : img.size, e + 1);  // height
    entries.writeUInt8(0, e + 2);                                // color count
    entries.writeUInt8(0, e + 3);                                // reserved
    entries.writeUInt16LE(1, e + 4);                             // color planes
    entries.writeUInt16LE(32, e + 6);                            // bits per pixel
    entries.writeUInt32LE(img.data.length, e + 8);               // bytes do PNG
    entries.writeUInt32LE(offset, e + 12);                       // offset
    offset += img.data.length;
    datas.push(img.data);
  });

  return Buffer.concat([header, entries, ...datas]);
}

async function generateICO() {
  const sizes = [16, 32, 48, 64, 128, 256];
  console.log('Gerando ICO multi-resolução:', sizes.join(', '));

  const images = [];
  for (const size of sizes) {
    const data = await sharp(Buffer.from(createIconSVG(size)))
      .resize(size, size)
      .png()
      .toBuffer();
    images.push({ size, data });
  }

  const ico = buildIco(images);
  fs.writeFileSync('./public/icon.ico', ico);
  console.log(`✓ public/icon.ico criado (${images.length} tamanhos, ${ico.length} bytes)`);

  // Favicons de apoio
  await sharp(Buffer.from(createIconSVG(16))).resize(16, 16).png().toFile('./public/favicon-16.png');
  await sharp(Buffer.from(createIconSVG(32))).resize(32, 32).png().toFile('./public/favicon-32.png');
  console.log('✓ favicons atualizados');
}

generateICO().catch(err => { console.error('Erro:', err.message); process.exit(1); });
