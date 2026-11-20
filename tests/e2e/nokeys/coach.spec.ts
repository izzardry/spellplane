/**
 * PLAN M7-P5: "gesture coach marks that appear once at the moment an action becomes relevant (first draw, first land,
 * first attack) and never cover the play area"; "no hint text teaches keys"; docs/design/m7-hud-proposal.md, First-run
 * hints: "One coach mark at a time … They disappear once you've done it." Through the debug hook's `coach` part.
 */
import { expect, test, type Page } from '@playwright/test';
import { hook } from '../helpers/app';
import { call, decklist, openSolo } from '../solo/helpers';
import { IPAD } from '../touch/helpers';
import { cardIn, coachNow, coachSeen, handIds, handPoint, mouseDrag, pileCentre, profileFor, settledTable, shown, tableToScreen, typeLine } from './helpers';

const overlap = (a: { x: number; y: number; width: number; height: number }, b: { x: number; y: number; width: number; height: number }) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

/** The coach mark covers no card drawn on the table and sits in the lower part of the screen, above the hand. */
async function clearOfThePlayArea(page: Page): Promise<void> {
  const mark = (await page.getByTestId('coach-mark').boundingBox())!;
  const vp = page.viewportSize()!;
  expect(mark.y).toBeGreaterThan(vp.height * 0.55);
  for (const c of await shown(page)) if (c.visible && c.zone.startsWith('battlefield')) expect(overlap(mark, c.screen), `covers ${c.id}`).toBe(false);
  // Never over the opponent's side: the mark's box and the opponent territory's screen box do not meet.
  const view = await hook<{ seats: { seat: string; zones?: { territory?: ({ x: number; y: number } | null)[] } }[] } | null>(page, 'tableView');
  const opp = view?.seats.find((s) => s.seat !== 's0')?.zones?.territory?.filter((p): p is { x: number; y: number } => !!p) ?? [];
  if (opp.length) {
    const xs = opp.map((p) => p.x);
    const ys = opp.map((p) => p.y);
    const box = { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) };
    expect(overlap(mark, box), 'covers the opponent territory').toBe(false);
  }
  // Not over the own piles: a newcomer reaches for the library the first mark points at.
  const own = view?.seats.find((s) => s.seat === 's0')?.zones as Record<string, ({ x: number; y: number } | null)[] | undefined> | undefined;
  for (const kind of ['library', 'graveyard', 'exile']) {
    const pts = own?.[kind]?.filter((p): p is { x: number; y: number } => !!p) ?? [];
    if (pts.length < 4) continue;
    const xs = pts.map((p) => p.x);
    const ys = pts.map((p) => p.y);
    const box = { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) };
    expect(overlap(mark, box), `covers the own ${kind}`).toBe(false);
  }
  // Not over the hand either.
  for (const h of await page.getByTestId('hand-card').all()) {
    const b = await h.boundingBox();
    if (b) expect(mark.y + mark.height).toBeLessThanOrEqual(b.y + 1);
  }
}

