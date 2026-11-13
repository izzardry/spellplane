#!/usr/bin/env node
// Draws Spellplane's own app icons into public/icons/ (PLAN Milestone 5, owner decisions, Installable on iPad: icons
// with no Wizards marks). The mark is the neutral card-back motif of the favicon: a dark field with a light, slightly
// turned card carrying an inset frame and a diamond. Pure Node (zlib), no image library; rerun after changing it:
//   node scripts/make-icons.mjs
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const OUT = path.join('public', 'icons');
const BG = [0x11, 0x11, 0x11];
const CARD = [0xf4, 0xf1, 0xea];
const INK = [0x11, 0x11, 0x11];

/** Signed distance to a rounded rectangle centred at the origin (half sizes hx, hy, corner radius r). */
function roundedRect(x, y, hx, hy, r) {
  const qx = Math.abs(x) - (hx - r);
  const qy = Math.abs(y) - (hy - r);
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
}

/**
 * Colour at a point of the unit icon (-1..1 both ways). `scale` shrinks the mark (maskable icons keep it inside the
 * safe zone); `round` rounds the field's corners (null: square, full bleed).
 */
function colourAt(x, y, scale, round) {
  if (round !== null && roundedRect(x, y, 1, 1, round) > 0) return null;
  const a = (-8 * Math.PI) / 180;
  const u = (x * Math.cos(a) + y * Math.sin(a)) / scale;
  const v = (-x * Math.sin(a) + y * Math.cos(a)) / scale;
  const hx = 0.5;
  const hy = 0.7;
  if (roundedRect(u, v, hx, hy, 0.08) > 0) return BG;
  // Inset frame line.
  const frame = roundedRect(u, v, hx - 0.09, hy - 0.09, 0.04);
  if (frame <= 0 && frame > -0.035) return INK;
  // Diamond in the middle.
  if (Math.abs(u) / 0.22 + Math.abs(v) / 0.32 <= 1) return INK;
  return CARD;
}

function render(size, { scale = 1, round = 0.22, transparent = true } = {}) {
  const S = 4; // supersamples per axis
  const px = Buffer.alloc(size * size * 4);
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let n = 0;
      for (let sj = 0; sj < S; sj++) {
        for (let si = 0; si < S; si++) {
          const x = ((i + (si + 0.5) / S) / size) * 2 - 1;
          const y = ((j + (sj + 0.5) / S) / size) * 2 - 1;
          const c = colourAt(x, y, scale, round);
          if (!c) continue;
          r += c[0];
          g += c[1];
          b += c[2];
          n++;
        }
      }
      const o = (j * size + i) * 4;
      const cover = n / (S * S);
      if (n === 0) {
        px[o + 3] = transparent ? 0 : 255;
        continue;
      }
      px[o] = Math.round(r / n);
      px[o + 1] = Math.round(g / n);
      px[o + 2] = Math.round(b / n);
      px[o + 3] = transparent ? Math.round(cover * 255) : 255;
    }
  }
  return png(size, px);
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
function png(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

fs.mkdirSync(OUT, { recursive: true });
const files = {
  'icon-192.png': render(192),
  'icon-512.png': render(512),
  // Maskable: full bleed, the mark inside the central 80 % safe zone.
  'icon-512-maskable.png': render(512, { scale: 0.78, round: null, transparent: false }),
  // iOS draws the Home Screen icon on black and rounds it itself: opaque, square, full bleed.
  'apple-touch-icon.png': render(180, { scale: 0.9, round: null, transparent: false }),
};
for (const [name, data] of Object.entries(files)) {
  fs.writeFileSync(path.join(OUT, name), data);
  console.log(`${path.join(OUT, name)} ${data.length} bytes`);
}
