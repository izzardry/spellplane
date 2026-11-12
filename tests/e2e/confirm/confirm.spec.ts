/**
 * PLAN M1-P3 in the browser: the stack lane and confirmation rounds with the real HUD and the real table scene, over
 * an in-page sequenced table (`?harness=confirm`, src/ui/confirm/harness.ts) whose sequencer runs the confirmation
 * deadlines on its own clock. The other players are scripted through `window.__confirmHarness`; the local player uses
 * real keys. Pass timer: 4 s (TIMER), so the steps a test about the timer takes before it runs out fit on a slow machine
 * too; tests whose premise is that a round still waits when a key is pressed use LONG_TIMER (decision M2-G).
 *
 * DESIGN "The effect stack" (Stack and confirmation, Resolving), "Turn flow and confirmation" (Confirmation rounds),
 * "Specification: network protocol and secrecy" (Timers).
 */
import { expect, test, type Page } from '@playwright/test';
import type { Action, ActionDraft } from '../../../src/core/actions';
import type { TableState } from '../../../src/core/types';
import type { DebugStackEntry } from '../../../src/scene/stack';

const TIMER = 4000;
/**
 * A pass timer no test outlives, for tests about what a player does while a round waits (answer, hold, resolve):
 * with a timer of seconds their premise, that the round still waits when the key is pressed, would hold only on a fast
 * machine (decision M2-G). The other tests keep TIMER; what they check of the log ignores timer passes (`acted`).
 */
const LONG_TIMER = 600_000;

async function open(page: Page, opts: { seat: 's0' | 's1'; seats?: string[]; timer?: number }): Promise<void> {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const q = new URLSearchParams({ faces: 'placeholder', harness: 'confirm', seat: opts.seat, timer: String(opts.timer ?? TIMER), seats: (opts.seats ?? ['Anna', 'Ben']).join(',') });
  await page.goto(`./?${q.toString()}`);
  await expect.poll(() => page.evaluate(() => typeof window.__confirmHarness === 'object' && typeof window.__spellplane?.stack === 'function')).toBe(true);
  await expect(page.getByTestId('hud')).toBeVisible();
  expect(errors).toEqual([]);
}

const remote = (page: Page, seat: string, draft: ActionDraft) =>
  page.evaluate(([s, d]) => window.__confirmHarness!.remote(s as string, d as ActionDraft), [seat, draft] as const) as Promise<{ action: Action; refused: string | null }>;
const state = (page: Page) => page.evaluate(() => window.__confirmHarness!.state()) as Promise<TableState>;
const log = (page: Page) => page.evaluate(() => window.__confirmHarness!.log()) as Promise<Action[]>;
/**
 * The log without the sequencer's timer passes (`respond … 'timeout'`). A round's deadline runs on the sequencer's
 * clock (DESIGN "Turn flow and confirmation", Confirmation rounds), so its pass lands whenever the timer runs out,
 * which on a slow machine can be after a gesture the test made later: assertions about what a gesture logged read
 * this, never the raw log's last entry.
 */
const acted = async (page: Page) => (await log(page)).filter((a) => !(a.type === 'respond' && a.response === 'timeout'));
const fired = (page: Page) => page.evaluate(() => window.__confirmHarness!.fired()) as Promise<{ key: string; seq: number }[]>;
const lane = (page: Page) => page.evaluate(() => JSON.parse(JSON.stringify(window.__spellplane!.stack!())) as DebugStackEntry[]);

/** Anna casts her Spark Jolt from hand (reveal, then the push with a round). */
async function annaCasts(page: Page, item = 'i1', round = 'r1'): Promise<void> {
  expect((await remote(page, 's0', { type: 'reveal', instanceId: 'abolt', ref: { sid: 'sid-bolt' }, salt: 'salt-abolt' })).refused).toBeNull();
  expect((await remote(page, 's0', { type: 'stackPush', item, kind: 'spell', card: 'abolt', round })).refused).toBeNull();
}

