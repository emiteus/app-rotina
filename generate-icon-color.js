const sharp = require('sharp');

const createColoredIconSVG = (size) => {
  return `
    <svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="grad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" style="stop-color:#6366f1;stop-opacity:1" />
          <stop offset="50%" style="stop-color:#7c3aed;stop-opacity:1" />
          <stop offset="100%" style="stop-color:#8b5cf6;stop-opacity:1" />
        </linearGradient>
      </defs>
      <!-- Fundo com gradient (SEM TRANSPARÊNCIA) -->
      <rect width="${size}" height="${size}" fill="url(#grad)"/>

      <!-- Lightning bolt branco -->
      <path d="M ${size/2} ${size*0.15} L ${size*0.65} ${size*0.5} L ${size*0.55} ${size*0.55} L ${size*0.35} ${size*0.9} L ${size*0.45} ${size*0.65} L ${size*0.35} ${size*0.6} Z"
            fill="white"
            stroke="rgba(255,255,255,0.9)"
            stroke-width="1.5"
            stroke-linejoin="round"
            stroke-linecap="round"/>

      <!-- Glow effect -->
      <circle cx="${size/2}" cy="${size*0.4}" r="${size*0.15}" fill="rgba(255,255,255,0.15)"/>
    </svg>
  `;
};

async function generateColorIcons() {
  try {
    console.log('Gerando ícones coloridos com fundo opaco...');

    // 256x256
    const svg256 = createColoredIconSVG(256);
    await sharp(Buffer.from(svg256))
      .png()
      .toFile('./public/icon.png');
    console.log('✓ icon.png (256x256)');

    // 512x512
    const svg512 = createColoredIconSVG(512);
    await sharp(Buffer.from(svg512))
      .png()
      .toFile('./public/icon-512.png');
    console.log('✓ icon-512.png (512x512)');

    // 64x64
    const svg64 = createColoredIconSVG(64);
    await sharp(Buffer.from(svg64))
      .png()
      .toFile('./public/icon-64.png');
    console.log('✓ icon-64.png (64x64)');

    console.log('✨ Ícones coloridos criados!');
  } catch (err) {
    console.error('Erro:', err.message);
    process.exit(1);
  }
}

generateColorIcons();
