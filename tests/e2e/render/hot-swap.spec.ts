/**
 * PLAN M4-P2 acceptance: "switching themes mid-game preserves the state hash and leaks no GPU textures after ten
 * switches". DESIGN "Themes and rendering": themes are switchable mid-game without reloading; the scene is a pure view
 * of the state (a theme switch dispatches nothing). Leaks are measured on renderer.info.memory through the debug hook.
 *
 * The baseline is taken after one warm-up visit to the lit theme: three.js creates one texture per renderer the first
 * time a physically based material draws (its DFG lookup table, shared and kept for the renderer's life) and the SDF
 * text builds its glyph atlas a moment after the first frame. Both are one-time caches; a leak grows with switches.
 */
import { expect, test, type Page } from '@playwright/test';
import type { Action } from '../../../src/core/actions';
import { loadTheme } from '../../../src/themes/index';
import { litTestTheme } from '../../../src/themes/test-lit';
import { openRender, ready, rh, setTheme, settle, stableTextures, type HarnessThemeId } from './helpers';

type Stats = { textures: number; geometries: number; passes: string[]; theme: string; drawCalls: number };
type Card = { id: string; pose: { x: number; y: number; rot: number }; tapped: boolean; face: string; zone: string };

const SWITCHES: HarnessThemeId[] = ['lit', 'dusk', 'lit', 'wyrm', 'stonetable', 'lit', 'paper', 'lit', 'dusk', 'paper'];

const dispatch = (page: Page, a: Action) => page.evaluate((x) => window.__spellplane!.dispatch!(x), a);

test('ten theme switches mid-game keep the state hash, the cards and the GPU texture count', async ({ page }) => {
  const errors = await openRender(page, { theme: 'paper', scenario: 'demo' });
  // Mid-game: a tapped creature, a moved card, a counter, a card on the stack.
  await dispatch(page, { type: 'tap', by: 's0', cid: 'g1', card: 's0-b02', tapped: true });
  await dispatch(page, { type: 'move', by: 's0', cid: 'g2', card: 's0-b03', to: 'battlefield:s0', pose: { x: 120, y: -180, rot: 0 } });
  await dispatch(page, { type: 'counter', by: 's0', cid: 'g3', card: 's0-b04', kind: '+1/+1', delta: 1 });
  await settle(page);
  const hash0 = await rh<string>(page, 'hash');
  await setTheme(page, 'lit');
  await setTheme(page, 'paper');
  await settle(page);

  const actions0 = (await rh<unknown[]>(page, 'actions')).length;
  const cards0 = await rh<Card[]>(page, 'cards');
  const textures0 = await stableTextures(page);
  const stats0 = await rh<Stats>(page, 'stats');
  expect(stats0.passes).toEqual([]);

  for (const [i, id] of SWITCHES.entries()) {
    await setTheme(page, id);
    const s = await rh<Stats>(page, 'stats');
    expect(s.theme, `switch ${i + 1}`).toBe(id === 'lit' ? 'stonetable' : id);
    // A theme with bloom runs the post chain (the lit test theme, and each real theme once it replaced its stub).
    const theme = id === 'lit' ? litTestTheme() : await loadTheme(id);
    if (theme.post.bloom) expect(s.passes).toContain('bloom');
    else expect(s.passes).toEqual([]);
    expect(await rh<string>(page, 'hash'), `hash after switch ${i + 1} (${id})`).toBe(hash0);
  }
  await settle(page);

  // The state and the scene's view of it are untouched; the scene dispatched nothing.
  expect(await rh<string>(page, 'hash')).toBe(hash0);
  expect((await rh<unknown[]>(page, 'actions')).length).toBe(actions0);
  const cards1 = await rh<Card[]>(page, 'cards');
  const view = (cs: Card[]) => cs.map((c) => ({ id: c.id, zone: c.zone, tapped: c.tapped, face: c.face, x: Math.round(c.pose.x * 100), y: Math.round(c.pose.y * 100), rot: Math.round(c.pose.rot) })).sort((a, b) => a.id.localeCompare(b.id));
  expect(view(cards1)).toEqual(view(cards0));

  // No GPU texture or geometry left behind (renderer.info.memory), and the material library is empty again in Paper.
  expect(await stableTextures(page)).toBe(textures0);
  const stats1 = await rh<Stats>(page, 'stats');
  expect(stats1.geometries).toBe(stats0.geometries);
  const pipeline = await rh<{ materials: number; materialTextures: number; boxes: boolean; post: string[] }>(page, 'pipeline');
  expect(pipeline).toMatchObject({ materials: 0, materialTextures: 0, boxes: false, post: [] });
  expect(errors).toEqual([]);
});

test('a theme switch while a card is held keeps the drag: one move on release, to where it was dropped', async ({ page }) => {
  await openRender(page, { theme: 'paper', scenario: 'demo' });
  await settle(page);
  const hash0 = await rh<string>(page, 'hash');
  const card = (await rh<Card[]>(page, 'cards')).find((c) => c.id === 's0-b05')!;
  const from = (await rh<{ x: number; y: number }>(page, 'toScreen', card.pose.x, card.pose.y))!;
  const to = (await rh<{ x: number; y: number }>(page, 'toScreen', card.pose.x + 150, card.pose.y - 60))!;
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 5 });
  await setTheme(page, 'lit');
  expect(await rh<string>(page, 'hash')).toBe(hash0);
  await page.mouse.move(to.x, to.y, { steps: 5 });
  await setTheme(page, 'paper');
  await page.mouse.up();
  await settle(page);
  const moves = (await rh<{ type: string; card?: string; pose?: { x: number; y: number } }[]>(page, 'actions')).filter((a) => a.card === 's0-b05');
  expect(moves).toHaveLength(1);
  expect(moves[0]!.type).toBe('move');
  expect(Math.abs(moves[0]!.pose!.x - (card.pose.x + 150))).toBeLessThan(13);
  expect(Math.abs(moves[0]!.pose!.y - (card.pose.y - 60))).toBeLessThan(13);
});

test('switching to a theme with another card back reloads the faces and frees the old ones', async ({ page }) => {
  // The lit test theme dresses cards in its own neutral back; switching rebuilds the face textures.
  await openRender(page, { theme: 'paper', scenario: 'demo' });
  await setTheme(page, 'lit');
  await setTheme(page, 'paper');
  await settle(page);
  const textures0 = await stableTextures(page);
  for (let i = 0; i < 3; i++) {
    await setTheme(page, 'lit');
    expect((await rh<{ id: string; shows: string }[]>(page, 'cards')).length).toBeGreaterThan(0);
    await setTheme(page, 'paper');
  }
  await ready(page);
  await settle(page);
  expect(await stableTextures(page)).toBe(textures0);
  const shows = (await rh<{ id: string; shows: string; tier: string | null }[]>(page, 'cards')).filter((c) => c.shows === 'face');
  expect(shows.length).toBeGreaterThan(0);
  expect(shows.every((c) => c.tier !== null)).toBe(true);
});