test('one coach mark at a time, at its moment, gone once done and never again: draw, then land, then tap', async ({ page }, info) => {
  const profile = profileFor(info, 'coach');
  await openSolo(page, profile);
  await call(page, 'importDecklist', decklist('gw-m19-60.txt'));
  const mark = page.getByTestId('coach-mark');
  // An empty hand and a full library: the first draw.
  await expect(mark).toHaveAttribute('data-coach', 'coachDraw');
  await expect(mark).toHaveCount(1);
  await expect(mark).toContainText('Click your library to draw');
  await expect(mark).not.toContainText(/\bpress\b|\bkey\b/i);
  await clearOfThePlayArea(page);

  // Drawing (here the opening hand through the hook, then until a land is in hand) is what it teaches: it goes.
  await call(page, 'draw', 7);
  let land: string | undefined;
  for (let i = 0; i < 20 && !land; i++) {
    for (const id of await handIds(page)) if (!land && /\bLand\b/.test(await typeLine(page, id))) land = id;
    if (!land) await call(page, 'draw', 1);
  }
  expect(land).toBeTruthy();
  await expect.poll(() => coachSeen(page)).toContain('coachDraw');
  // A land in hand and none in play: the first land.
  await expect(mark).toHaveAttribute('data-coach', 'coachPlayLand');
  await expect(mark).toContainText('Drag a land from your hand onto the table');
  await clearOfThePlayArea(page);
  await settledTable(page);
  await mouseDrag(page, await handPoint(page, land!), await tableToScreen(page, { x: -300, y: -330 }));
  await expect.poll(async () => (await cardIn(page, land!))?.zone).toBe('battlefield:s0');
  await expect.poll(() => coachSeen(page)).toContain('coachPlayLand');
  // An untapped card in play: tapping.
  await expect(mark).toHaveAttribute('data-coach', 'coachTap');
  await expect(mark).toContainText('Double-click a card to tap');
  await clearOfThePlayArea(page);

  // Dismissed: done for this profile; the next one follows. A reload shows neither again.
  await mark.getByTestId('coach-dismiss').click();
  await expect.poll(() => coachSeen(page)).toContain('coachTap');
  await expect(mark).toHaveAttribute('data-coach', 'coachSelect');
  await page.evaluate(() => (window.__spellplane as unknown as { coach: { saved(): Promise<void> } }).coach.saved());
  await page.reload();
  await expect.poll(() => page.evaluate(() => typeof window.__spellplane?.coach?.current === 'function')).toBe(true);
  await expect.poll(() => coachNow(page)).toBe('coachSelect');
  expect(await coachSeen(page)).toEqual(expect.arrayContaining(['coachDraw', 'coachPlayLand', 'coachTap']));
});

test('a coach mark lets the table work under it: only its button takes the pointer', async ({ page }, info) => {
  await openSolo(page, profileFor(info, 'coach2'));
  await call(page, 'importDecklist', decklist('gw-m19-60.txt'));
  const mark = page.getByTestId('coach-mark');
  await expect(mark).toHaveAttribute('data-coach', 'coachDraw');
  const b = (await mark.boundingBox())!;
  const through = await page.evaluate(([x, y]) => document.elementFromPoint(x!, y!)?.closest('[data-testid="coach-mark"]') === null, [b.x + 8, b.y + b.height / 2]);
  expect(through).toBe(true);
  await expect(mark).not.toBeFocused();
  // The draw it teaches, done by the library's own buttons.
  const lib = await pileCentre(page, 'library');
  await page.mouse.click(lib.x, lib.y);
  await page.getByTestId('pile-action-draw').click();
  await expect.poll(() => coachSeen(page)).toContain('coachDraw');
  await expect(mark).not.toHaveAttribute('data-coach', 'coachDraw');
  expect(await hook<number>(page, 'input.keydowns')).toBe(0);
});

test.describe('on an iPad', () => {
  test.skip(({ browserName }) => browserName !== 'webkit', 'the iPad is emulated in WebKit (PLAN M5, owner decisions)');
  test.use(IPAD);

  test('the first coach mark (seven cards in hand) stays clear of the piles, and a tap on the library reaches it', async ({ page }, info) => {
    await openSolo(page, profileFor(info, 'coach3'));
    await call(page, 'importDecklist', decklist('gw-m19-60.txt'));
    await call(page, 'draw', 7);
    const mark = page.getByTestId('coach-mark');
    await expect(mark).toHaveCount(1);
    await expect(mark).not.toContainText(/\bpress\b|\bkey\b|\bclick\b/i);
    await settledTable(page);
    await clearOfThePlayArea(page);
    const lib = await pileCentre(page, 'library');
    await page.touchscreen.tap(lib.x, lib.y);
    await expect(page.getByTestId('pile-actions')).toHaveAttribute('data-zone', 'library:s0');
  });
});