/** Point at the centre of a card drawn on the table. */
async function hoverTableCard(page: Page, id: string): Promise<void> {
  await expect.poll(async () => (await page.evaluate((c) => window.__spellplane!.cards!().find((x) => x.id === c)?.visible ?? false, id))).toBe(true);
  const r = await page.evaluate((c) => JSON.parse(JSON.stringify(window.__spellplane!.cards!().find((x) => x.id === c)!.screen)) as DOMRect, id);
  await page.mouse.move(r.x + r.width / 2, r.y + r.height / 2);
}

/** A lane entry's full card height on screen (a marker is drawn at `scale`). */
const fullHeight = (e: DebugStackEntry) => e.screen.height / e.scale;
/** A point inside an entry's visible title strip (the top 22 of 88 mm of its slot). */
const stripPoint = (e: DebugStackEntry) => ({ x: e.screen.x + e.screen.width / 2, y: e.screen.y + (fullHeight(e) * 9) / 88 });
/** Wait until the lane's entries rest in their slots (a cast card flies in). */
async function laneSettled(page: Page): Promise<DebugStackEntry[]> {
  const settled = async () => {
    const e = await lane(page);
    return e.every((x, i) => i === 0 || Math.abs(x.screen.y - e[i - 1]!.screen.y - (fullHeight(e[i - 1]!) * 22) / 88) < 0.5);
  };
  await expect.poll(settled).toBe(true);
  return lane(page);
}
/** Press at `from`, drag to `to`, release. */
async function dragBetween(page: Page, from: { x: number; y: number }, to: { x: number; y: number }): Promise<void> {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x, from.y + 10, { steps: 3 });
  await page.mouse.move(to.x, to.y, { steps: 8 });
  await page.mouse.up();
}

/** Move the pointer to an empty spot on the table. */
async function hoverNothing(page: Page): Promise<void> {
  await page.mouse.move(720, 160);
}

test.describe('a stack item starts a round; silence passes after the configured duration', () => {
  test('the other player sees the prompt with a draining ring; without an answer the sequencer passes them at the deadline', async ({ page }) => {
    await open(page, { seat: 's1' });
    const t0 = Date.now();
    await annaCasts(page);
    const prompt = page.getByTestId('confirm-prompt');
    await expect(prompt).toContainText('Anna');
    await expect(prompt).toContainText('cast Spark Jolt');
    await expect(prompt.getByTestId('prompt-ok')).toContainText('Enter');
    await expect(prompt.getByTestId('prompt-hold')).toBeVisible();
    const ring = prompt.getByTestId('confirm-ring');
    await expect(ring).toHaveAttribute('data-running', 'true');
    // The ring drains.
    await expect.poll(async () => Number(await ring.getAttribute('data-fraction'))).toBeLessThan(0.8);
    // The item pulses in the lane while its round waits.
    expect((await lane(page)).map((e) => [e.item, e.kind, e.face, e.pending])).toEqual([['i1', 'spell', 'abolt', true]]);
    expect((await state(page)).confirm?.responses).toEqual({});

    await expect.poll(async () => (await state(page)).confirm?.responses, { timeout: TIMER + 3000 }).toEqual({ s1: 'timeout' });
    expect(Date.now() - t0).toBeGreaterThanOrEqual(TIMER);
    // The sequencer (Anna's browser, seat 0) sent the timeout for Ben.
    const last = (await log(page)).at(-1)!;
    expect(last).toMatchObject({ type: 'respond', round: 'r1', seat: 's1', response: 'timeout', by: 's0' });
    expect(await fired(page)).toEqual([{ key: `confirm:r1:${(await log(page)).find((a) => a.type === 'stackPush')!.seq}:s1`, seq: last.seq! - 1 }]);
    await expect(prompt).toHaveCount(0);
    expect((await lane(page))[0]!.pending).toBe(false);
    // The log names Ben, who passed, not the sequencer.
    await expect(page.getByTestId('log-line').last()).toContainText('Ben');
    await expect(page.getByTestId('log-line').last()).toContainText('passes (timer)');
  });

  test('OK (Enter) answers at once', async ({ page }) => {
    await open(page, { seat: 's1', timer: LONG_TIMER });
    await annaCasts(page);
    await expect(page.getByTestId('confirm-prompt')).toBeVisible();
    await hoverNothing(page);
    await page.keyboard.press('Enter');
    await expect.poll(async () => (await state(page)).confirm?.responses).toEqual({ s1: 'ok' });
    await expect(page.getByTestId('confirm-prompt')).toHaveCount(0);
  });
});

