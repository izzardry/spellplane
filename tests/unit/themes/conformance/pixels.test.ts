// The measuring instrument of the signal conformance check (PLAN M4-P6: "differs from its neutral version by a measured
// contrast threshold in a controlled screenshot pair"; themes/signals.ts SignalThreshold): the PNG decoder reads what
// it is given exactly, and the metric counts exactly the pixels that changed by more than the channel threshold.
import { describe, expect, it } from 'vitest';
import { deflateSync } from 'node:zlib';
import { DEFAULT_SIGNAL_THRESHOLD } from '../../../../src/themes/signals';
import { changedFraction, crop, decodePng, encodePng, measurePair, unionRect, type Pixels } from './pixels';

function image(width: number, height: number, fill: (x: number, y: number) => [number, number, number]): Pixels {
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const [r, g, b] = fill(x, y);
      data.set([r, g, b, 255], (y * width + x) * 4);
    }
  return { width, height, data };
}

const noisy = image(13, 7, (x, y) => [(x * 37 + y * 11) % 256, (x * x + y * 53) % 256, (x * y * 7 + 200) % 256]);

describe('PNG decoding', () => {
  it.each([0, 1, 2, 3, 4] as const)('round-trips every pixel with row filter %i', (filter) => {
    const back = decodePng(encodePng(noisy, filter));
    expect(back.width).toBe(13);
    expect(back.height).toBe(7);
    expect([...back.data]).toEqual([...noisy.data]);
  });

  it('reads RGB (colour type 2) images, the kind screenshots without alpha are', () => {
    const w = 3;
    const h = 2;
    const raw = Buffer.alloc((w * 3 + 1) * h);
    for (let y = 0; y < h; y++) for (let i = 0; i < w * 3; i++) raw[y * (w * 3 + 1) + 1 + i] = (y * 50 + i * 20) % 256;
    const png = encodePng(image(w, h, () => [0, 0, 0]));
    // Rebuild the same PNG with an RGB header and the RGB rows.
    const ihdrAt = 8;
    const ihdr = Buffer.from(png.subarray(ihdrAt, ihdrAt + 25));
    ihdr[8 + 9] = 2;
    const fixCrc = (chunk: Buffer): Buffer => {
      const body = chunk.subarray(4, chunk.length - 4);
      let c = 0xffffffff;
      for (const x of body) {
        c ^= x;
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      }
      chunk.writeUInt32BE((c ^ 0xffffffff) >>> 0, chunk.length - 4);
      return chunk;
    };
    const idatBody = deflateSync(raw);
    const idat = Buffer.alloc(12 + idatBody.length);
    idat.writeUInt32BE(idatBody.length, 0);
    idat.write('IDAT', 4, 'latin1');
    idatBody.copy(idat, 8);
    const iend = Buffer.from([0, 0, 0, 0, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82]);
    const rgb = Buffer.concat([png.subarray(0, 8), fixCrc(ihdr), fixCrc(idat), iend]);
    const img = decodePng(rgb);
    expect(img.width).toBe(3);
    expect([...img.data.subarray(0, 8)]).toEqual([0, 20, 40, 255, 60, 80, 100, 255]);
    expect([...img.data.subarray(12, 16)]).toEqual([50, 70, 90, 255]);
  });

  it('refuses what it cannot read instead of guessing', () => {
    expect(() => decodePng(Buffer.from('not a png at all'))).toThrow('not a PNG');
  });
});

describe('changed-pixel metric', () => {
  const white = image(10, 10, () => [255, 255, 255]);

  it('is 0 for identical images and 1 when every pixel changed beyond the threshold', () => {
    expect(changedFraction(white, white, 24)).toBe(0);
    expect(changedFraction(white, image(10, 10, () => [0, 0, 0]), 24)).toBe(1);
  });

  it('counts a pixel only when some channel moved by more than channelDelta', () => {
    const atDelta = image(10, 10, () => [255 - 24, 255, 255]);
    const beyond = image(10, 10, () => [255, 255 - 25, 255]);
    expect(changedFraction(white, atDelta, 24)).toBe(0);
    expect(changedFraction(white, beyond, 24)).toBe(1);
  });

  it('measures the fraction of the region: a one-pixel ring around 10×10 is 36%', () => {
    const ring = image(10, 10, (x, y) => (x === 0 || y === 0 || x === 9 || y === 9 ? [31, 111, 209] : [255, 255, 255]));
    expect(changedFraction(white, ring, DEFAULT_SIGNAL_THRESHOLD.channelDelta)).toBeCloseTo(0.36, 10);
  });

  it('refuses images of different size', () => {
    expect(() => changedFraction(white, image(9, 10, () => [0, 0, 0]), 24)).toThrow('sizes differ');
  });

  it('subtracts the noise floor, so flicker between two neutral captures does not count as the signal', () => {
    const flicker = image(10, 10, (x) => (x < 3 ? [0, 0, 0] : [255, 255, 255]));
    const signalled = image(10, 10, (x) => (x < 4 ? [0, 0, 0] : [255, 255, 255]));
    const m = measurePair(white, flicker, signalled, 24);
    expect(m.changed).toBeCloseTo(0.4, 10);
    expect(m.noise).toBeCloseTo(0.3, 10);
    expect(m.signal).toBeCloseTo(0.1, 10);
  });
});

describe('regions', () => {
  it('unites rectangles and grows them by the margin', () => {
    expect(unionRect([{ x: 10, y: 20, width: 5, height: 5 }, { x: 30, y: 0, width: 10, height: 10 }], 2)).toEqual({ x: 8, y: -2, width: 34, height: 29 });
  });

  it('crops in device pixels, snapped outward and cut to the image', () => {
    const img = image(20, 10, (x, y) => [x, y, 0]);
    const c = crop(img, { x: 2.3, y: 1, width: 3, height: 2 }, 2);
    expect(c.width).toBe(7);
    expect(c.height).toBe(4);
    expect([...c.data.subarray(0, 4)]).toEqual([4, 2, 0, 255]);
    const edge = crop(img, { x: -5, y: -5, width: 8, height: 8 }, 1);
    expect([edge.width, edge.height]).toEqual([3, 3]);
    expect(() => crop(img, { x: 50, y: 50, width: 2, height: 2 }, 1)).toThrow('outside');
  });
});
