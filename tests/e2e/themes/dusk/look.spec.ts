/**
 * Dusk's look in the browser (DESIGN "Themes and rendering", theme table, Dusk: "Dark felt under a single warm lamp,
 * soft contact shadows, vignette"; "Soft bloom on lines, slow light falloff, muted ambience"; Assets: procedural or
 * CC0, nothing of Wizards). Measured on screenshots and through the debug hook, never against pixel baselines; the
 * full-table screenshots are written to artifacts/shots/M4/dusk/ as evidence.
 */
import { expect, test, type Page, type TestInfo } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import * as THREE from 'three';
import type { RenderStats } from '../../../../src/scene/types';
import type { SceneDebugCard } from '../../../../src/scene/table-scene';
import { DUSK_SURFACE } from '../../../../src/themes/dusk/index';
import { AMBIENCE_PEAK, CUE_MAX_S, CUE_PEAK } from '../../../../src/themes/dusk/sounds';
import { hexToRgb } from '../../../../src/themes/signals';
import { averageColour, dusk, hookCall, openDusk, settle, shot, type Rect } from './bundle';
import type { CueReport } from './page';

const act = (page: Page, a: Record<string, unknown>) => dusk(page, 'dispatch', a);
const cards = (page: Page) => hookCall<SceneDebugCard[]>(page, 'cards');
async function cardRect(page: Page, id: string): Promise<Rect> {
  const c = (await cards(page)).find((x) => x.id === id);
  if (!c) throw new Error(`card ${id} is not drawn`);
  return { x: c.screen.x, y: c.screen.y, width: c.screen.width, height: c.screen.height };
}
const lum = (c: readonly number[]) => 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
const patchAt = (p: { x: number; y: number }, r = 12): Rect => ({ x: p.x - r, y: p.y - r, width: 2 * r, height: 2 * r });