test.describe('hold stops the timer', () => {
  test('H holds: the ring stops, nobody times out; Enter releases and the countdown restarts for the others', async ({ page }) => {
    await open(page, { seat: 's1', seats: ['Anna', 'Ben', 'Cleo'] });
    await annaCasts(page);
    const prompt = page.getByTestId('confirm-prompt');
    await expect(prompt).toBeVisible();
    await hoverNothing(page);
    await page.keyboard.press('KeyH');
    await expect(prompt.getByTestId('release')).toBeVisible();
    await expect(prompt).toContainText('You hold the floor');
    await expect(prompt.getByTestId('confirm-ring')).toHaveAttribute('data-running', 'false');
    await expect(page.locator('[data-testid="avatar"][data-seat="s1"]').getByTestId('responding')).toBeVisible();
    expect((await state(page)).confirm).toMatchObject({ holder: 's1', responses: { s1: 'hold' } });

    // Well past the timer: nobody times out while Ben holds.
    await page.waitForTimeout(TIMER + 800);
    expect((await state(page)).confirm?.responses).toEqual({ s1: 'hold' });
    expect(await fired(page)).toEqual([]);

    await page.keyboard.press('Enter');
    const releasedAt = Date.now();
    await expect.poll(async () => (await state(page)).confirm?.responses).toEqual({ s1: 'ok' });
    await expect(prompt).toHaveCount(0);
    // Ben now watches: the round waits for Cleo, with a fresh countdown.
    const status = page.getByTestId('confirm-status');
    await expect(status).toContainText('Waiting for');
    await expect(status).toContainText('Cleo');
    await expect.poll(async () => (await state(page)).confirm?.responses, { timeout: TIMER + 3000 }).toEqual({ s1: 'ok', s2: 'timeout' });
    expect(Date.now() - releasedAt).toBeGreaterThanOrEqual(TIMER - 100);
    const release = (await log(page)).find((a) => a.type === 'respond' && a.response === 'release')!;
    expect((await fired(page)).map((f) => f.key)).toEqual([`confirm:r1:${release.seq}:s2`]);
  });

  test('the holder adds to the stack, which starts a new round on the new top item', async ({ page }) => {
    await open(page, { seat: 's1', timer: LONG_TIMER });
    await annaCasts(page);
    await hoverNothing(page);
    await expect(page.getByTestId('confirm-prompt')).toBeVisible();
    await page.keyboard.press('KeyH');
    await expect(page.getByTestId('release')).toBeVisible();
    await hoverTableCard(page, 'bbear');
    await page.keyboard.press('KeyQ');
    await expect.poll(async () => (await state(page)).stack.length).toBe(2);
    const s = await state(page);
    expect(s.confirm).toMatchObject({ askedBy: 's1', about: s.stack[1]!.id, responses: {} });
    expect(s.confirm).not.toHaveProperty('holder');
    // Ben asked: no prompt for him, a status naming whom he waits for.
    await expect(page.getByTestId('confirm-prompt')).toHaveCount(0);
    await expect(page.getByTestId('confirm-status')).toContainText('Waiting for Anna');
    expect((await lane(page)).map((e) => [e.kind, e.face, e.marker, e.pending, e.number])).toEqual([
      ['spell', 'abolt', false, false, 1],
      ['ability', 'bbear', true, true, 2],
    ]);
    expect((await remote(page, 's0', { type: 'respond', round: s.confirm!.id, seat: 's0', response: 'ok' })).refused).toBeNull();
    await expect(page.getByTestId('confirm-status')).toContainText('All passed');
    // The round stays open (it ends with its item), but the pill does not stay forever.
    await expect(page.getByTestId('confirm-status')).toHaveCount(0, { timeout: 6000 });
    expect((await state(page)).confirm?.id).toBe(s.confirm!.id);
  });

  test('while another player holds the floor, Hold is not offered; OK still is', async ({ page }) => {
    await open(page, { seat: 's1', seats: ['Anna', 'Ben', 'Cleo'], timer: LONG_TIMER });
    await annaCasts(page);
    const prompt = page.getByTestId('confirm-prompt');
    await expect(prompt.getByTestId('prompt-hold')).toBeVisible();
    expect((await remote(page, 's2', { type: 'respond', round: 'r1', seat: 's2', response: 'hold' })).refused).toBeNull();
    await expect(prompt.getByTestId('confirm-holder')).toContainText('Cleo is responding');
    await expect(prompt.getByTestId('prompt-hold')).toHaveCount(0);
    await hoverNothing(page);
    await page.keyboard.press('KeyH');
    await page.waitForTimeout(200);
    expect(await page.evaluate(() => window.__confirmHarness!.refused().length)).toBe(0);
    expect((await state(page)).confirm?.holder).toBe('s2');
    await page.keyboard.press('Enter');
    await expect.poll(async () => (await state(page)).confirm?.responses).toEqual({ s1: 'ok', s2: 'hold' });
  });
});

