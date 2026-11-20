/**
 * The three M7 looks as 3D table worlds in the browser (PLAN Milestone 7, Owner decisions after the first design round:
 * "Every look works from bird's-eye to first person … each look is built as a 3D table world (surface, frame,
 * lighting, card shadows, pile and zone marks) that reads well at every camera tilt"; PLAN M7-P1 Table worlds and its
 * acceptance: "per-look screenshots at tilt 0, 0.5, 1 in both browsers; conformance and budget specs per look").
 *
 * Measured on screenshots and through the debug hook, never against pixel baselines: the screenshots at first person
 * (tilt 0), mid-tilt (0.5) and bird's-eye (1) are written to artifacts/shots/M7/looks/ as evidence. Until M7-P3 lands
 * the camera's tilt is the contracts' stub over the two rigs (0.5 shows the bird's-eye rig); the specs hold for both.
 * Nothing here asserts on time or frame rate (CI renders WebGL in software).
 */
import { expect, test, type Page } from '@playwright/test';
import type { RenderStats } from '../../../../src/scene/types';
import type { SceneDebugCard } from '../../../../src/scene/table-scene';
import { harnessLayout } from '../../../../src/scene/harness-fixture';
import { rot2 } from '../../../../src/scene/math';
import { CODEX_WORLD } from '../../../../src/themes/codex/index';
import { GRAPHITE_WORLD } from '../../../../src/themes/graphite/index';
import { loadTheme, type Theme } from '../../../../src/themes/index';
import { KITCHEN_WORLD } from '../../../../src/themes/kitchen/index';
import { PLAIN_WORLD } from '../../../../src/themes/plain/index';
import { openRender, rh, settle } from '../../render/helpers';
import { LOOKS, type LookTheme, avg, capture, delta, evidence, fmt, hex255, lum, onScreen, patch, setTilt, toScreen, type Capture } from './helpers';

/** File types that are assets rather than code (as tests/unit/themes/conformance/assets.test.ts lists them). */
const ASSET_EXTENSIONS = /\.(png|jpe?g|webp|avif|gif|ktx2|basis|hdr|exr|dds|glb|gltf|bin|mp3|ogg|opus|wav|m4a|flac|ttf|otf|woff2?)$/i;

const WORLDS = { plain: PLAIN_WORLD, kitchen: KITCHEN_WORLD, graphite: GRAPHITE_WORLD, codex: CODEX_WORLD } as const;
const TILTS = [0, 0.5, 1] as const;
const layout = harnessLayout();
const TABLE = layout.table;

/** The frame's middle: half-way between the table edge and the frame's outer edge, mm beyond the edge. */
function frameMid(look: LookTheme): number {
  // Plain's desk reaches to the horizon: its frame is the desk just beyond the slab's shadow.
  if (look === 'plain') return 60;
  const slabs = WORLDS[look].slabs;
  return (slabs[0]!.growMm + slabs.at(-1)!.growMm) / 2;
}

const cards = (page: Page) => rh<SceneDebugCard[]>(page, 'cards');
const stats = (page: Page) => rh<RenderStats>(page, 'stats');

/** A frame point on screen and clear of the HUD-free harness's cards: the far edge, else the near edge, else a side. */
async function framePoint(page: Page, look: LookTheme): Promise<{ x: number; y: number } | null> {
  const m = frameMid(look);
  // Plain's desk lies 8 mm below the table; the avatar plaques sit on the frame at x = 0, so Plain measures beside them.
  const ox = look === 'plain' ? TABLE.w / 4 : 0;
  const z = look === 'plain' ? -8 : -1;
  for (const [x, y] of [
    [ox, TABLE.d / 2 + m],
    [ox, -TABLE.d / 2 - m],
    [-TABLE.w / 2 - m, 0],
    [TABLE.w / 2 + m, 0],
  ] as const) {
    const s = await toScreen(page, x, y, z);
    if (onScreen(page, s, 12)) return s;
  }
  return null;
}

