/**
 * PLAN Milestone 6 acceptance, Hold-to-talk (M6-P2): "with the option on, a held drag talks (Chromium fake media) and a
 * click does not". Owner decision: 'A setting "Talk while I hold or drag" (Voice section, off by default). When on, at a
 * table with voice, any press of a mouse button or a finger on the table held longer than 200 ms (card drags, line drags,
 * box selection, camera drags, holding to clip) opens the mic as push-to-talk until release; quick clicks and taps never
 * do. Dictation captions attach to the dragged card as usual.'
 *
 * Two pages on `?transport=local` (BroadcastChannel carries no media, so the outgoing tracks are read from the debug
 * hook's `voice.tracks()`, the real MediaStreamTrack of each connection, as in tests/e2e/voice/table.spec.ts). A
 * recorder in the page samples the talk state every few milliseconds, so "a click never talks" means it never opened,
 * not just that it is closed afterwards.
 */
import { expect, test, type Page } from '@playwright/test';
import type { InstanceId, TableState } from '../../../src/core/types';
import type { SceneDebugCard } from '../../../src/scene/table-scene';
import type { TalkIndicatorState, VoiceTrackState } from '../../../src/voice/types';
import { hook, openApp } from '../helpers/app';
import { centreOf, drawn, lastAction, playCard, say, startTable, type Table } from '../captions/helpers';
import { chair, decklist, freshProfile, freshRoom, openTable, setNickname, twoPages } from '../lobby/helpers';

const tracks = (page: Page) => hook<VoiceTrackState[]>(page, 'voice.tracks');
const enabled = async (page: Page) => (await tracks(page)).map((t) => t.enabled);
const pressHeld = (page: Page) => hook<boolean>(page, 'voice.pressHeld');
const indicator = (page: Page) => page.getByTestId('talk-indicator');

async function ready(page: Page, file: string): Promise<void> {
  await page.getByTestId('lobby-deck-text').fill(decklist(file));
  await page.getByTestId('lobby-deck-check').click();
  await expect(page.getByTestId('lobby-deck-summary')).toContainText('60 cards in the deck');
  await page.getByTestId('ready').click();
  await expect(page.getByTestId('ready-done')).toContainText('60 cards is committed');
}

/** Sample whether the page's mic was ever open (audio or captions) from now on. */
async function record(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as { __talkSeen: string[]; __talkTimer?: number };
    if (w.__talkTimer) clearInterval(w.__talkTimer);
    w.__talkSeen = [];
    w.__talkTimer = window.setInterval(() => {
      const t = window.__spellplane?.voice?.talk();
      if (t && (t.audio !== 'off' || t.dictation !== 'off')) w.__talkSeen.push(`${t.audio}/${t.dictation}`);
    }, 5);
  });
}
const seen = (page: Page) => page.evaluate(() => (window as unknown as { __talkSeen: string[] }).__talkSeen);

/** Drag from `from` by `dx` over about `ms`, holding the left button; resolves with the button still held. */
async function holdDrag(page: Page, from: { x: number; y: number }, dx: number, ms = 450): Promise<void> {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  const steps = 9;
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(from.x + (dx * i) / steps, from.y);
    await page.waitForTimeout(ms / steps);
  }
}

/** A point on the table itself (the scene's canvas, no HUD over it), from a few candidates. */
async function tablePoint(page: Page, candidates: { x: number; y: number }[]): Promise<{ x: number; y: number }> {
  const hit = await page.evaluate((pts) => pts.find((p) => document.elementFromPoint(p.x, p.y)?.tagName === 'CANVAS') ?? null, candidates);
  if (!hit) throw new Error('no free table point among the candidates');
  return hit;
}
const OPEN_TABLE = [
  { x: 520, y: 300 },
  { x: 900, y: 300 },
  { x: 700, y: 360 },
  { x: 400, y: 450 },
];

async function setHoldTalk(page: Page, on: boolean): Promise<void> {
  await page.getByTestId('voice-settings').click();
  const box = page.getByTestId('talk-while-holding');
  await expect(box).toBeVisible();
  if (on) await box.check();
  else await box.uncheck();
  await page.getByTestId('voice-settings').click();
  await expect(page.getByTestId('voice-panel')).toHaveCount(0);
}

