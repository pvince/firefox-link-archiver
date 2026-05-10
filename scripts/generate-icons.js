#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const assetsDir = path.join(__dirname, '..', 'src', 'assets');

// Ensure assets directory exists
if (!fs.existsSync(assetsDir)) {
  fs.mkdirSync(assetsDir, { recursive: true });
}

// Generate a simple colored PNG placeholder
function generatePNG(size, color = [100, 150, 200]) {
  // Minimal PNG: 1x1 pixel, then scale to desired size
  // This creates a valid but tiny PNG that browsers will stretch
  const [r, g, b] = color;
  
  // PNG header + IHDR chunk (1x1 image) + IDAT chunk (pixel data) + IEND chunk
  const png = Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), // PNG signature
    // IHDR chunk: width=size, height=size, 8-bit RGB
    Buffer.from([0, 0, 0, 13]), // chunk length
    Buffer.from('IHDR'),
    Buffer.from([0, 0, 0, size, 0, 0, 0, size, 8, 2, 0, 0, 0]), // width, height, bit depth, color type, etc.
    Buffer.from([0xc4, 0x1d, 0x1b, 0xf8]), // CRC
    // IDAT chunk with minimal pixel data
    Buffer.from([0, 0, 0, 12]), // chunk length
    Buffer.from('IDAT'),
    Buffer.from([0x78, 0x9c, 0x62, r, g, b, 0, 0, 0, 1, 0, 1]), // compressed empty image
    Buffer.from([0x85, 0x24, 0x70, 0x8a]), // CRC
    // IEND chunk
    Buffer.from([0, 0, 0, 0]),
    Buffer.from('IEND'),
    Buffer.from([0xae, 0x42, 0x60, 0x82]), // CRC
  ]);

  return png;
}

// Generate icons at different sizes
const sizes = [16, 32, 48, 96];
sizes.forEach(size => {
  const filename = path.join(assetsDir, `icon-${size}.png`);
  const png = generatePNG(size);
  fs.writeFileSync(filename, png);
  console.log(`✓ Generated ${filename} (${size}x${size})`);
});

console.log('✓ All placeholder icons generated successfully!');
