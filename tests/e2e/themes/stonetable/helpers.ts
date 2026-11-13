import fs from 'node:fs';
import path from 'node:path';
import type { Page, TestInfo } from '@playwright/test';

export type Rect = { x: number; y: number; width: number; height: number };

/** The union of rectangles, grown by `margin` CSS px on every side and clipped to the viewport. */
export function union(rects: Rect[], margin: number, vp: { width: number; height: number }): Rect {
  const x0 = Math.max(0, Math.min(...rects.map((r) => r.x)) - margin);
  const y0 = Math.max(0, Math.min(...rects.map((r) => r.y)) - margin);
  const x1 = Math.min(vp.width, Math.max(...rects.map((r) => r.x + r.width)) + margin);
  const y1 = Math.min(vp.height, Math.max(...rects.map((r) => r.y + r.height)) + margin);
  return { x: x0, y: y0, width: Math.max(1, x1 - x0), height: Math.max(1, y1 - y0) };
}

/** A rectangle around a segment between two screen points, `pad` px on every side. */
export const segmentRect = (a: { x: number; y: number }, b: { x: number; y: number }, pad = 6): Rect => ({
  x: Math.min(a.x, b.x) - pad,
  y: Math.min(a.y, b.y) - pad,
  width: Math.abs(a.x - b.x) + 2 * pad,
  height: Math.abs(a.y - b.y) + 2 * pad,
});

/** A full-viewport screenshot (the canvas cannot be read back: preserveDrawingBuffer is off). */
export async function shot(page: Page): Promise<Buffer> {
  return page.screenshot({ animations: 'allow', caret: 'hide' });
}

/** A screen segment with the half-width (CSS px) of the band around it that a line may cover. */
export type Band = { a: { x: number; y: number }; b: { x: number; y: number }; half: number };

/**
 * Fraction of the pixels of `rect` (CSS px) whose largest channel difference between two screenshots exceeds
 * `channelDelta` (0..255), decoded in the page. With `bands`, only pixels within one of the bands count (a thin
 * line's region is the band along it, not its bounding box).
 */
export async function changed(page: Page, a: Buffer, b: Buffer, rect: Rect, channelDelta = 24, bands: Band[] = []): Promise<number> {
  return page.evaluate(
    async ([pa, pb, r, delta, bs]) => {
      const decode = async (b64: string) => {
        const img = new Image();
        img.src = `data:image/png;base64,${b64}`;
        await img.decode();
        const c = document.createElement('canvas');
        c.width = img.naturalWidth;
        c.height = img.naturalHeight;
        const ctx = c.getContext('2d')!;
        ctx.drawImage(img, 0, 0);
        return { ctx, scale: img.naturalWidth / innerWidth };
      };
      const A = await decode(pa as string);
      const B = await decode(pb as string);
      const s = A.scale;
      const rr = r as { x: number; y: number; width: number; height: number };
      const x = Math.round(rr.x * s);
      const y = Math.round(rr.y * s);
      const w = Math.max(1, Math.round(rr.width * s));
      const h = Math.max(1, Math.round(rr.height * s));
      const da = A.ctx.getImageData(x, y, w, h).data;
      const db = B.ctx.getImageData(x, y, w, h).data;
      const segs = bs as { a: { x: number; y: number }; b: { x: number; y: number }; half: number }[];
      const inBand = (px: number, py: number): boolean => {
        if (segs.length === 0) return true;
        return segs.some(({ a: p, b: q, half }) => {
          const vx = q.x - p.x;
          const vy = q.y - p.y;
          const l2 = vx * vx + vy * vy;
          const t = l2 > 0 ? Math.max(0, Math.min(1, ((px - p.x) * vx + (py - p.y) * vy) / l2)) : 0;
          return Math.hypot(px - (p.x + t * vx), py - (p.y + t * vy)) <= half;
        });
      };
      let n = 0;
      let total = 0;
      for (let i = 0; i < da.length; i += 4) {
        const k = i / 4;
        if (!inBand((x + (k % w) + 0.5) / s, (y + Math.floor(k / w) + 0.5) / s)) continue;
        total++;
        const d = Math.max(Math.abs(da[i]! - db[i]!), Math.abs(da[i + 1]! - db[i + 1]!), Math.abs(da[i + 2]! - db[i + 2]!));
        if (d > (delta as number)) n++;
      }
      return total > 0 ? n / total : 0;
    },
    [a.toString('base64'), b.toString('base64'), rect, channelDelta, bands] as const,
  );
}

/** Brightest, 99.5th-percentile and mean luminance (0..255, Rec. 709 weights on sRGB values) of a rectangle of the screen. */
export async function luminance(page: Page, rect: Rect): Promise<{ max: number; p995: number; mean: number }> {
  const png = await page.screenshot({ clip: rect, animations: 'allow' });
  return page.evaluate(async (b64) => {
    const img = new Image();
    img.src = `data:image/png;base64,${b64}`;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.naturalWidth;
    c.height = img.naturalHeight;
    const ctx = c.getContext('2d')!;
    ctx.drawImage(img, 0, 0);
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    const ls: number[] = [];
    let sum = 0;
    for (let i = 0; i < d.length; i += 4) {
      const l = 0.2126 * d[i]! + 0.7152 * d[i + 1]! + 0.0722 * d[i + 2]!;
      ls.push(l);
      sum += l;
    }
    ls.sort((x, y) => x - y);
    return { max: ls[ls.length - 1] ?? 0, p995: ls[Math.floor((ls.length - 1) * 0.995)] ?? 0, mean: sum / ls.length };
  }, png.toString('base64'));
}

/** Write a screenshot as review evidence (screenshots are evidence, not baselines). */
export function evidence(info: TestInfo, name: string, png: Buffer): void {
  const dir = path.join('artifacts', 'shots', 'M4', 'stonetable');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${name}-${info.project.name}.png`), png);
}
