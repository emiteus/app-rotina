const sharp = require('sharp');
const path = require('path');
const fs = require('fs');

// Create SVG with gradient background and lightning bolt icon
const createIconSVG = (size) => {
  return `
    <svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="grad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" style="stop-color:#6366f1;stop-opacity:1" />
          <stop offset="100%" style="stop-color:#8b5cf6;stop-opacity:1" />
        </linearGradient>
      </defs>
      <!-- Background gradient -->
      <rect width="${size}" height="${size}" fill="url(#grad)"/>

      <!-- Lightning bolt icon -->
      <path d="M ${size/2} ${size*0.15} L ${size*0.65} ${size*0.5} L ${size*0.55} ${size*0.55} L ${size*0.35} ${size*0.9} L ${size*0.45} ${size*0.65} L ${size*0.35} ${size*0.6} Z"
            fill="white"
            stroke="white"
            stroke-width="2"
            stroke-linejoin="round"/>
    </svg>
  `;
};

async function generateIcons() {
  try {
    // Ensure public directory exists
    if (!fs.existsSync('./public')) {
      fs.mkdirSync('./public', { recursive: true });
    }

    // Generate 256x256 icon
    console.log('Generating 256x256 icon...');
    const svg256 = createIconSVG(256);
    await sharp(Buffer.from(svg256))
      .png()
      .toFile('./public/icon.png');
    console.log('✓ Created public/icon.png (256x256)');

    // Generate 512x512 icon for high-DPI
    console.log('Generating 512x512 icon...');
    const svg512 = createIconSVG(512);
    await sharp(Buffer.from(svg512))
      .png()
      .toFile('./public/icon-512.png');
    console.log('✓ Created public/icon-512.png (512x512)');

    // Generate 64x64 for taskbar
    console.log('Generating 64x64 icon...');
    const svg64 = createIconSVG(64);
    await sharp(Buffer.from(svg64))
      .png()
      .toFile('./public/icon-64.png');
    console.log('✓ Created public/icon-64.png (64x64)');

    console.log('\n✨ All icons generated successfully!');
  } catch (err) {
    console.error('Error generating icons:', err.message);
    process.exit(1);
  }
}

generateIcons();