test('with "Talk while I hold or drag" on, a held drag talks until release and a click does not (Chromium fake media)', async ({ browser, browserName }, info) => {
  test.skip(browserName !== 'chromium', 'fake media is Chromium-only; WebKit would prompt for the microphone');
  test.setTimeout(150_000);
  const { context, a, b } = await twoPages(browser);
  const errors: string[] = [];
  for (const p of [a, b]) p.on('pageerror', (e) => errors.push(e.message));
  const room = freshRoom();
  await openTable(a, room, freshProfile(info, 'ha'));
  await setNickname(a, 'Ann');
  await expect(chair(a, 's0')).toHaveAttribute('data-mine', 'true');
  await openTable(b, room, freshProfile(info, 'hb'));
  await setNickname(b, 'Ben');
  await expect(chair(b, 's1')).toHaveAttribute('data-mine', 'true');
  for (const p of [a, b]) await expect.poll(() => hook<string>(p, 'net.status'), { timeout: 15_000 }).toBe('connected');
  await ready(a, 'gw-m19-60.txt');
  await ready(b, 'ur-m19-60.mtga.txt');
  await expect(a.getByTestId('ready-count')).toHaveText('2 of 2 players ready.');
  await a.getByTestId('start-game').click();
  for (const p of [a, b]) await expect(p.getByTestId('hud')).toBeVisible();
  for (const p of [a, b]) {
    await p.getByTestId('voice-join').click();
    await expect(indicator(p)).toHaveAttribute('data-state', 'idle');
  }
  await expect.poll(() => enabled(a)).toEqual([false]);

  // A token on Ann's battlefield to drag.
  await a.evaluate(() => window.__spellplane!.dispatch!({ type: 'createToken', card: 'tok-h', zone: 'battlefield:s0', pose: { x: 0, y: -150, rot: 0 }, label: 'Soldier' } as never));
  const card = 'tok-h' as InstanceId;
  await expect.poll(async () => (await hook<SceneDebugCard[]>(a, 'cards')).some((c) => c.id === card && c.visible && !c.moving), { timeout: 15_000 }).toBe(true);
  const at = await centreOf(a, card);
  await a.bringToFront();

  // Off by default: a held drag opens nothing.
  await record(a);
  await holdDrag(a, at, 60);
  await a.mouse.up();
  await a.waitForTimeout(300);
  expect(await seen(a)).toEqual([]);
  expect(await enabled(a)).toEqual([false]);

  // On (Voice settings).
  await setHoldTalk(a, true);
  await expect.poll(() => a.evaluate(() => window.__spellplane!.voice!.talk().audio)).toBe('off');
  const from = await centreOf(a, card);

  // A click on the card never talks, not even for a moment; nor does a double click.
  await record(a);
  await a.mouse.click(from.x, from.y);
  await a.waitForTimeout(500);
  await a.mouse.dblclick(from.x, from.y);
  await a.waitForTimeout(500);
  expect(await seen(a)).toEqual([]);
  expect(await enabled(a)).toEqual([false]);
  await expect(indicator(a)).toHaveAttribute('data-state', 'idle');

  // A held drag of the card talks while it is held, with the normal talk indicator.
  const before = (await hook<TableState>(a, 'state')).cards[card]!.pose!;
  await holdDrag(a, from, 120);
  await expect.poll(() => enabled(a)).toEqual([true]);
  expect(await pressHeld(a)).toBe(true);
  await expect(indicator(a)).toHaveAttribute('data-state', 'live');
  expect(await hook(a, 'voice.talk')).toMatchObject({ audio: 'all', reason: 'key' });
  // Still talking while the button stays down without moving.
  await a.waitForTimeout(300);
  expect(await enabled(a)).toEqual([true]);
  await a.mouse.up();
  await expect.poll(() => enabled(a)).toEqual([false]);
  expect(await pressHeld(a)).toBe(false);
  await expect(indicator(a)).toHaveAttribute('data-state', 'idle');
  // It really was a drag: the card moved, on both pages.
  await expect.poll(async () => (await hook<TableState>(b, 'state')).cards[card]?.pose?.x ?? before.x, { timeout: 15_000 }).not.toBe(before.x);

  // A camera drag on empty table talks too, and so does a press held still (as when holding to clip).
  await holdDrag(a, await tablePoint(a, OPEN_TABLE), -80);
  await expect.poll(() => enabled(a)).toEqual([true]);
  await a.mouse.up();
  await expect.poll(() => enabled(a)).toEqual([false]);
  await a.mouse.move(from.x + 120, from.y);
  await a.mouse.down();
  await expect.poll(() => enabled(a)).toEqual([true]);
  await a.mouse.up();
  await expect.poll(() => enabled(a)).toEqual([false]);

  // A press on the HUD (the log panel) is not a table press.
  await record(a);
  const log = a.getByTestId('log');
  const box = (await log.boundingBox())!;
  await a.mouse.move(box.x + box.width / 2, box.y + 10);
  await a.mouse.down();
  await a.waitForTimeout(500);
  await a.mouse.up();
  expect(await seen(a)).toEqual([]);

  // Ben never turned it on: his held drag stays silent.
  await b.bringToFront();
  await record(b);
  await holdDrag(b, await tablePoint(b, OPEN_TABLE), 80);
  await b.waitForTimeout(200);
  await b.mouse.up();
  expect(await seen(b)).toEqual([]);

  // Turned off again: a held drag no longer talks.
  await a.bringToFront();
  await setHoldTalk(a, false);
  await record(a);
  await holdDrag(a, await centreOf(a, card), 60);
  await a.waitForTimeout(200);
  await a.mouse.up();
  expect(await seen(a)).toEqual([]);
  expect(errors).toEqual([]);
  await context.close();
});