test.describe('resolve before all-pass requires the second press and logs it', () => {
  test('R with a waiting round warns; a second R resolves with force; the log says so', async ({ page }) => {
    await open(page, { seat: 's0', timer: LONG_TIMER });
    await hoverTableCard(page, 'abear');
    await page.keyboard.press('KeyQ');
    await expect.poll(async () => (await state(page)).stack.length).toBe(1);
    await expect(page.getByTestId('confirm-status')).toContainText('Waiting for Ben');
    await expect(page.getByTestId('resolve')).not.toHaveClass(/\blit\b/);
    await hoverNothing(page);
    await page.keyboard.press('KeyR');
    await expect(page.getByTestId('toast')).toContainText('Not everyone has passed');
    expect((await state(page)).stack).toHaveLength(1);
    expect((await log(page)).some((a) => a.type === 'stackResolve')).toBe(false);
    await page.keyboard.press('KeyR');
    await expect.poll(async () => (await state(page)).stack.length).toBe(0);
    expect((await acted(page)).at(-1)).toMatchObject({ type: 'stackResolve', force: true, by: 's0' });
    await expect(page.getByTestId('log-line').last()).toContainText('before everyone passed');
  });

  test('after everyone passed, Resolve is lit and one press resolves', async ({ page }) => {
    await open(page, { seat: 's0', timer: LONG_TIMER });
    await hoverTableCard(page, 'abear');
    await page.keyboard.press('KeyQ');
    await expect.poll(async () => (await state(page)).confirm?.id ?? null).not.toBeNull();
    const round = (await state(page)).confirm!.id;
    expect((await remote(page, 's1', { type: 'respond', round, seat: 's1', response: 'ok' })).refused).toBeNull();
    await expect(page.getByTestId('resolve')).toHaveClass(/\blit\b/);
    await expect(page.getByTestId('confirm-status')).toContainText('All passed');
    await hoverNothing(page);
    await page.keyboard.press('KeyR');
    await expect.poll(async () => (await state(page)).stack.length).toBe(0);
    expect((await acted(page)).at(-1)).toMatchObject({ type: 'stackResolve' });
    expect((await acted(page)).at(-1)).not.toHaveProperty('force');
  });
});

