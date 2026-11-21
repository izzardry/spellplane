/**
 * Gate M7-G, the table part of Gate M8-G (docs/PLAN.md, Milestone 8, "Gate M8-G": "Plus M7's own checks";
 * docs/design/m8/m7-adjustments.md section 7). It opens the table sandbox at `#/solo` (and, for the entry check, a
 * practice table from Home). Chromium and WebKit; the iPad is emulated in WebKit only (PLAN M5, owner decisions).
 *
 * - A goldfish game without keys, by mouse, in Plain and Graphite: draw, play a land, cast, tap and untap, attach (a card
 *   dropped on another's upper third; the fixture deck holds no Aura), a counter, life, attack, next turn; zero keydowns.
 * - A five-step smoke by mouse in Kitchen Table and Codex: draw, play a land, tap, life, next turn.
 * - The look is chosen the way a player does: Menu → Look… → the look's option.
 * - One continuous tilt driven by a right-drag on the empty table from first person to bird's-eye, the tilt rising
 *   monotonically; screenshots per look at first person, mid-tilt and bird's-eye.
 * - Card feel: a card mid-lift and mid-snap (the magnet pulls it with the landing preview); a draw animation on the page
 *   clock; every animation ends, and then the frames stop (render on demand: framesDrawn constant for 500 ms).
 * - Entering a table: the log closed, no dialog, no set-up control; the HUD with the menu and a plate menu open.
 * - The iPad: a touch smoke (a tap on the library draws, a card dragged out of the fan plays, a double-tap taps).
 *
 * The table is set up through the debug hook (a deck imported, an opening hand drawn: setup, not play); everything
 * played goes through the mouse or fingers, and what happened is read back through the debug hook, never from pixels.
 * Screenshots go to artifacts/shots/M7/ (`pnpm shots -- M7`); they are evidence, not baselines.
 */
import { expect, test, type Page } from '@playwright/test';
import type { CardAnimationKind, MotionDebugState } from '../../src/scene/types';
import type { LookId } from '../../src/themes/types';
import { hook, shot } from './helpers/app';
import { settleAnimations } from './helpers/design-audit';
import { menuItem, plateDetails } from './helpers/hud';
import { freshProfile as journeyProfile, openSite, soloOpponent } from './helpers/journey';
import {
  affordances,
  cardIn,
  centreOf,
  handIds,
  handPoint,
  keydowns,
  mouseDrag,
  pileCentre,
  pointerdowns,
  settledTable,
  shownCard,
  state,
  tableToScreen,
  typeLine,
  type Pt,
} from './nokeys/helpers';
import { IPAD_PORTRAIT } from './hud/helpers';
import { doubleTap, fingers, path } from './touch/helpers';
import { call, decklist, freshProfile, openSolo } from './solo/helpers';

const MS = 'M7';
const LOOK_NAMES: Record<LookId, string> = { plain: 'Plain', kitchen: 'Kitchen Table', graphite: 'Graphite', codex: 'Codex' };

const framesDrawn = (p: Page) => hook<number>(p, 'render.framesDrawn');
const motion = (p: Page) => hook<MotionDebugState>(p, 'motion');
const tilt = (p: Page) => hook<number>(p, 'rig.tilt');

/**
 * The goldfish table: the fixture deck imported and shuffled, an opening hand of seven, drawn on until it holds a land
 * and a creature (setup through the debug hook, not play); the input counters reset afterwards. Returns a land, a
 * creature and one more card of the hand.
 */
async function goldfish(page: Page, info: Parameters<typeof freshProfile>[0]): Promise<{ land: string; creature: string; spare: string }> {
  await openSolo(page, freshProfile(info));
  await call(page, 'importDecklist', decklist('gw-m19-60.txt'));
  await call(page, 'shuffle');
  await call(page, 'draw', 7);
  let land: string | undefined;
  let creature: string | undefined;
  for (let i = 0; i < 30 && !(land && creature); i++) {
    for (const id of await handIds(page)) {
      const t = await typeLine(page, id);
      if (!land && /\bLand\b/.test(t)) land = id;
      if (!creature && /\bCreature\b/.test(t)) creature = id;
    }
    if (!(land && creature)) await call(page, 'draw', 1);
  }
  if (!land || !creature) throw new Error('no land or creature in the hand');
  const spare = (await handIds(page)).find((id) => id !== land && id !== creature)!;
  await settledTable(page);
  await hook(page, 'input.reset');
  return { land, creature, spare };
}