let table: Table | null = null;
test.afterEach(async () => {
  await table?.context.close();
  table = null;
});

test('captions said while dragging a card attach to that card, not to the card last touched', async ({ browser }, info) => {
  test.setTimeout(150_000);
  table = await startTable(browser, info, { speech: true });
  const { a, b } = table;
  const first = await playCard(table, { x: -120, y: -220, rot: 0 });
  const dragged = await playCard(table, { x: 120, y: -220, rot: 0 });
  // Anna taps the first card last: without the press, a caption would go there.
  await a.evaluate((card) => window.__spellplane!.dispatch!({ type: 'tap', card, tapped: true } as never), first);
  await expect.poll(async () => ((await lastAction(b, 'tap')) as { card?: string } | null)?.card ?? null, { timeout: 15_000 }).toBe(first);

  await a.bringToFront();
  await setHoldTalk(a, true);
  expect(await hook<TalkIndicatorState>(a, 'voice.indicator')).not.toBe('dictating');
  const at = await centreOf(a, dragged);
  await holdDrag(a, at, 90);
  await expect.poll(() => a.evaluate(() => window.__spellplane!.voice!.talk().dictation)).toBe('caption');
  await expect(indicator(a)).toHaveAttribute('data-state', 'dictating');
  expect(await say(a, 'this one attacks', false)).toBe(true);
  for (const p of [a, b]) {
    await expect
      .poll(async () => (await drawn(p)).find((c) => c.text === 'this one attacks')?.anchoredTo ?? null, { timeout: 15_000 })
      .toEqual({ kind: 'card', id: dragged });
  }
  expect(await say(a, 'this one attacks now', true)).toBe(true);
  await a.mouse.up();
  for (const p of [a, b]) {
    await expect.poll(async () => ((await lastAction(p, 'caption')) as { anchor?: unknown } | null)?.anchor ?? null, { timeout: 15_000 }).toEqual({ kind: 'card', id: dragged });
  }
  await expect.poll(() => a.evaluate(() => window.__spellplane!.voice!.talk().dictation)).toBe('off');
});

test('away from a table the Voice section offers "Talk while I hold or drag", off by default, and keeps the choice', async ({ page }, info) => {
  const profile = freshProfile(info, 'hs');
  await openApp(page, { profile, hash: '/settings' });
  await page.locator('[data-testid="settings-tab"][data-section="voice"]').click();
  const box = page.getByTestId('voice-settings-offline').getByTestId('talk-while-holding');
  await expect(box).not.toBeChecked();
  await box.check();
  // Stored in this browser's settings (the profile's IndexedDB) before the page goes.
  const stored = () =>
    page.evaluate(
      (db) =>
        new Promise<unknown>((resolve) => {
          const req = indexedDB.open(db);
          req.onerror = () => resolve(null);
          req.onsuccess = () => {
            const get = req.result.transaction('settings', 'readonly').objectStore('settings').get('talkWhileHolding');
            get.onsuccess = () => {
              req.result.close();
              resolve((get.result as { value?: unknown } | undefined)?.value ?? null);
            };
            get.onerror = () => resolve(null);
          };
        }),
      `spellplane-${profile}`,
    );
  await expect.poll(stored).toBe(true);
  await page.reload();
  await expect.poll(() => page.evaluate(() => typeof window.__spellplane === 'object')).toBe(true);
  await page.locator('[data-testid="settings-tab"][data-section="voice"]').click();
  await expect(page.getByTestId('voice-settings-offline').getByTestId('talk-while-holding')).toBeChecked();
});