for (const look of LOOKS) {
  test.describe(`${look}: table world`, () => {
    test.describe.configure({ timeout: 120_000 });
    let theme: Theme;
    test.beforeAll(async () => {
      theme = await loadTheme(look);
    });

    test(`reads at every tilt: first person, mid-tilt and bird's-eye show the table, its frame and the cards (screenshots)`, async ({ page }, info) => {
      test.slow(!!process.env.CI, 'software GL on CI');
      const errors = await openRender(page, { theme: look, scenario: 'demo' });
      await settle(page);
      const background = hex255(theme.lighting.background);
      for (const t of TILTS) {
        await setTilt(page, t);
        const c = await capture(page);
        evidence(info, `${look}-tilt-${t}`, c.png);
        const s = await stats(page);
        expect(s.theme).toBe(look);
        // No post-processing in any look (Safari: PLAN Milestone 7, A0), at every tilt.
        expect(s.passes).toEqual([]);
        // The cards are drawn and on screen.
        const visible = (await cards(page)).filter((x) => x.visible && onScreen(page, { x: x.screen.x + x.screen.width / 2, y: x.screen.y + x.screen.height / 2 }, 0));
        expect(visible.length, `cards on screen at tilt ${t}`).toBeGreaterThanOrEqual(10);
        // The table surface between the zones, and the frame around it, both on screen and apart from the room.
        const matAt = await toScreen(page, 0, -60);
        expect(onScreen(page, matAt), `table centre on screen at tilt ${t}`).toBe(true);
        const mat = avg(c, patch(matAt!, 5));
        const at = await framePoint(page, look);
        expect(at, `a frame edge is on screen at tilt ${t}`).not.toBeNull();
        const frame = avg(c, patch(at!, 3));
        info.annotations.push({ type: `tilt ${t}`, description: `mat ${fmt(mat)} frame ${fmt(frame)} room ${fmt(background)} tilt() ${await page.evaluate(() => window.__renderHarness!.camera.tilt())}` });
        // Apart as far as the look's tokens are: Graphite's frame and mat tokens are near (#101317 on #16191e), where the
        // plinth's depth shows in its edge and the room instead.
        const tokenGap = delta(hex255(WORLDS[look].surround), hex255(WORLDS[look].surface));
        if (tokenGap >= 10) expect(delta(frame, mat), `frame vs table at tilt ${t}`).toBeGreaterThan(Math.min(10, tokenGap / 2));
        info.annotations.push({ type: `surround ${t}`, description: `frame ${fmt(frame)} token ${WORLDS[look].surround}` });
        // Plain's room is its desk (one colour to the horizon, the frame token); the others frame the table against a darker room.
        if (look === 'plain') expect(delta(frame, hex255(WORLDS[look].surround)), `desk is the frame token at tilt ${t}`).toBeLessThan(12);
        else expect(delta(frame, background), `frame vs room at tilt ${t}`).toBeGreaterThan(4);
        expect(delta(mat, background), `table vs room at tilt ${t}`).toBeGreaterThan(10);
      }
      expect(errors).toEqual([]);
    });

    test('the table shows the colour its tokens promise, under a soft pool of light', async ({ page }, info) => {
      const errors = await openRender(page, { theme: look, scenario: 'empty' });
      // The token is the table seen from above (a lit surface's sheen changes with the view's angle).
      await setTilt(page, 1);
      const c = await capture(page);
      evidence(info, `${look}-empty`, c.png);
      const at = async (x: number, y: number) => avg(c, patch((await toScreen(page, x, y))!, 10));
      // Between the zones, from the middle of the table out toward the near-left corner (1400 × 1100 table).
      const centre = await at(0, -60);
      const mid = await at(-330, -300);
      const corner = await at(-640, -500);
      info.annotations.push({ type: 'surface', description: `centre ${fmt(centre)} mid ${fmt(mid)} corner ${fmt(corner)} token ${theme.tokens.colours.surface}` });
      // The surface token (HUD and contrast rules: seat colours reach 3:1 on it) is the table as it appears half-way out.
      const token = hex255(theme.tokens.colours.surface);
      expect(delta(mid, token), `surface token ${theme.tokens.colours.surface} vs measured ${fmt(mid)}`).toBeLessThan(14);
      // A soft pool: the middle at least as bright as the corner, without a hard edge (half-way is in between).
      expect(lum(centre)).toBeGreaterThanOrEqual(lum(corner) - 0.5);
      expect(lum(mid)).toBeGreaterThanOrEqual(Math.min(lum(centre), lum(corner)) - 1);
      expect(lum(mid)).toBeLessThanOrEqual(Math.max(lum(centre), lum(corner)) + 1);
      expect(errors).toEqual([]);
    });

    test('soft, short card shadows: the table darkens just around a card, not further out; low quality drops them', async ({ page }) => {
      const errors = await openRender(page, { theme: look, scenario: 'empty' });
      await page.evaluate(() => window.__renderHarness!.addCard('c1', 'fx-3', { x: 0, y: -200, rot: 0 }));
      await setTilt(page, 1);
      const measure = async () => {
        const r = (await cards(page)).find((x) => x.id === 'c1')!.screen;
        const c = await capture(page);
        const k = r.height / 88;
        const near = avg(c, { x: r.x - 3.5 * k, y: r.y + r.height * 0.3, width: 2.5 * k, height: r.height * 0.4 });
        const far = avg(c, { x: r.x - 28 * k, y: r.y + r.height * 0.3, width: 3 * k, height: r.height * 0.4 });
        return { near: lum(near), far: lum(far) };
      };
      const on = await measure();
      const p = await rh<{ contactShadows: boolean; boxes: boolean; faceShade: number; toneMapping: number }>(page, 'pipeline');
      expect(p).toMatchObject({ contactShadows: true, boxes: true, faceShade: theme.cardDressing.faceShade, toneMapping: 0 });
      await rh(page, 'setQuality', 'low');
      await settle(page);
      const off = await measure();
      test.info().annotations.push({ type: 'contact', description: `near ${on.near.toFixed(1)} / far ${on.far.toFixed(1)} with; near ${off.near.toFixed(1)} / far ${off.far.toFixed(1)} without` });
      expect(on.near).toBeLessThan(on.far - 2);
      expect(on.near).toBeLessThan(off.near - 2);
      expect(Math.abs(off.near - off.far)).toBeLessThan(2.5);
      expect((await rh<{ contactShadows: boolean }>(page, 'pipeline')).contactShadows).toBe(false);
      expect((await stats(page)).shadows).toBe(false);
      expect(errors).toEqual([]);
    });

    test('pile and zone marks in the look’s style: a bed under every pile slot, each named chair’s glyph in its seat colour', async ({ page }, info) => {
      const errors = await openRender(page, { theme: look, scenario: 'empty' });
      // From above: every pile slot and both chairs on screen.
      await setTilt(page, 1);
      const c: Capture = await capture(page);
      evidence(info, `${look}-marks`, c.png);
      const sl = layout.seats[0]!;
      for (const zone of ['library', 'graveyard', 'exile'] as const) {
        const p = sl.zones[zone];
        const bed = avg(c, patch((await toScreen(page, p.x, p.y))!, 6));
        // The table beside the slot (toward the territory's middle, clear of the beds' column).
        const beside = avg(c, patch((await toScreen(page, p.x - 90, p.y))!, 6));
        info.annotations.push({ type: zone, description: `bed ${fmt(bed)} beside ${fmt(beside)}` });
        expect(delta(bed, beside), `${zone} bed stands out`).toBeGreaterThan(5);
      }
      // Ada (seat colour 0) and Bo (seat colour 1) sit at the harness table: each glyph is drawn in the seat's colour.
      const glyph = WORLDS[look].marks.glyph;
      for (const [i, seat] of layout.seats.entries()) {
        const av = seat.zones.avatar;
        const [dx, dy] = rot2(-glyph.offsetMm, 0, seat.angle);
        const at = (await toScreen(page, av.x + dx, av.y + dy))!;
        expect(onScreen(page, at)).toBe(true);
        const got = avg(c, patch(at, 1));
        const want = hex255(theme.tokens.colours.seats[i]!.colour);
        info.annotations.push({ type: `glyph ${i}`, description: `${fmt(got)} want ${fmt(want)}` });
        expect(delta(got, want), `seat ${i} glyph colour`).toBeLessThan(28);
      }
      expect(errors).toEqual([]);
    });

    test('a still table draws no frames (render on demand); nothing animates by itself', async ({ page }) => {
      const errors = await openRender(page, { theme: look, scenario: 'demo' });
      await settle(page);
      // The scene redraws a still table once at the full ratio a second after its last change (scene/resolution.ts):
      // wait until no frame comes in half a second, then nothing may come for longer than that redraw delay.
      await expect
        .poll(async () => {
          const a = await page.evaluate(() => window.__renderHarness!.frames());
          await page.waitForTimeout(500);
          return (await page.evaluate(() => window.__renderHarness!.frames())) - a;
        }, { timeout: 20_000 })
        .toBe(0);
      const before = await page.evaluate(() => window.__renderHarness!.frames());
      await page.waitForTimeout(1200);
      expect(await page.evaluate(() => window.__renderHarness!.frames())).toBe(before);
      expect(errors).toEqual([]);
    });

    test('fetches no image, font or sound: every texture and cue is procedural', async ({ page }) => {
      const requests: string[] = [];
      page.on('request', (r) => requests.push(r.url()));
      const errors = await openRender(page, { theme: look, scenario: 'demo' });
      await settle(page);
      for (const t of TILTS) await setTilt(page, t);
      // The scene's own SDF text font (docs/ASSETS.md, Shared) is the one asset file the table may load.
      const assets = requests.filter((u) => !u.startsWith('data:') && !u.startsWith('blob:') && ASSET_EXTENSIONS.test(new URL(u).pathname) && !/Roboto/.test(u));
      expect(assets).toEqual([]);
      expect(requests.every((u) => u.startsWith('data:') || u.startsWith('blob:') || new URL(u).origin === new URL(page.url()).origin)).toBe(true);
      expect(errors).toEqual([]);
    });
  });
}