/** A screenshot of a settled screen (CSS transitions ended); mid-motion evidence uses `shot` directly. */
async function snap(page: Page, name: string, project: string): Promise<void> {
  await settleAnimations(page, 4_000);
  await shot(page, MS, name, project);
}

/** Choose a look as a player does: Menu → Look… → the look's option; the HUD then wears it. */
async function chooseLook(page: Page, look: LookId): Promise<void> {
  await menuItem(page, 'open-theme-settings', 'click');
  const picker = page.getByTestId('theme-settings');
  await expect(picker).toBeVisible();
  await picker.locator(`[data-testid="theme-option"][data-look="${look}"]`).click();
  await expect(page.getByTestId('hud')).toHaveAttribute('data-look', look, { timeout: 20_000 });
  await expect(page.getByTestId('theme-loading')).toHaveCount(0, { timeout: 20_000 });
  if (await page.getByTestId('theme-close').isVisible().catch(() => false)) await page.getByTestId('theme-close').click();
  await expect(picker).toHaveCount(0);
}

/** Nothing animates and nothing holds frames; then no frame is drawn for 500 ms (render on demand). */
async function framesStop(page: Page): Promise<void> {
  await expect.poll(async () => {
    const m = await motion(page);
    return m.running.length === 0 && m.holds.length === 0;
  }, { timeout: 15_000 }).toBe(true);
  // A face landing in real time may still ask for a frame: polled until one whole 500 ms window draws nothing.
  await expect
    .poll(async () => {
      const a = await framesDrawn(page);
      await page.waitForTimeout(500);
      return (await framesDrawn(page)) - a;
    }, { timeout: 20_000 })
    .toBe(0);
}

/** The one primary button pressed until the turn number grows (End turn in the sandbox comes back to the player). */
async function nextTurn(page: Page): Promise<number> {
  const before = (await state(page)).turn.number;
  const primary = page.getByTestId('primary-action');
  await expect
    .poll(async () => {
      const n = (await state(page)).turn.number;
      if (n === before && (await primary.getAttribute('aria-disabled')) !== 'true') await primary.click();
      return n;
    }, { timeout: 15_000 })
    .toBe(before + 1);
  return before + 1;
}

/** One life point off the own plate by its − button. */
async function lifeDown(page: Page): Promise<void> {
  const before = (await state(page)).seats.s0!.life;
  await page.locator('[data-testid="avatar"][data-seat="s0"]').getByTestId('life-minus').click();
  await expect.poll(async () => (await state(page)).seats.s0!.life).toBe(before - 1);
}

/** Draw by the library pile's own action. */
async function drawByPile(page: Page): Promise<void> {
  const n = (await handIds(page)).length;
  await settledTable(page);
  const lib = await pileCentre(page, 'library');
  await page.mouse.click(lib.x, lib.y);
  await expect(page.getByTestId('pile-actions')).toHaveAttribute('data-zone', 'library:s0');
  expect((await affordances(page)).pile).toMatchObject({ zone: 'library:s0', owner: 's0' });
  await page.getByTestId('pile-action-draw').click();
  await expect.poll(async () => (await handIds(page)).length).toBe(n + 1);
}

/** Play a hand card onto the table at a table point by dragging it out of the fan. */
async function playTo(page: Page, id: string, at: Pt): Promise<void> {
  await settledTable(page);
  await mouseDrag(page, await handPoint(page, id), await tableToScreen(page, at));
  await expect.poll(async () => (await cardIn(page, id))?.zone).toBe('battlefield:s0');
}

/** Double-click a battlefield card and wait for its tapped flag to be `want`. */
async function dblTap(page: Page, id: string, want: boolean): Promise<void> {
  await settledTable(page);
  const c = centreOf((await shownCard(page, id)).screen);
  await page.mouse.dblclick(c.x, c.y);
  await expect.poll(async () => (await cardIn(page, id))?.tapped).toBe(want);
}

