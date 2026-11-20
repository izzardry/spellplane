#!/usr/bin/env node
/**
 * Writes src/ui/design/grain.png: the paper grain of sheets and tiles (docs/design/m8/visual.md 2.3 `--ds-texture-grain`,
 * "160 px tile, 5 % ink, bundled; on sheets and tiles only"). Seeded value noise, so the file is the same on every run;
 * ink-coloured pixels with a small alpha, tileable (the noise lattice wraps). No dependency: the PNG is written with zlib.
 *
 *   node scripts/make-grain.mjs [out.png]
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const SIZE = 160;
const INK = [13, 13, 13];
/** Mean alpha about 5 % (visual.md), never above 12 %. */
const MAX_ALPHA = 0.12;

/** mulberry32: a small seeded generator. */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Tileable value noise at one octave: a lattice of `cells` × `cells` that wraps at the tile edge. */
function octave(rand, cells) {
  const lat = Array.from({ length: cells * cells }, () => rand());
  const at = (x, y) => lat[((y + cells) % cells) * cells + ((x + cells) % cells)];
  const smooth = (t) => t * t * (3 - 2 * t);
  return (px, py) => {
    const fx = (px / SIZE) * cells;
    const fy = (py / SIZE) * cells;
    const x0 = Math.floor(fx);
    const y0 = Math.floor(fy);
    const tx = smooth(fx - x0);
    const ty = smooth(fy - y0);
    const a = at(x0, y0) + (at(x0 + 1, y0) - at(x0, y0)) * tx;
    const b = at(x0, y0 + 1) + (at(x0 + 1, y0 + 1) - at(x0, y0 + 1)) * tx;
    return a + (b - a) * ty;
  };
}

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

export function grainPixels(seed = 0x5b11) {
  const rand = rng(seed);
  const fine = octave(rand, 80);
  const mid = octave(rand, 40);
  const white = rng(seed ^ 0x9e3779b9);
  const px = Buffer.alloc(SIZE * SIZE * 4);
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const v = 0.45 * fine(x, y) + 0.25 * mid(x, y) + 0.3 * white();
      const alpha = Math.max(0, Math.min(MAX_ALPHA, (v - 0.25) * 0.16));
      const i = (y * SIZE + x) * 4;
      px[i] = INK[0];
      px[i + 1] = INK[1];
      px[i + 2] = INK[2];
      px[i + 3] = Math.round(alpha * 255);
    }
  }
  return px;
}

export function encodePng(px) {
  const raw = Buffer.alloc((SIZE * 4 + 1) * SIZE);
  for (let y = 0; y < SIZE; y++) {
    raw[y * (SIZE * 4 + 1)] = 0;
    px.copy(raw, y * (SIZE * 4 + 1) + 1, y * SIZE * 4, (y + 1) * SIZE * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(SIZE, 0);
  ihdr.writeUInt32BE(SIZE, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const out = process.argv[2] ?? path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'src', 'ui', 'design', 'grain.png');
const png = encodePng(grainPixels());
fs.writeFileSync(out, png);
console.log(`grain: ${out} (${png.length} bytes, ${SIZE} px)`);
