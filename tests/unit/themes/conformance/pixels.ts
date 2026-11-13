/**
 * Pixel maths of the signal conformance check (PLAN M4-P6: "the signalled card or element differs from its neutral
 * version by a measured contrast threshold in a controlled screenshot pair"; themes/signals.ts SignalThreshold). Shared
 * by tests/e2e/signals.spec.ts and its unit tests here. Node only: a PNG decoder for the 8-bit, non-interlaced RGB and
 * RGBA images Playwright's screenshots are, and the changed-pixel metric. No dependency beyond node:zlib.
 */
import { deflateSync, inflateSync } from 'node:zlib';

/** Decoded image: RGBA, 8 bits per channel, row-major. */
export interface Pixels {
  width: number;
  height: number;
  data: Uint8Array;
}

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Decode an 8-bit, non-interlaced PNG (colour type 0, 2, 4 or 6) to RGBA. */
export function decodePng(png: Uint8Array): Pixels {
  const buf = Buffer.from(png);
  if (!buf.subarray(0, 8).equals(SIGNATURE)) throw new Error('not a PNG');
  let off = 8;
  let width = 0;
  let height = 0;
  let colourType = -1;
  const idat: Buffer[] = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('latin1', off + 4, off + 8);
    const body = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      const depth = body[8];
      colourType = body[9]!;
      if (depth !== 8) throw new Error(`unsupported PNG bit depth ${String(depth)}`);
      if (body[12] !== 0) throw new Error('interlaced PNGs are not supported');
    } else if (type === 'IDAT') idat.push(body);
    else if (type === 'IEND') break;
    off += 12 + len;
  }
  const channels = ({ 0: 1, 2: 3, 4: 2, 6: 4 } as Record<number, number>)[colourType];
  if (!channels) throw new Error(`unsupported PNG colour type ${colourType}`);
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const out = new Uint8Array(width * height * 4);
  let prev = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]!;
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const cur = new Uint8Array(stride);
    for (let i = 0; i < stride; i++) {
      const a = i >= channels ? cur[i - channels]! : 0;
      const b = prev[i]!;
      const c = i >= channels ? prev[i - channels]! : 0;
      const x = line[i]!;
      let v: number;
      if (filter === 0) v = x;
      else if (filter === 1) v = x + a;
      else if (filter === 2) v = x + b;
      else if (filter === 3) v = x + ((a + b) >> 1);
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        v = x + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
      } else throw new Error(`bad PNG filter ${filter}`);
      cur[i] = v & 0xff;
    }
    for (let px = 0; px < width; px++) {
      const o = (y * width + px) * 4;
      const s = px * channels;
      if (channels >= 3) {
        out[o] = cur[s]!;
        out[o + 1] = cur[s + 1]!;
        out[o + 2] = cur[s + 2]!;
        out[o + 3] = channels === 4 ? cur[s + 3]! : 255;
      } else {
        out[o] = out[o + 1] = out[o + 2] = cur[s]!;
        out[o + 3] = channels === 2 ? cur[s + 1]! : 255;
      }
    }
    prev = cur;
  }
  return { width, height, data: out };
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(b: Buffer): number {
  let c = 0xffffffff;
  for (const x of b) c = CRC_TABLE[(c ^ x) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, body: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(body.length);
  const tb = Buffer.concat([Buffer.from(type, 'latin1'), body]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(tb));
  return Buffer.concat([len, tb, crc]);
}

/** Encode RGBA pixels as a PNG; `filter` picks one row filter for every row (tests exercise the decoder's filters). */
export function encodePng(img: Pixels, filter: 0 | 1 | 2 | 3 | 4 = 0): Buffer {
  const { width, height, data } = img;
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = filter;
    for (let i = 0; i < stride; i++) {
      const x = data[y * stride + i]!;
      const a = i >= 4 ? data[y * stride + i - 4]! : 0;
      const b = y > 0 ? data[(y - 1) * stride + i]! : 0;
      const c = i >= 4 && y > 0 ? data[(y - 1) * stride + i - 4]! : 0;
      let pred = 0;
      if (filter === 1) pred = a;
      else if (filter === 2) pred = b;
      else if (filter === 3) pred = (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        pred = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      raw[y * (stride + 1) + 1 + i] = (x - pred) & 0xff;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([SIGNATURE, chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

/**
 * Fraction (0..1) of pixels whose largest R, G or B difference exceeds `channelDelta` (0–255). Both images must have
 * the same size. Alpha is ignored: screenshots are opaque.
 */
export function changedFraction(a: Pixels, b: Pixels, channelDelta: number): number {
  if (a.width !== b.width || a.height !== b.height) throw new Error(`image sizes differ: ${a.width}×${a.height} and ${b.width}×${b.height}`);
  const n = a.width * a.height;
  if (n === 0) throw new Error('empty image');
  let changed = 0;
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    const d = Math.max(Math.abs(a.data[o]! - b.data[o]!), Math.abs(a.data[o + 1]! - b.data[o + 1]!), Math.abs(a.data[o + 2]! - b.data[o + 2]!));
    if (d > channelDelta) changed++;
  }
  return changed / n;
}

/** A screen rectangle in CSS px. */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The smallest rectangle around all of them, grown by `margin` px on every side. */
export function unionRect(rects: Rect[], margin = 0): Rect {
  if (rects.length === 0) throw new Error('no rectangles');
  const x0 = Math.min(...rects.map((r) => r.x)) - margin;
  const y0 = Math.min(...rects.map((r) => r.y)) - margin;
  const x1 = Math.max(...rects.map((r) => r.x + r.width)) + margin;
  const y1 = Math.max(...rects.map((r) => r.y + r.height)) + margin;
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

/** One measured pair, as the conformance spec records it. */
export interface PairMeasure {
  /** Changed fraction between the neutral and the signalled image. */
  changed: number;
  /** Changed fraction between two neutral images taken apart (animation, particles): the noise floor. */
  noise: number;
  /** `changed - noise`, the part of the difference the signal accounts for. */
  signal: number;
}

/**
 * Measure a controlled pair: the signal's part of the difference is what changed between neutral and signalled beyond
 * what changes between two neutral captures on its own (particles, flicker), so a busy theme cannot pass on noise.
 */
export function measurePair(neutral: Pixels, neutralAgain: Pixels, signalled: Pixels, channelDelta: number): PairMeasure {
  const changed = changedFraction(neutral, signalled, channelDelta);
  const noise = changedFraction(neutral, neutralAgain, channelDelta);
  return { changed, noise, signal: changed - noise };
}

/**
 * Cut a region (CSS px) out of a full-page screenshot whose device pixel ratio is `scale` (image px per CSS px). The
 * region is first cut to the image and snapped outward to whole device pixels.
 */
export function crop(img: Pixels, r: Rect, scale = 1): Pixels {
  const x0 = Math.max(0, Math.floor(r.x * scale));
  const y0 = Math.max(0, Math.floor(r.y * scale));
  const x1 = Math.min(img.width, Math.ceil((r.x + r.width) * scale));
  const y1 = Math.min(img.height, Math.ceil((r.y + r.height) * scale));
  if (x1 <= x0 || y1 <= y0) throw new Error(`region ${JSON.stringify(r)} is outside the ${img.width}×${img.height} image`);
  const width = x1 - x0;
  const height = y1 - y0;
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) data.set(img.data.subarray(((y0 + y) * img.width + x0) * 4, ((y0 + y) * img.width + x1) * 4), y * width * 4);
  return { width, height, data };
}