// --------------------------------------------------------------------------------------------------------------------
test.describe('@gate M7-G', () => {
  for (const look of ['plain', 'graphite'] as const) {
    test(`a goldfish game by mouse only in ${LOOK_NAMES[look]}: draw, land, cast, tap and untap, attach, a counter, life, attack, next turn; no key`, async ({ page }, info) => {
      test.setTimeout(150_000);
      const project = info.project.name;
      const { land, creature, spare } = await goldfish(page, info);
      await test.step(`the look: Menu → Look… → ${LOOK_NAMES[look]}`, async () => {
        await chooseLook(page, look);
        await settledTable(page);
        await snap(page, `goldfish-${look}-start`, project);
      }, { timeout: 40_000 });
      await test.step('draw: a click on the library, then its Draw', async () => drawByPile(page), { timeout: 20_000 });
      await test.step('play a land: drag it out of the hand onto the table', async () => {
        await playTo(page, land, { x: -400, y: -380 });
        expect((await cardIn(page, land))!.face).toBe('up');
      }, { timeout: 20_000 });
      await test.step('cast: drag a creature onto the stack; Resolve puts it onto the battlefield', async () => {
        await settledTable(page);
        await mouseDrag(page, await handPoint(page, creature), await tableToScreen(page, { x: 0, y: 0 }));
        await expect.poll(async () => (await state(page)).stack.map((i) => i.card)).toEqual([creature]);
        await page.getByTestId('resolve').click();
        await expect.poll(async () => (await cardIn(page, creature))?.zone).toBe('battlefield:s0');
      }, { timeout: 20_000 });
      await test.step('tap and untap: double-click the land twice', async () => {
        await dblTap(page, land, true);
        await dblTap(page, land, false);
      }, { timeout: 20_000 });
      await test.step('attach: a card dropped on the creature’s upper third tucks behind it and attaches', async () => {
        await playTo(page, spare, { x: 380, y: -380 });
        await settledTable(page);
        const host = (await cardIn(page, creature))!.pose;
        const from = centreOf((await shownCard(page, spare)).screen);
        // Its centre 76 mm above the host's: its bottom edge 12 mm into the host's upper third (scene/snap.ts rule 3a).
        const to = await tableToScreen(page, { x: host.x + 4, y: host.y + 76 });
        await page.mouse.move(from.x, from.y);
        await page.mouse.down();
        await page.mouse.move(to.x, to.y, { steps: 16 });
        await expect.poll(async () => (await hook<{ preview: { kind: string; target: string } | null }>(page, 'clips')).preview).toMatchObject({ kind: 'tuck', target: creature });
        await page.mouse.up();
        await expect.poll(async () => (await cardIn(page, spare))?.attachedTo).toBe(creature);
      }, { timeout: 25_000 });
      await test.step('a counter: select the creature; the strip’s +', async () => {
        await settledTable(page);
        const k = centreOf((await shownCard(page, creature)).screen);
        await page.mouse.click(k.x, k.y);
        const strip = page.getByTestId('selection-strip');
        await expect(strip).toHaveAttribute('data-cards', creature);
        await strip.getByTestId('strip-counter-add').click();
        await expect.poll(async () => (await cardIn(page, creature))?.counters['+1/+1']).toBe(1);
        await expect(strip.getByTestId('strip-counter-chip')).toHaveAttribute('data-count', '1');
        await snap(page, `goldfish-${look}-strip`, project);
      }, { timeout: 20_000 });
      await test.step('life: the own plate’s −', async () => lifeDown(page), { timeout: 15_000 });
      await test.step('attack: push the creature toward the opponent; it slides forward and taps', async () => {
        const empty = await tableToScreen(page, { x: 450, y: -250 });
        await page.mouse.click(empty.x, empty.y);
        await expect(page.getByTestId('selection-strip')).toHaveCount(0);
        await settledTable(page);
        const before = (await cardIn(page, creature))!;
        const from = centreOf((await shownCard(page, creature)).screen);
        const to = await tableToScreen(page, { x: before.pose.x, y: 160 });
        await page.mouse.move(from.x, from.y);
        await page.mouse.down();
        await page.mouse.move(to.x, to.y, { steps: 16 });
        await expect(page.getByTestId('drop-hint')).toHaveAttribute('data-kind', 'attack');
        await page.mouse.up();
        await expect.poll(async () => (await cardIn(page, creature))?.combat).toBe('attack');
        expect((await cardIn(page, creature))!.tapped).toBe(true);
        // The attachment goes along.
        expect((await cardIn(page, spare))!.attachedTo).toBe(creature);
        await snap(page, `goldfish-${look}-attack`, project);
      }, { timeout: 25_000 });
      await test.step('next turn: the one primary button; then Untap & draw', async () => {
        await nextTurn(page);
        const hand = (await handIds(page)).length;
        const primary = page.getByTestId('primary-action');
        await expect(primary).toHaveAttribute('data-kind', 'untapDraw');
        await primary.click();
        await expect.poll(async () => (await handIds(page)).length).toBe(hand + 1);
        await expect.poll(async () => (await cardIn(page, land))?.tapped).toBe(false);
      }, { timeout: 25_000 });
      await test.step('no key was pressed; the frames stop', async () => {
        expect(await keydowns(page)).toBe(0);
        const p = await pointerdowns(page);
        expect(p.mouse).toBeGreaterThan(10);
        await framesStop(page);
        await snap(page, `goldfish-${look}-end`, project);
      }, { timeout: 30_000 });
    });
  }

  for (const look of ['kitchen', 'codex'] as const) {
    test(`a five-step smoke by mouse in ${LOOK_NAMES[look]}: draw, play a land, tap, life, next turn`, async ({ page }, info) => {
      test.setTimeout(120_000);
      const { land } = await goldfish(page, info);
      await test.step(`the look: Menu → Look… → ${LOOK_NAMES[look]}`, async () => chooseLook(page, look), { timeout: 40_000 });
      await test.step('draw', async () => drawByPile(page), { timeout: 20_000 });
      await test.step('play a land', async () => playTo(page, land, { x: -400, y: -380 }), { timeout: 20_000 });
      await test.step('tap', async () => dblTap(page, land, true), { timeout: 20_000 });
      await test.step('life', async () => lifeDown(page), { timeout: 15_000 });
      await test.step('next turn', async () => {
        await nextTurn(page);
        expect(await keydowns(page)).toBe(0);
        await snap(page, `smoke-${look}`, info.project.name);
      }, { timeout: 20_000 });
    });
  }

  for (const look of ['plain', 'kitchen', 'graphite', 'codex'] as const) {
    test(`one continuous tilt by right-drag from first person to bird's-eye in ${LOOK_NAMES[look]} (screenshots)`, async ({ page }, info) => {
      test.setTimeout(90_000);
      const project = info.project.name;
      await openSolo(page, freshProfile(info));
      await call(page, 'importDecklist', decklist('gw-m19-60.txt'));
      await call(page, 'draw', 7);
      // A few cards on the table (setup through the debug hook, as a remote player's actions would arrive).
      const hand = await handIds(page);
      for (const [i, id] of hand.slice(0, 3).entries()) await hook(page, 'dispatch', { type: 'move', card: id, to: 'battlefield:s0', pose: { x: -300 + i * 160, y: -330, rot: 0 } });
      await chooseLook(page, look);
      await settledTable(page);
      const vp = page.viewportSize()!;
      const x = Math.round(vp.width / 2);
      await test.step('a right-drag up on the empty table: first person', async () => {
        await page.mouse.move(x, 470);
        await page.mouse.down({ button: 'right' });
        for (let i = 1; i <= 12; i++) await page.mouse.move(x, 470 - i * 34);
        await page.mouse.up({ button: 'right' });
        await settledTable(page);
        expect(await tilt(page)).toBeLessThan(0.02);
        await snap(page, `tilt-${look}-0-first-person`, project);
      }, { timeout: 30_000 });
      await test.step('one continuous right-drag down: the tilt rises to bird’s-eye; mid-tilt on the way', async () => {
        const tilts: number[] = [await tilt(page)];
        let mid = false;
        await page.mouse.move(x, 380);
        await page.mouse.down({ button: 'right' });
        for (let i = 1; i <= 24; i++) {
          await page.mouse.move(x, 380 + i * 17);
          await page.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))));
          const t = await tilt(page);
          tilts.push(t);
          if (!mid && t >= 0.45) {
            mid = true;
            await shot(page, MS, `tilt-${look}-1-mid`, project);
          }
        }
        await page.mouse.up({ button: 'right' });
        await settledTable(page);
        tilts.push(await tilt(page));
        for (let i = 1; i < tilts.length; i++) expect(tilts[i]!, `tilt at step ${i}`).toBeGreaterThanOrEqual(tilts[i - 1]! - 1e-6);
        expect(mid).toBe(true);
        expect(tilts.at(-1)!).toBeGreaterThan(0.98);
        expect(new Set(tilts.map((t) => t.toFixed(3))).size, 'a continuous tilt, not a jump between presets').toBeGreaterThan(8);
        await snap(page, `tilt-${look}-2-birdseye`, project);
        // No context menu opened, no key pressed.
        expect(await keydowns(page)).toBe(0);
      }, { timeout: 40_000 });
    });
  }

  test('card feel: a card mid-lift and mid-snap; released it squares onto the other; the frames stop', async ({ page }, info) => {
    test.setTimeout(90_000);
    const project = info.project.name;
    await openSolo(page, freshProfile(info));
    await call(page, 'importDecklist', decklist('gw-m19-60.txt'));
    await call(page, 'draw', 3);
    const [x, y] = await handIds(page);
    await hook(page, 'dispatch', { type: 'move', card: x, to: 'battlefield:s0', pose: { x: -150, y: -300, rot: 0 } });
    await hook(page, 'dispatch', { type: 'move', card: y, to: 'battlefield:s0', pose: { x: 150, y: -300, rot: 0 } });
    await settledTable(page);
    await test.step('mid-lift: picked up and held, the card is lifted', async () => {
      const a = centreOf((await shownCard(page, x!)).screen);
      await page.mouse.move(a.x, a.y);
      await page.mouse.down();
      for (let i = 1; i <= 6; i++) await page.mouse.move(a.x + i * 12, a.y - i * 4);
      await expect.poll(async () => (await motion(page)).held?.card).toBe(x);
      await expect.poll(async () => (await motion(page)).held?.liftMm ?? 0).toBeGreaterThan(6);
      await shot(page, MS, 'feel-mid-lift', project);
      await page.mouse.up();
      await settledTable(page);
      expect((await motion(page)).held).toBeNull();
    }, { timeout: 25_000 });
    await test.step('mid-snap: held 8 mm right of the other card, it is pulled in with the landing preview; released it squares', async () => {
      const target = (await cardIn(page, y!))!.pose;
      const from = centreOf((await shownCard(page, x!)).screen);
      const to = await tableToScreen(page, { x: target.x + 8, y: target.y });
      await page.mouse.move(from.x, from.y);
      await page.mouse.down();
      await page.mouse.move(to.x, to.y, { steps: 14 });
      await expect.poll(async () => (await motion(page)).magnet).toMatchObject({ kind: 'squared', target: y });
      const preview = (await hook<{ preview: { kind: string; target: string; pose: unknown } | null }>(page, 'clips')).preview;
      expect(preview).toMatchObject({ kind: 'squared', target: y, pose: target });
      await shot(page, MS, 'feel-mid-snap', project);
      await page.mouse.up();
      await expect.poll(async () => (await cardIn(page, x!))?.pose).toEqual(target);
      expect((await cardIn(page, x!))!.pile?.kind).toBe('squared');
      expect((await motion(page)).magnet).toBeNull();
    }, { timeout: 25_000 });
    await test.step('every animation ends; idle frames stop (framesDrawn constant for 500 ms)', async () => {
      await framesStop(page);
      expect(await keydowns(page)).toBe(0);
    }, { timeout: 30_000 });
  });

  test('a draw animation on the page clock: the card flies from the library, the flight ends, then the frames stop', async ({ page }, info) => {
    test.setTimeout(90_000);
    const running = (m: MotionDebugState, kind: CardAnimationKind) => m.running.filter((r) => r.kind === kind);
    const step = async (ms: number) => {
      for (let t = 0; t < ms; t += 16) await page.clock.runFor(16);
    };
    await page.clock.install();
    await openSolo(page, freshProfile(info));
    await call(page, 'importDecklist', decklist('gw-m19-60.txt'));
    await expect.poll(async () => (await state(page)).zones['library:s0']?.ids.length ?? 0).toBe(60);
    await page.clock.pauseAt((await page.evaluate(() => Date.now())) + 1000);
    await step(200);
    await test.step('Draw from the library pile: a draw flight mid-way (screenshot)', async () => {
      // The pile's own action, by mouse; the paused clock lets the flight be caught mid-way.
      const lib = await pileCentre(page, 'library');
      await page.mouse.click(lib.x, lib.y);
      // A single click waits out the double-click window on the page clock before the pile shows its actions.
      await expect
        .poll(async () => {
          await page.clock.runFor(50);
          return page.getByTestId('pile-actions').getAttribute('data-zone').catch(() => null);
        }, { timeout: 10_000 })
        .toBe('library:s0');
      await page.getByTestId('pile-action-draw').click();
      let seen = false;
      for (let t = 0; t <= 1500 && !seen; t += 16) {
        const r = running(await motion(page), 'draw');
        if (r.length > 0 && r[0]!.progress > 0.2) seen = true;
        else await page.clock.runFor(16);
      }
      expect(seen).toBe(true);
      await shot(page, MS, 'feel-mid-draw', info.project.name);
    }, { timeout: 30_000 });
    await test.step('the flight ends; nothing holds frames; 500 ms of clock draw no frame', async () => {
      await step(800);
      expect(running(await motion(page), 'draw')).toEqual([]);
      expect((await handIds(page)).length).toBe(1);
      await expect
        .poll(async () => {
          await step(32);
          const m = await motion(page);
          return m.running.length + m.holds.length + (await hook<number>(page, 'faceLoad.pending'));
        }, { timeout: 15_000 })
        .toBe(0);
      await step(64);
      const a = await framesDrawn(page);
      await step(500);
      expect((await framesDrawn(page)) - a, 'frames drawn in 500 ms with nothing moving').toBe(0);
    }, { timeout: 30_000 });
  });

  test('entering a table: the log closed, no dialog, no set-up control; the HUD with the menu and a plate menu open', async ({ page }, info) => {
    test.setTimeout(90_000);
    const project = info.project.name;
    await test.step('a practice table from Home (SOLO · ALONE → PLAY): the deck dealt, nothing to set up', async () => {
      await openSite(page, journeyProfile(info, 'm7-entry'));
      await page.evaluate(() => (location.hash = '#/decks/new/import'));
      await page.getByTestId('deck-text').fill(decklist('gw-m19-60.txt'));
      await page.getByTestId('deck-check').click();
      await page.getByTestId('deck-import-go').click();
      await expect(page.getByTestId('deck-page')).toBeVisible();
      const id = decodeURIComponent((await page.evaluate(() => location.hash)).replace('#/decks/', ''));
      await page.evaluate((d) => window.__spellplane!.decks!.select!(d), id);
      await page.evaluate(() => (location.hash = '#/'));
      await soloOpponent(page, 'ALONE');
      await page.getByTestId('home-primary').click();
      await expect(page.getByTestId('table-frame')).toHaveAttribute('data-kind', 'practice', { timeout: 30_000 });
      await expect(page.getByTestId('primary-action')).toBeVisible({ timeout: 20_000 });
      await expect.poll(async () => (await state(page)).zones['hand:s0']?.ids.length ?? 0, { timeout: 20_000 }).toBe(7);
      await expect(page.locator('[data-testid="log"][data-open="true"]')).toHaveCount(0);
      await expect(page.locator('[role="dialog"]:visible')).toHaveCount(0);
      for (const id of ['no-deck', 'lobby', 'choose-deck', 'empty-import-deck']) await expect(page.getByTestId(id), id).toHaveCount(0);
      expect(await keydowns(page)).toBe(0);
      await snap(page, 'entry-practice-table', project);
      // No hint or coach mark covers the opponent's side (m7-adjustments.md section 7, "Entering a table"): every one
      // shown sits in the lower half of the screen, by the own hand.
      const vh = page.viewportSize()!.height;
      const over = await page.locator('[data-testid="hint"], [data-testid="coach-mark"], [data-testid^="coach-"]:not([data-testid="coach-dismiss"])').evaluateAll(
        (els, h) =>
          els
            .filter((e) => {
              const st = getComputedStyle(e);
              return e.getClientRects().length > 0 && st.visibility !== 'hidden' && st.display !== 'none' && Number(st.opacity) > 0;
            })
            .map((e) => ({ id: e.getAttribute('data-hint') ?? e.getAttribute('data-coach') ?? e.getAttribute('data-testid'), r: e.getBoundingClientRect(), text: (e.textContent ?? '').trim().slice(0, 60) }))
            .filter((x) => x.r.height > 0 && x.r.top + x.r.height / 2 < h / 2)
            .map((x) => `${x.id}: “${x.text}” at y ${Math.round(x.r.top)}–${Math.round(x.r.bottom)}`),
        vh,
      );
      // Soft: the test goes on to its other checks and screenshots, and still fails at the end.
      expect.soft(over, 'hints or coach marks over the opponent’s side on entering a table').toEqual([]);
    }, { timeout: 60_000 });
    await test.step('the sandbox (#/solo): the log closed, no dialog', async () => {
      await openSolo(page, freshProfile(info));
      await expect(page.getByTestId('hud')).toBeVisible();
      await expect(page.locator('[data-testid="log"][data-open="true"]')).toHaveCount(0);
      await expect(page.locator('[role="dialog"]:visible')).toHaveCount(0);
      await expect(page.getByTestId('lobby')).toHaveCount(0);
      await call(page, 'importDecklist', decklist('gw-m19-60.txt'));
      await call(page, 'draw', 7);
      await settledTable(page);
      await snap(page, 'entry-sandbox', project);
    }, { timeout: 30_000 });
    await test.step('the HUD with the menu open, then a plate menu open', async () => {
      await page.getByTestId('open-menu').click();
      await expect(page.getByTestId('menu-popover')).toBeVisible();
      await snap(page, 'hud-menu-open', project);
      await page.getByTestId('open-menu').click();
      await expect(page.getByTestId('menu-popover')).toHaveCount(0);
      await plateDetails(page, 's0');
      await snap(page, 'hud-plate-menu-open', project);
    }, { timeout: 20_000 });
  });

  test.describe('iPad', () => {
    test.skip(({ browserName }) => browserName !== 'webkit', 'the iPad is emulated in WebKit (PLAN M5, owner decisions)');
    test.use({ ...IPAD_PORTRAIT });
    test('a touch smoke in portrait: a tap on the library draws, a card dragged out of the fan plays, a double-tap taps; no key', async ({ page }, info) => {
      test.setTimeout(120_000);
      const { land } = await goldfish(page, info);
      await test.step('a tap on the library shows its actions; Draw draws', async () => {
        const n = (await handIds(page)).length;
        const lib = await pileCentre(page, 'library');
        await page.touchscreen.tap(lib.x, lib.y);
        await expect(page.getByTestId('pile-actions')).toHaveAttribute('data-zone', 'library:s0');
        await page.getByTestId('pile-action-draw').tap();
        await expect.poll(async () => (await handIds(page)).length).toBe(n + 1);
      }, { timeout: 20_000 });
      await test.step('a land dragged out of the fan by a finger is played', async () => {
        await settledTable(page);
        const from = await handPoint(page, land);
        const vp = page.viewportSize()!;
        const up = { x: from.x, y: Math.round(from.y - vp.height * 0.2) };
        const to = await tableToScreen(page, { x: -300, y: -380 });
        await fingers(page, [{ type: 'down', id: 1, ...from }, ...path(1, from, up, 8), ...path(1, up, to, 12), { type: 'up', id: 1, ...to }]);
        await expect.poll(async () => (await cardIn(page, land))?.zone).toBe('battlefield:s0');
      }, { timeout: 20_000 });
      await test.step('a double-tap taps it', async () => {
        await settledTable(page);
        await doubleTap(page, centreOf((await shownCard(page, land)).screen));
        await expect.poll(async () => (await cardIn(page, land))?.tapped).toBe(true);
        expect(await keydowns(page)).toBe(0);
        const p = await pointerdowns(page);
        expect(p.touch).toBeGreaterThan(2);
        expect(p.mouse).toBe(0);
        await snap(page, 'ipad-portrait', info.project.name);
      }, { timeout: 20_000 });
    });
  });
});