test.describe('an away peer times out', () => {
  test('a hold by a player who drops no longer stops the clock; they are passed', async ({ page }) => {
    await open(page, { seat: 's0' });
    await hoverTableCard(page, 'abear');
    await page.keyboard.press('KeyQ');
    await expect.poll(async () => (await state(page)).confirm?.id ?? null).not.toBeNull();
    const round = (await state(page)).confirm!.id;
    expect((await remote(page, 's1', { type: 'respond', round, seat: 's1', response: 'hold' })).refused).toBeNull();
    await expect(page.getByTestId('confirm-status')).toContainText('Ben is responding');
    await page.waitForTimeout(TIMER + 500);
    expect((await state(page)).confirm?.responses).toEqual({ s1: 'hold' });
    // The sequencer's liveness rule marks Ben away: a sequenced `away` through the real reducer.
    expect((await page.evaluate(() => window.__confirmHarness!.away('s1', true))).refused).toBeNull();
    expect((await log(page)).some((a) => a.type === 'away' && a.seat === 's1' && a.away)).toBe(true);
    await expect.poll(async () => (await state(page)).seats.s1!.away).toBe(true);
    await expect.poll(async () => (await state(page)).confirm?.responses, { timeout: TIMER + 3000 }).toEqual({ s1: 'timeout' });
    await expect(page.getByTestId('confirm-status')).toContainText('All passed');
  });
});

test.describe('the stack lane (DESIGN "The effect stack", Reading it; Resolving 4)', () => {
  test('items cascade toward each viewer with numbers, notes and markers; dragging an item\'s card reorders it', async ({ page }) => {
    await open(page, { seat: 's1' });
    await annaCasts(page);
    expect((await remote(page, 's0', { type: 'stackNote', item: 'i1', note: 'X = 3' })).refused).toBeNull();
    expect((await remote(page, 's1', { type: 'respond', round: 'r1', seat: 's1', response: 'ok' })).refused).toBeNull();
    expect((await remote(page, 's1', { type: 'stackPush', item: 'i2', kind: 'trigger', source: 'abear', round: 'r2' })).refused).toBeNull();
    expect((await remote(page, 's0', { type: 'stackPush', item: 'i3', kind: 'copy', copyOf: 'i1', round: 'r3' })).refused).toBeNull();
    expect((await remote(page, 's0', { type: 'lineAdd', line: 'l1', kind: 'target', from: { kind: 'stackItem', id: 'i3' }, to: { kind: 'card', id: 'bbear' } })).refused).toBeNull();
    await expect.poll(async () => (await lane(page)).length).toBe(3);
    const entries = await laneSettled(page);
    expect(entries.map((e) => [e.item, e.number, e.kind, e.marker, e.face, e.controller, e.note])).toEqual([
      ['i1', 1, 'spell', false, 'abolt', 's0', 'X = 3'],
      ['i2', 2, 'trigger', true, 'abear', 's1', null],
      ['i3', 3, 'copy', true, 'abolt', 's0', null],
    ]);
    // Newer items lie toward the viewer (lower on Ben's screen) and leave every title strip (22 of 88 mm) visible.
    for (let i = 1; i < entries.length; i++) {
      const prev = entries[i - 1]!.screen;
      const cur = entries[i]!.screen;
      expect(cur.y).toBeGreaterThan(prev.y);
      expect(cur.y - prev.y).toBeCloseTo((fullHeight(entries[i - 1]!) * 22) / 88, 0);
    }
    // Markers are drawn smaller than a cast card, so they read as markers ("a small ability marker").
    expect(entries.map((e) => e.scale)).toEqual([1, entries[1]!.scale, entries[1]!.scale]);
    expect(entries[1]!.scale).toBeLessThan(1);
    expect(entries[1]!.screen.width).toBeLessThan(entries[0]!.screen.width);
    // The target line starts at the copy marker.
    const lines = await page.evaluate(() => window.__spellplane!.lines!());
    expect(lines.map((l) => l.id)).toEqual(['l1']);
    if (process.env.M1P3_SHOTS) await page.screenshot({ path: `test-results/m1-p3-stack-${test.info().project.name}.png` });

    // Drag the bottom spell by its title strip onto the top slot.
    await dragBetween(page, stripPoint(entries[0]!), stripPoint(entries[2]!));
    await expect.poll(async () => (await state(page)).stack.map((i) => i.id)).toEqual(['i2', 'i3', 'i1']);
    expect((await acted(page)).at(-1)).toMatchObject({ type: 'stackReorder', item: 'i1', index: 2, by: 's1' });
    // The round about the copy keeps going.
    expect((await state(page)).confirm?.id).toBe('r3');
  });
});