function evidence(info: TestInfo, name: string, png: string): void {
  const dir = path.join('artifacts', 'shots', 'M4', 'dusk');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${name}-${info.project.name}.png`), Buffer.from(png, 'base64'));
}

/** A small mid-game table: creatures, a land cascade, a tapped card, a face-down card, a stack item and two lines. */
async function demoTable(page: Page): Promise<void> {
  let n = 0;
  const tok = (by: string, zone: string, x: number, y: number, rot: number) => act(page, { by, type: 'createToken', card: `k${++n}`, zone, pose: { x, y, rot }, ref: { sid: `fx-${n * 3}` } });
  for (let i = 0; i < 5; i++) await tok('s0', 'battlefield:s0', -280 + i * 75, -230, 0);
  for (let i = 0; i < 4; i++) await tok('s1', 'battlefield:s1', 200 - i * 75, 230, 180);
  await act(page, { type: 'tap', card: 'k2', tapped: true });
  await act(page, { by: 's1', type: 'flip', card: 'k7', face: 'down' });
  await act(page, { type: 'moveTemp', card: 'k3', pose: { x: -130, y: -120, rot: 0 }, combat: 'attack', tap: true });
  await act(page, { type: 'lineAdd', line: 'l1', kind: 'target', from: { kind: 'card', id: 'k1' }, to: { kind: 'card', id: 'k8' } });
  await act(page, { by: 's1', type: 'lineAdd', line: 'l2', kind: 'target', from: { kind: 'card', id: 'k6' }, to: { kind: 'card', id: 'k5' } });
  await act(page, { type: 'stackPush', item: 'i1', kind: 'ability', source: 'k4', note: 'draw a card' });
  await settle(page);
}

test.describe('Dusk look', () => {
  test.describe.configure({ timeout: 90_000 });

  test('runs the lit pipeline it declares: bloom, vignette, contact shadows, ACES, card boxes, no shadow maps', async ({ page }, info) => {
    const opened = await openDusk(page);
    await demoTable(page);
    const stats = await dusk<RenderStats>(page, 'stats');
    expect(stats.theme).toBe('dusk');
    expect(stats.passes).toEqual(['render', 'glow', 'bloom', 'vignette', 'output']);
    expect(stats.shadows).toBe(true);
    const p = await dusk<{ boxes: boolean; contactShadows: boolean; faceShade: number; toneMapping: number }>(page, 'pipeline');
    expect(p).toMatchObject({ boxes: true, contactShadows: true, faceShade: 0.02, toneMapping: THREE.ACESFilmicToneMapping });
    evidence(info, 'table', await shot(page));
    // Low quality drops contact shadows and post-processing first (DESIGN "Themes and rendering", Renderer).
    await dusk(page, 'setQuality', 'low');
    await settle(page);
    const low = await dusk<RenderStats>(page, 'stats');
    expect(low.passes).toEqual([]);
    expect(low.shadows).toBe(false);
    evidence(info, 'table-low', await shot(page));
    expect(opened.errors).toEqual([]);
  });

  test('dark felt under a warm lamp whose light falls off slowly toward the edges', async ({ page }, info) => {
    const opened = await openDusk(page);
    await settle(page);
    const png = await shot(page);
    evidence(info, 'empty', png);
    const at = async (x: number, y: number) => {
      const s = await dusk<{ x: number; y: number }>(page, 'toScreen', x, y);
      return averageColour(page, png, patchAt(s));
    };
    // Felt between the zones, from the middle of the table out toward the near-left corner (1400 × 1100 table).
    const centre = await at(0, -60);
    const mid = await at(-330, -300);
    const corner = await at(-660, -520);
    info.annotations.push({ type: 'felt', description: `centre ${centre.map(Math.round)} mid ${mid.map(Math.round)} corner ${corner.map(Math.round)}` });
    // Dark: the lit centre of the felt stays low-key.
    expect(lum(centre)).toBeLessThan(90);
    expect(lum(corner)).toBeGreaterThan(4);
    // Warm light on green felt: the cloth stays green (green over red and blue), the lamp warms it (red over blue).
    expect(centre[1]).toBeGreaterThan(centre[0]);
    expect(centre[1]).toBeGreaterThan(centre[2]);
    // Slow falloff: brightest under the lamp, darker half-way out, darkest in the corner, with no hard edge between.
    expect(lum(centre)).toBeGreaterThan(lum(mid));
    expect(lum(mid)).toBeGreaterThan(lum(corner));
    expect(lum(centre) - lum(corner)).toBeGreaterThan(8);
    expect((lum(centre) - lum(mid)) / (lum(centre) - lum(corner))).toBeLessThan(0.85);
    // The surface token (HUD, contrast rules) is the felt as it appears half-way out.
    const token = hexToRgb(DUSK_SURFACE).map((c) => c * 255);
    for (let i = 0; i < 3; i++) expect(Math.abs(mid[i]! - token[i]!), `surface token channel ${i}`).toBeLessThan(16);
    // The room around the table is darker still.
    const vp = page.viewportSize()!;
    const room = await averageColour(page, png, { x: 2, y: vp.height / 2 - 10, width: 8, height: 20 });
    expect(lum(room)).toBeLessThan(lum(corner) + 2);
    expect(opened.errors).toEqual([]);
  });

  test('soft bloom on lines: a glow beside the stroke with post-processing on, none without', async ({ page }, info) => {
    const opened = await openDusk(page);
    await act(page, { type: 'createToken', card: 'c1', zone: 'battlefield:s0', pose: { x: -150, y: -200, rot: 0 }, ref: { sid: 'fx-3' } });
    await act(page, { type: 'createToken', card: 'c2', zone: 'battlefield:s0', pose: { x: 150, y: -200, rot: 0 }, ref: { sid: 'fx-11' } });
    await settle(page);
    const halo = async (name: string): Promise<number> => {
      const [a, b] = [await cardRect(page, 'c1'), await cardRect(page, 'c2')];
      const y = Math.round(a.y + a.height / 2);
      const x = a.x + a.width + 20;
      const width = b.x - (a.x + a.width) - 60;
      const before = await shot(page);
      await act(page, { type: 'lineAdd', line: `t-${name}`, kind: 'target', from: { kind: 'card', id: 'c1' }, to: { kind: 'card', id: 'c2' } });
      await settle(page);
      const png = await shot(page);
      evidence(info, `line-${name}`, png);
      // Dusk's bird's-eye is tilted 10° (camera.birdseyeTiltDeg), so the stroke's lift above the table puts it a few
      // pixels off the cards' centre line: find its row first (the row the line brightens most), then measure bands
      // beside it, clear of the stroke itself (2 px wide at most) and its arrowhead.
      const rowGain = async (row: number) => lum(await averageColour(page, png, { x, y: row, width, height: 1 })) - lum(await averageColour(page, before, { x, y: row, width, height: 1 }));
      let stroke = y;
      let best = -Infinity;
      for (let row = y - 24; row <= y + 8; row++) {
        const g = await rowGain(row);
        if (g > best) [best, stroke] = [g, row];
      }
      const band = async (top: number) => lum(await averageColour(page, png, { x, y: top, width, height: 5 })) - lum(await averageColour(page, before, { x, y: top, width, height: 5 }));
      const beside = ((await band(stroke - 8)) + (await band(stroke + 4))) / 2;
      await act(page, { type: 'lineRemove', line: `t-${name}` });
      await settle(page);
      return beside;
    };
    const bloomed = await halo('high');
    await dusk(page, 'setQuality', 'low');
    await settle(page);
    const plain = await halo('low');
    info.annotations.push({ type: 'halo', description: `beside the line: +${bloomed.toFixed(2)} with bloom, +${plain.toFixed(2)} without` });
    // A clearly visible glow a few pixels beside the stroke (tuned at about +35 of 255), and none at all without post.
    expect(bloomed).toBeGreaterThan(8);
    expect(plain).toBeLessThan(0.5);
    expect(opened.errors).toEqual([]);
  });

  test('soft contact shadows darken the felt just around a card and not further out', async ({ page }) => {
    const opened = await openDusk(page);
    await act(page, { type: 'createToken', card: 'c1', zone: 'battlefield:s0', pose: { x: 0, y: -200, rot: 0 }, ref: { sid: 'fx-3' } });
    await settle(page);
    const measureAround = async (): Promise<{ near: number; far: number }> => {
      const r = await cardRect(page, 'c1');
      const png = await shot(page);
      const k = r.height / 88;
      // Felt 1–4 mm left of the card's edge, and 25–28 mm left of it.
      const near = await averageColour(page, png, { x: r.x - 4 * k, y: r.y + r.height * 0.3, width: 3 * k, height: r.height * 0.4 });
      const far = await averageColour(page, png, { x: r.x - 28 * k, y: r.y + r.height * 0.3, width: 3 * k, height: r.height * 0.4 });
      return { near: lum(near), far: lum(far) };
    };
    const on = await measureAround();
    // Medium keeps bloom and vignette but drops shadows (the quality ladder), so only the contact shadow changes.
    await dusk(page, 'setQuality', 'medium');
    await settle(page);
    const off = await measureAround();
    test.info().annotations.push({ type: 'contact', description: `near ${on.near.toFixed(1)} / far ${on.far.toFixed(1)} with contact shadows; near ${off.near.toFixed(1)} / far ${off.far.toFixed(1)} without` });
    expect(on.near).toBeLessThan(off.near - 3);
    expect(Math.abs(on.far - off.far)).toBeLessThan(1.5);
    expect(opened.errors).toEqual([]);
  });

  test('fetches nothing: every Dusk asset is procedural', async ({ page }) => {
    const opened = await openDusk(page);
    await demoTable(page);
    expect(opened.external).toEqual([]);
    // The page itself is the only document; textures, the card back and sounds are drawn in code.
    const fetched = opened.requests.filter((u) => !u.startsWith('data:') && !u.startsWith('blob:') && !u.includes('/dusk-harness.html'));
    expect(fetched).toEqual([]);
    expect(opened.errors).toEqual([]);
  });

  test('a dark HUD: avatars take Dusk’s tokens', async ({ page }) => {
    const opened = await openDusk(page);
    const avatar = page.locator('[data-testid="avatar"][data-seat="s0"]');
    await expect(avatar).toBeVisible();
    const style = await avatar.evaluate((el) => {
      const cs = getComputedStyle(el);
      return { bg: cs.backgroundColor, fg: cs.color, scheme: getComputedStyle(el.parentElement!.parentElement!).colorScheme };
    });
    expect(style.scheme).toBe('dark');
    // As in the app (hudCssVars): the avatar is a HUD panel (tokens.hud.panel), not the felt, with light text (fg).
    expect(style.bg).toBe('rgba(20, 18, 24, 0.9)');
    expect(style.fg).toBe('rgb(236, 230, 218)');
    expect(opened.errors).toEqual([]);
  });

  test('switches from Paper to Dusk and back mid-game without errors or a change of the table', async ({ page }, info) => {
    const opened = await openDusk(page, { theme: 'paper' });
    await demoTable(page);
    const before = JSON.stringify(await dusk(page, 'state'));
    await dusk(page, 'setTheme', 'dusk');
    await settle(page);
    expect((await dusk<RenderStats>(page, 'stats')).theme).toBe('dusk');
    evidence(info, 'switched', await shot(page));
    await dusk(page, 'setTheme', 'paper');
    await settle(page);
    expect(JSON.stringify(await dusk(page, 'state'))).toBe(before);
    expect(opened.errors).toEqual([]);
  });

  test('a muted sound set: every cue audible, quiet, and over within its time', async ({ page }) => {
    const opened = await openDusk(page);
    const gain = 0.8;
    const cues = await dusk<CueReport[]>(page, 'renderCues', gain);
    expect(cues.map((c) => c.cue)).toEqual(['slide', 'tap', 'shuffle', 'turnChime', 'promptTick']);
    for (const c of cues) {
      expect(c.peak, c.cue).toBeGreaterThan(0.005);
      expect(c.peak, c.cue).toBeLessThanOrEqual(CUE_PEAK * gain);
      expect(c.lastSoundS, c.cue).toBeLessThanOrEqual(CUE_MAX_S);
    }
    const amb = await dusk<{ peak: number; rmsBefore: number; peakAfterStop: number }>(page, 'renderAmbience', gain, 4, 2.5);
    expect(amb.rmsBefore).toBeGreaterThan(0.0005);
    expect(amb.peak).toBeLessThanOrEqual(AMBIENCE_PEAK * gain);
    expect(amb.peakAfterStop).toBeLessThan(1e-4);
    expect(opened.errors).toEqual([]);
  });
});
