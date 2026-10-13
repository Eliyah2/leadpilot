/**
 * scripts/make-icons.mjs
 * Maakt de PWA-iconen (PNG) zonder externe libraries: we schrijven de PNG
 * zelf met zlib. Eenmalig draaien: `node scripts/make-icons.mjs`.
 *
 * Het logo is een "send"-driehoek (paper plane) op een donkere afgeronde
 * achtergrond - past bij een leadgenerator die mails verstuurt.
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(__dirname, '..', 'public', 'icons');

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buffer) {
  let crc = -1;
  for (let i = 0; i < buffer.length; i += 1) {
    crc = CRC_TABLE[(crc ^ buffer[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ -1) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeBuffer = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([length, typeBuffer, data, crc]);
}

/** RGBA-buffer omzetten naar een echt PNG-bestand. */
function encodePng(width, height, rgba) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0; // filter type: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }

  return Buffer.concat([
    signature,
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const BG_TOP = [15, 23, 42];
const BG_BOTTOM = [30, 27, 75];
const PLANE_LEFT = [0x38, 0xbd, 0xf8];
const PLANE_RIGHT = [0xa7, 0x8b, 0xfa];

const lerp = (a, b, t) => Math.round(a + (b - a) * t);

/** Ligt punt (x, y) binnen de driehoek? */
function inTriangle(x, y, a, b, c) {
  const sign = (p1, p2, p3) => (p1[0] - p3[0]) * (p2[1] - p3[1]) - (p2[0] - p3[0]) * (p1[1] - p3[1]);
  const d1 = sign([x, y], a, b);
  const d2 = sign([x, y], b, c);
  const d3 = sign([x, y], c, a);
  const hasNegative = d1 < 0 || d2 < 0 || d3 < 0;
  const hasPositive = d1 > 0 || d2 > 0 || d3 > 0;
  return !(hasNegative && hasPositive);
}

function renderIcon(size, { maskable = false } = {}) {
  const rgba = Buffer.alloc(size * size * 4);
  const radius = maskable ? size / 2 : size * 0.24;
  const samples = 3; // 3x3 supersampling voor gladde randen
  const inset = maskable ? size * 0.12 : 0; // maskable: logo binnen veilige zone

  const center = size / 2;
  const planeLeft = size * 0.24 + inset * 0.6;
  const planeRight = size * 0.78 - inset * 0.6;
  const planeTop = size * 0.28 + inset * 0.5;
  const planeBottom = size * 0.72 - inset * 0.5;
  const notchX = planeLeft + (planeRight - planeLeft) * 0.42;

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let bgCoverage = 0;
      let planeCoverage = 0;

      for (let sy = 0; sy < samples; sy += 1) {
        for (let sx = 0; sx < samples; sx += 1) {
          const px = x + (sx + 0.5) / samples;
          const py = y + (sy + 0.5) / samples;

          // Afgeronde rechthoek (of hele cirkel bij maskable)
          const distanceX = Math.abs(px - center) - (size / 2 - radius);
          const distanceY = Math.abs(py - center) - (size / 2 - radius);
          const outside =
            distanceX > 0 && distanceY > 0
              ? Math.hypot(distanceX, distanceY)
              : Math.max(distanceX, distanceY);
          if (outside <= 0) bgCoverage += 1;

          // Paper plane: grote driehoek min een kleinere hap linksonder
          const big = inTriangle(px, py, [planeLeft, planeTop], [planeRight, center], [planeLeft, planeBottom]);
          const notch = inTriangle(
            px,
            py,
            [planeLeft, center - size * 0.06],
            [notchX, center],
            [planeLeft, center + size * 0.06]
          );
          if (big && !notch) planeCoverage += 1;
        }
      }

      const total = samples * samples;
      const bgAlpha = bgCoverage / total;
      const planeAlpha = planeCoverage / total;
      const offset = (y * size + x) * 4;

      const vertical = y / size;
      const bg = [
        lerp(BG_TOP[0], BG_BOTTOM[0], vertical),
        lerp(BG_TOP[1], BG_BOTTOM[1], vertical),
        lerp(BG_TOP[2], BG_BOTTOM[2], vertical),
      ];
      const horizontal = (x - planeLeft) / Math.max(1, planeRight - planeLeft);
      const plane = [
        lerp(PLANE_LEFT[0], PLANE_RIGHT[0], horizontal),
        lerp(PLANE_LEFT[1], PLANE_RIGHT[1], horizontal),
        lerp(PLANE_LEFT[2], PLANE_RIGHT[2], horizontal),
      ];

      const mix = (a, b) => Math.round(a * (1 - planeAlpha) + b * planeAlpha);
      rgba[offset] = mix(bg[0], plane[0]);
      rgba[offset + 1] = mix(bg[1], plane[1]);
      rgba[offset + 2] = mix(bg[2], plane[2]);
      rgba[offset + 3] = Math.round(255 * bgAlpha);
    }
  }

  return encodePng(size, size, rgba);
}

fs.mkdirSync(OUT_DIR, { recursive: true });
const targets = [
  ['icon-192.png', 192, { maskable: false }],
  ['icon-512.png', 512, { maskable: false }],
  ['icon-maskable-512.png', 512, { maskable: true }],
];

targets.forEach(([file, size, options]) => {
  const png = renderIcon(size, options);
  fs.writeFileSync(path.join(OUT_DIR, file), png);
  console.log(`geschreven: public/icons/${file} (${png.length} bytes)`);
});