test.describe('markers can be acted on (DESIGN "The effect stack": Note, Copy, Resolving 4)', () => {
  test('a buried marker takes a note (N) and a copy (X), is reordered and dragged out; keys over it never reach the selection', async ({ page }) => {
    await open(page, { seat: 's1' });
    await annaCasts(page);
    expect((await remote(page, 's1', { type: 'respond', round: 'r1', seat: 's1', response: 'ok' })).refused).toBeNull();
    expect((await remote(page, 's1', { type: 'stackPush', item: 'i2', kind: 'trigger', source: 'abear', round: 'r2' })).refused).toBeNull();
    expect((await remote(page, 's0', { type: 'stackPush', item: 'i3', kind: 'ability', source: 'abear', round: 'r3' })).refused).toBeNull();
    await expect.poll(async () => (await lane(page)).length).toBe(3);
    await laneSettled(page);

    // Ben selects his creature, then points at the buried trigger marker i2.
    await hoverTableCard(page, 'bbear');
    await page.mouse.down();
    await page.mouse.up();
    const marker = () => lane(page).then((e) => e.find((x) => x.item === 'i2')!);
    let at = stripPoint(await marker());
    await page.mouse.move(at.x, at.y);
    const before = (await acted(page)).length;
    // Card keys over a marker do nothing (they never fall through to the selection).
    await page.keyboard.press('KeyG');
    await page.keyboard.press('KeyT');
    await page.waitForTimeout(200);
    expect((await acted(page)).length).toBe(before);
    expect((await state(page)).cards.bbear!.zone).toBe('battlefield:s1');

    // N: the note field opens for the marker.
    await page.keyboard.press('KeyN');
    await expect(page.getByTestId('note-input')).toBeFocused();
    await page.getByTestId('note-input').fill('once per turn');
    await page.keyboard.press('Enter');
    await expect.poll(async () => (await state(page)).stack.find((i) => i.id === 'i2')?.note).toBe('once per turn');
    expect((await acted(page)).at(-1)).toMatchObject({ type: 'stackNote', item: 'i2', by: 's1' });

    // X: a copy marker of it goes on the stack, with a round.
    await page.mouse.move(at.x, at.y + 1);
    await page.keyboard.press('KeyX');
    await expect.poll(async () => (await state(page)).stack.length).toBe(4);
    const copy = (await state(page)).stack[3]!;
    expect(copy).toMatchObject({ kind: 'copy', copyOf: 'i2', controller: 's1' });
    expect((await state(page)).confirm?.about).toBe(copy.id);

    // Drag the marker onto the top slot: it is reordered.
    let entries = await laneSettled(page);
    at = stripPoint(entries.find((x) => x.item === 'i2')!);
    await dragBetween(page, at, stripPoint(entries[3]!));
    await expect.poll(async () => (await state(page)).stack.map((i) => i.id)).toEqual(['i1', 'i3', copy.id, 'i2']);
    expect((await acted(page)).at(-1)).toMatchObject({ type: 'stackReorder', item: 'i2', index: 3, by: 's1' });

    // Drag the buried ability marker i3 out of the lane: it leaves the stack, as one grouped step.
    entries = await laneSettled(page);
    at = stripPoint(entries.find((x) => x.item === 'i3')!);
    await dragBetween(page, at, { x: 720, y: 160 });
    await expect.poll(async () => (await state(page)).stack.map((i) => i.id)).toEqual(['i1', copy.id, 'i2']);
    const [reorder, counter] = (await acted(page)).slice(-2);
    expect(reorder).toMatchObject({ type: 'stackReorder', item: 'i3', index: 3 });
    expect(counter).toMatchObject({ type: 'stackCounter', item: 'i3' });
    expect(reorder!.group).toBeDefined();
    expect(counter!.group).toBe(reorder!.group);
    // The card under them was never touched; the selection is still Ben's creature (G away from the lane moves it).
    expect((await state(page)).cards.abolt!.zone).toBe('stack');
    await hoverNothing(page);
    await page.keyboard.press('KeyG');
    await expect.poll(async () => (await state(page)).cards.bbear!.zone).toBe('graveyard:s1');
  });
});

