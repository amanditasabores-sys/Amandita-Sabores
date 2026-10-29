const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

// CRC32 table
const crcTable = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) {
    c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
  }
  crcTable[n] = c >>> 0;
}

function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = crcTable[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function makeChunk(type, data) {
  const len = data.length;
  const chunk = Buffer.alloc(12 + len);
  chunk.writeUInt32BE(len, 0);
  chunk.write(type, 4, 4, 'ascii');
  data.copy(chunk, 8);
  const typeAndData = chunk.subarray(4, 8 + len);
  const crc = crc32(typeAndData);
  chunk.writeUInt32BE(crc, 8 + len);
  return chunk;
}

function createPng(width, height, getPixel) {
  // Signature
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  // IHDR
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type: RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  const ihdrChunk = makeChunk('IHDR', ihdr);

  // Raw scanlines with filter byte 0
  const rowSize = 1 + width * 4;
  const rawData = Buffer.alloc(height * rowSize);

  for (let y = 0; y < height; y++) {
    const rowOffset = y * rowSize;
    rawData[rowOffset] = 0; // Filter: None
    for (let x = 0; x < width; x++) {
      const pxOffset = rowOffset + 1 + x * 4;
      const [r, g, b, a] = getPixel(x, y, width, height);
      rawData[pxOffset] = r;
      rawData[pxOffset + 1] = g;
      rawData[pxOffset + 2] = b;
      rawData[pxOffset + 3] = a;
    }
  }

  const compressed = zlib.deflateSync(rawData, { level: 9 });
  const idatChunk = makeChunk('IDAT', compressed);
  const iendChunk = makeChunk('IEND', Buffer.alloc(0));

  return Buffer.concat([sig, ihdrChunk, idatChunk, iendChunk]);
}

// Brand color palette
// Background: #1F100B (31, 16, 11) to #351A0E (53, 26, 14)
// Terracotta: #C86D3B (200, 109, 59) to #E87A36 (232, 122, 54)
// Gold: #FFCA28 (255, 202, 40)
// White: #FAF7F2 (250, 247, 242)

function lerp(a, b, t) {
  return a + (b - a) * Math.max(0, Math.min(1, t));
}

function renderBrandIcon(x, y, width, height, isMaskable) {
  const nx = x / width;
  const ny = y / height;
  const cx = 0.5;
  const cy = 0.5;
  const dx = nx - cx;
  const dy = ny - cy;
  const dist = Math.sqrt(dx * dx + dy * dy);

  // Background gradient: Rich coffee/chocolate (#2E150C to #140703)
  const bgGrad = (nx + ny) * 0.5;
  let r = Math.round(lerp(46, 20, bgGrad));
  let g = Math.round(lerp(21, 8, bgGrad));
  let b = Math.round(lerp(12, 4, bgGrad));
  let a = 255;

  // For non-maskable icons, apply rounded corners (radius ~ 22%)
  if (!isMaskable) {
    const cornerRadius = 0.22;
    const cornerDistX = Math.max(0, Math.abs(nx - 0.5) - (0.5 - cornerRadius));
    const cornerDistY = Math.max(0, Math.abs(ny - 0.5) - (0.5 - cornerRadius));
    const cornerDist = Math.sqrt(cornerDistX * cornerDistX + cornerDistY * cornerDistY);
    if (cornerDist > cornerRadius) {
      return [0, 0, 0, 0]; // Transparent outside rounded rect
    }
  }

  // Scale factor for maskable (central 80% safe zone) vs normal
  const scale = isMaskable ? 0.78 : 0.95;
  const sx = (nx - 0.5) / scale + 0.5;
  const sy = (ny - 0.5) / scale + 0.5;

  const sDist = Math.sqrt((sx - 0.5) * (sx - 0.5) + (sy - 0.5) * (sy - 0.5));

  // Outer decorative gold/terracotta ring
  if (sDist >= 0.41 && sDist <= 0.43) {
    const ringT = (sDist - 0.41) / 0.02;
    const ringAlpha = Math.sin(ringT * Math.PI) * 0.7;
    r = Math.round(lerp(r, 200, ringAlpha));
    g = Math.round(lerp(g, 109, ringAlpha));
    b = Math.round(lerp(b, 59, ringAlpha));
  } else if (sDist >= 0.435 && sDist <= 0.445) {
    const ringT = (sDist - 0.435) / 0.01;
    const ringAlpha = Math.sin(ringT * Math.PI) * 0.4;
    r = Math.round(lerp(r, 255, ringAlpha));
    g = Math.round(lerp(g, 202, ringAlpha));
    b = Math.round(lerp(b, 40, ringAlpha));
  }

  // Steam swirls above the cloche (sy between 0.16 and 0.38)
  if (sy >= 0.16 && sy <= 0.38 && Math.abs(sx - 0.5) < 0.22) {
    // 3 steam trails
    const steamOffsets = [-0.1, 0, 0.1];
    for (const offset of steamOffsets) {
      const wave = Math.sin((sy - 0.16) * 18 + offset * 10) * 0.035;
      const trailX = 0.5 + offset + wave;
      const trailDist = Math.abs(sx - trailX);
      if (trailDist < 0.022) {
        const steamIntensity = (1 - trailDist / 0.022) * (1 - (0.38 - sy) / 0.22) * 0.85;
        r = Math.round(lerp(r, 255, steamIntensity));
        g = Math.round(lerp(g, 202, steamIntensity));
        b = Math.round(lerp(b, 40, steamIntensity));
      }
    }
  }

  // Cloche / Dome (sy between 0.38 and 0.60)
  // Dome equation: ellipse top half
  const domeDx = (sx - 0.5) / 0.28;
  const domeDy = (sy - 0.60) / 0.22;
  const domeDist = domeDx * domeDx + domeDy * domeDy;

  if (domeDist <= 1.0 && sy <= 0.60 && sy >= 0.38) {
    // Warm terracotta gradient on the dome
    const domeGrad = (sx - 0.22) / 0.56;
    const domeR = Math.round(lerp(232, 192, domeGrad));
    const domeG = Math.round(lerp(122, 80, domeGrad));
    const domeB = Math.round(lerp(54, 24, domeGrad));

    r = domeR;
    g = domeG;
    b = domeB;

    // Stylized "A" cutout / white monogram on dome
    const ax = (sx - 0.5) / 0.10;
    const ay = (sy - 0.49) / 0.09;
    if (Math.abs(ax) < 1.0 && Math.abs(ay) < 1.0) {
      // Left leg of A: line from (-0.8, 0.9) to (0, -0.9)
      // Right leg of A: line from (0.8, 0.9) to (0, -0.9)
      const distLeft = Math.abs(ay - (ax * 2.25 - 0.9));
      const distRight = Math.abs(ay - (-ax * 2.25 - 0.9));
      const isCrossbar = Math.abs(ay - 0.1) < 0.2 && Math.abs(ax) < 0.5;
      if ((distLeft < 0.35 || distRight < 0.35 || isCrossbar) && ay > -0.95 && ay < 0.95) {
        r = 250;
        g = 247;
        b = 242;
      }
    }
  }

  // Cloche golden rim (sy between 0.60 and 0.635)
  if (sy >= 0.60 && sy <= 0.635 && Math.abs(sx - 0.5) <= 0.30) {
    const rimGrad = Math.sin(((sx - 0.2) / 0.6) * Math.PI);
    r = Math.round(lerp(255, 230, rimGrad));
    g = Math.round(lerp(202, 160, rimGrad));
    b = Math.round(lerp(40, 20, rimGrad));
  }

  // Cloche top knob (small golden circle at sx=0.5, sy=0.38)
  const knobDx = (sx - 0.5);
  const knobDy = (sy - 0.38);
  if (knobDx * knobDx + knobDy * knobDy <= 0.025 * 0.025) {
    r = 255;
    g = 210;
    b = 50;
  }

  // Brand text bar: "AMANDITA" plate (sy between 0.68 and 0.77)
  if (sy >= 0.68 && sy <= 0.77 && Math.abs(sx - 0.5) <= 0.34) {
    const textPlateDist = Math.abs(sx - 0.5) / 0.34;
    const alpha = (1 - textPlateDist * textPlateDist) * 0.9;
    r = Math.round(lerp(r, 250, alpha));
    g = Math.round(lerp(g, 247, alpha));
    b = Math.round(lerp(b, 242, alpha));
  }

  // Secondary golden bar: "SABORES" (sy between 0.79 and 0.84)
  if (sy >= 0.79 && sy <= 0.84 && Math.abs(sx - 0.5) <= 0.24) {
    const subPlateDist = Math.abs(sx - 0.5) / 0.24;
    const alpha = (1 - subPlateDist * subPlateDist) * 0.85;
    r = Math.round(lerp(r, 255, alpha));
    g = Math.round(lerp(g, 202, alpha));
    b = Math.round(lerp(b, 40, alpha));
  }

  return [r, g, b, a];
}

const outDir = path.resolve(__dirname, '../public');
if (!fs.existsSync(outDir)) {
  fs.mkdirSync(outDir, { recursive: true });
}

console.log('Generating compliant PWA icons...');

// 1. pwa-192x192.png
const png192 = createPng(192, 192, (x, y, w, h) => renderBrandIcon(x, y, w, h, false));
fs.writeFileSync(path.join(outDir, 'pwa-192x192.png'), png192);
console.log('✓ Created public/pwa-192x192.png (192x192)');

// 2. pwa-512x512.png
const png512 = createPng(512, 512, (x, y, w, h) => renderBrandIcon(x, y, w, h, false));
fs.writeFileSync(path.join(outDir, 'pwa-512x512.png'), png512);
console.log('✓ Created public/pwa-512x512.png (512x512)');

// 3. pwa-maskable-512x512.png (with safe-zone padding)
const pngMaskable512 = createPng(512, 512, (x, y, w, h) => renderBrandIcon(x, y, w, h, true));
fs.writeFileSync(path.join(outDir, 'pwa-maskable-512x512.png'), pngMaskable512);
console.log('✓ Created public/pwa-maskable-512x512.png (512x512 Maskable)');

// 4. apple-touch-icon.png (180x180)
const pngApple180 = createPng(180, 180, (x, y, w, h) => renderBrandIcon(x, y, w, h, false));
fs.writeFileSync(path.join(outDir, 'apple-touch-icon.png'), pngApple180);
console.log('✓ Created public/apple-touch-icon.png (180x180)');

// 5. favicon-32x32.png
const png32 = createPng(32, 32, (x, y, w, h) => renderBrandIcon(x, y, w, h, false));
fs.writeFileSync(path.join(outDir, 'favicon-32x32.png'), png32);
fs.writeFileSync(path.join(outDir, 'favicon.ico'), png32); // Valid PNG in ico or fallback
console.log('✓ Created public/favicon-32x32.png and public/favicon.ico');
