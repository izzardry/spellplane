/**
 * Helpers for the M7 looks' browser specs (PLAN M7-P1 Table worlds). The looks are opened on the render harness
 * (`?harness=render`, scene/render-harness.ts): the real table scene on a 1v1 harness table with placeholder faces, so
 * the specs measure the table world itself. Colours are read from one screenshot per view, decoded in Node
 * (tests/unit/themes/conformance/pixels.ts); screenshots are evidence (artifacts/shots/M7/looks/), never baselines.
 */
import type { Page, TestInfo } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import type { LookId } from '../../../../src/themes/types';
import { decodePng, type Pixels } from '../../../unit/themes/conformance/pixels';
import { settle } from '../../render/helpers';

export const LOOKS: readonly LookId[] = ['kitchen', 'graphite', 'codex'];

export type Rgb = [number, number, number];
export type Rect = { x: number; y: number; width: number; height: number };

/** A decoded screenshot of the viewport and its device pixels per CSS px. */
export interface Capture {
  png: Buffer;
  img: Pixels;
  k: number;
}

/** Move the camera to tilt `t` (0 first person … 1 bird's-eye) at once, then let the scene settle. */
export async function setTilt(page: Page, t: number): Promise<void> {
  await page.evaluate((v) => window.__renderHarness!.camera.setTilt(v, { animate: false }), t);
  await settle(page);
}

export async function capture(page: Page): Promise<Capture> {
  await page.evaluate(() => window.__renderHarness!.redraw());
  const png = await page.screenshot({ animations: 'allow' });
  const img = decodePng(png);
  return { png, img, k: img.width / page.viewportSize()!.width };
}

/** Average sRGB colour (0..255) of a CSS-px rectangle of a capture. */
export function avg(c: Capture, r: Rect): Rgb {
  const x0 = Math.max(0, Math.floor(r.x * c.k));
  const y0 = Math.max(0, Math.floor(r.y * c.k));
  const x1 = Math.min(c.img.width, Math.ceil((r.x + r.width) * c.k));
  const y1 = Math.min(c.img.height, Math.ceil((r.y + r.height) * c.k));
  if (x1 <= x0 || y1 <= y0) throw new Error(`rectangle ${JSON.stringify(r)} is outside the capture`);
  let s0 = 0;
  let s1 = 0;
  let s2 = 0;
  let n = 0;
  for (let y = y0; y < y1; y++)
    for (let x = x0; x < x1; x++) {
      const i = (y * c.img.width + x) * 4;
      s0 += c.img.data[i]!;
      s1 += c.img.data[i + 1]!;
      s2 += c.img.data[i + 2]!;
      n++;
    }
  return [s0 / n, s1 / n, s2 / n];
}

/** A square patch of `r` CSS px around a screen point. */
export const patch = (p: { x: number; y: number }, r = 6): Rect => ({ x: p.x - r, y: p.y - r, width: 2 * r, height: 2 * r });

/** The screen point of a table point (mm, height z), or null behind the camera. */
export async function toScreen(page: Page, x: number, y: number, z = 0): Promise<{ x: number; y: number } | null> {
  return page.evaluate(([a, b, h]) => window.__renderHarness!.toScreen(a!, b!, h!), [x, y, z] as const);
}

/** Whether a point lies inside the viewport with a margin. */
export function onScreen(page: Page, p: { x: number; y: number } | null, margin = 8): p is { x: number; y: number } {
  const vp = page.viewportSize()!;
  return !!p && p.x >= margin && p.y >= margin && p.x <= vp.width - margin && p.y <= vp.height - margin;
}

export const lum = (c: readonly number[]): number => 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
/** Largest channel difference, 0..255. */
export const delta = (a: readonly number[], b: readonly number[]): number => Math.max(...a.map((v, i) => Math.abs(v - b[i]!)));
export const hex255 = (hex: string): Rgb => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as Rgb;
export const fmt = (c: readonly number[]): string => c.map((v) => Math.round(v)).join(',');

/** Save a screenshot as evidence under artifacts/shots/M7/looks/. */
export function evidence(info: TestInfo, name: string, png: Buffer): void {
  const dir = path.join('artifacts', 'shots', 'M7', 'looks');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${name}-${info.project.name}.png`), png);
}