test.describe('manual ask (DESIGN "Turn flow and confirmation", Confirmation rounds 1-2)', () => {
  test('K asks; the asker\'s avatar pulses until everyone passed', async ({ page }) => {
    await open(page, { seat: 's0' });
    await hoverNothing(page);
    // K opens the inline Ask field; Enter with no label asks.
    await page.keyboard.press('KeyK');
    await expect(page.getByTestId('ask-input')).toBeFocused();
    expect((await state(page)).confirm).toBeNull();
    await page.keyboard.press('Enter');
    await expect.poll(async () => (await state(page)).confirm?.askedBy ?? null).toBe('s0');
    expect((await state(page)).confirm).not.toHaveProperty('label');
    const mine = page.locator('[data-testid="avatar"][data-seat="s0"]');
    await expect(mine.getByTestId('asking')).toBeVisible();
    await expect(page.getByTestId('confirm-status')).toContainText('Waiting for Ben');
    await expect.poll(async () => (await state(page)).confirm?.responses, { timeout: TIMER + 3000 }).toEqual({ s1: 'timeout' });
    await expect(mine.getByTestId('asking')).toHaveCount(0);
  });

  test('K with a typed label asks with it; Esc in the field asks nothing', async ({ page }) => {
    await open(page, { seat: 's0', timer: LONG_TIMER });
    await hoverNothing(page);
    await page.keyboard.press('KeyK');
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('ask-field')).toHaveCount(0);
    expect((await state(page)).confirm).toBeNull();
    await page.keyboard.press('KeyK');
    await page.getByTestId('ask-input').fill('attacks?');
    await page.keyboard.press('Enter');
    await expect.poll(async () => (await state(page)).confirm?.label ?? null).toBe('attacks?');
    expect((await acted(page)).at(-1)).toMatchObject({ type: 'ask', label: 'attacks?', by: 's0' });
  });

  test('another player\'s labelled ask shows its label in the prompt', async ({ page }) => {
    await open(page, { seat: 's1', timer: LONG_TIMER });
    expect((await remote(page, 's0', { type: 'ask', round: 'k1', label: 'attacks?' })).refused).toBeNull();
    await expect(page.getByTestId('confirm-prompt')).toContainText('Anna asks “attacks?”');
    await expect(page.locator('[data-testid="avatar"][data-seat="s0"]').getByTestId('asking')).toBeVisible();
    await hoverNothing(page);
    await page.keyboard.press('Enter');
    await expect.poll(async () => (await state(page)).confirm?.responses).toEqual({ s1: 'ok' });
    await expect(page.locator('[data-testid="avatar"][data-seat="s0"]').getByTestId('asking')).toHaveCount(0);
  });
});
