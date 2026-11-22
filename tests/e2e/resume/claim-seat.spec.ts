/**
 * K1 (docs/gates/M8-gate.md "Round 4"): a player brought back into a fresh browser plays from the seat they claimed,
 * not from seat `s0`. Private games started from Home (the real table frame, Gathering and claim page), the local
 * transport, fixtures and placeholder faces. A seat other than `s0` is brought back: `s1` of a 1v1 and `s2` of a 4 FFA
 * started with three players. The sequencer's 30-second absence rule runs on the pages' injected clocks
 * (`net.setClock`), never slept through.
 *
 * - On the claim page, before SIT DOWN: no plate is the page's own, the fan is empty, and the page holds no hand and
 *   nothing of the others' hidden cards (journey.md 4.11; the shared hidden-information rule).
 * - After SIT DOWN and the recovery: the own plate is the claimed seat's, the fan holds exactly `hand:<seat>`'s ids, the
 *   other plates show their hand counts, the scene's view is turned to the claimed seat, and on that seat's turn the
 *   HUD's primary is enabled.
 * - The recovery-done panel keeps its close at the right of its text row (visual.md O-1; gate M8 finding N17).
 * Engine behaviour is asserted through the debug hook and the DOM, never on pixels or timing.
 */
import { expect, test, type BrowserContext, type Page, type TestInfo } from '@playwright/test';
import type { SecretStore, TableState } from '../../../src/core/types';
import { scan } from '../../leak/scan';
import { hook } from '../helpers/app';
import { decklist, freshProfile, hands, leaveByArrow, mode, openSite, pages, readyWith, sameHash, seedDeck, state } from '../helpers/journey';

const seatOf = (p: Page) => p.evaluate(() => window.__spellplane?.session?.seat() ?? '');
const secrets = (p: Page) => hook<SecretStore>(p, 'secrets');
const plate = (p: Page, seat: string) => p.locator(`[data-testid="avatar"][data-seat="${seat}"]`);
const fanIds = (p: Page) => p.locator('[data-testid="hand"] [data-testid="hand-card"]').evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.card ?? '').sort());

interface TableViewDebug {
  viewerAngle: number;
  seats: { seat: string; angle: number }[];
}

/** The HUD's one primary of `p`, pressed when it may be. */
async function pressPrimary(p: Page): Promise<void> {
  const primary = p.getByTestId('primary-action');
  if ((await primary.isVisible().catch(() => false)) && (await primary.getAttribute('aria-disabled').catch(() => 'true')) !== 'true') await primary.click({ timeout: 2_000 }).catch(() => undefined);
}

/** The hidden cards `owner` holds: salts always, Scryfall ids of cards nobody has seen face up. */
async function hiddenOf(owner: Page): Promise<string[]> {
  const s = await state(owner);
  const sec = await secrets(owner);
  const shown = new Set(Object.values(s.cards).flatMap((x) => (x.identity ? [x.identity.sid] : [])));
  const out: string[] = [];
  for (const [id, x] of Object.entries(sec.identities)) {
    if (s.cards[id]?.identity) continue;
    out.push(x.salt);
    if (!shown.has(x.card.sid)) out.push(x.card.sid);
  }
  return out;
}

/** The seated pages leave `seat` away for more than 30 s on their clocks; `host` brings it back by its plate menu. Returns the link. */
async function bringBack(host: Page, seated: Page[], seat: string): Promise<string> {
  await expect.poll(async () => (await state(host)).seats[seat]?.away === true, { timeout: 20_000 }).toBe(true);
  await expect.poll(async () => new Set(await Promise.all(seated.map((p) => p.evaluate(() => window.__spellplane!.net!.sequencer())))).size, { timeout: 15_000 }).toBe(1);
  const t0 = await host.evaluate(() => Date.now());
  for (const p of seated) await p.evaluate((t) => window.__spellplane!.net!.setClock!(t), t0 + 31_000);
  await plate(host, seat).getByTestId('plate-more').click();
  const bring = host.getByTestId('seat-menu-bring');
  await expect(bring).toBeVisible();
  for (const p of seated) await p.evaluate((t) => window.__spellplane!.net!.setClock!(t), t0 + 62_000);
  await bring.click();
  await expect(host.getByTestId('share-link')).toHaveValue(new RegExp(`/rejoin/${seat}/`), { timeout: 15_000 });
  const link = await host.getByTestId('share-link').inputValue();
  for (const p of seated) await p.evaluate(() => window.__spellplane!.net!.setClock!(null));
  await host.keyboard.press('Escape');
  return link;
}

/**
 * The link in a blank profile: the claim page shows no seat as its own and holds nothing hidden; SIT DOWN; the
 * recovery (a new hand of 7) with the others' OK. Returns the new page.
 */
async function claimAndRecover(context: BrowserContext, info: TestInfo, link: string, seat: string, others: Page[]): Promise<Page> {
  const c = await context.newPage();
  await openSite(c, freshProfile(info, 'claimant'), link.slice(link.indexOf('#') + 1));
  await expect(c.getByTestId('claim-page')).toBeVisible({ timeout: 30_000 });
  // Behind the claim page the table is watched: no plate says "you", the fan is empty, the page holds no hand.
  await expect(c.locator('[data-testid="avatar"]').first()).toBeAttached({ timeout: 20_000 });
  await expect(c.locator('[data-testid="avatar"][data-me="true"]')).toHaveCount(0);
  await expect(c.getByTestId('hand-card')).toHaveCount(0);
  expect(Object.keys((await state(c)).seats)).not.toContain(await seatOf(c));
  expect((await secrets(c)).hand).toEqual([]);
  // Nothing of the seated players' hidden cards reached the claim page.
  for (const owner of others) expect(scan([await hook(c, 'net.messages'), await state(c), await secrets(c)], await hiddenOf(owner))).toEqual([]);

  await c.getByTestId('claim-sit').click();
  await expect.poll(() => seatOf(c), { timeout: 20_000 }).toBe(seat);
  await expect(c.getByTestId('recovery')).toHaveAttribute('data-phase', 'lost', { timeout: 20_000 });
  await c.getByTestId('recovery-hand').fill('7');
  await c.getByTestId('recovery-start').click();
  const dialog = c.getByTestId('recovery-import');
  await dialog.getByTestId('deck-text').fill(decklist('gw-m19-60.txt'));
  await dialog.getByTestId('deck-check').click();
  await dialog.getByTestId('deck-import-go').click();
  await expect(dialog).toHaveCount(0);
  await expect
    .poll(async () => {
      for (const p of others) {
        const ok = p.getByTestId('prompt-ok');
        if (await ok.isVisible().catch(() => false)) await ok.click({ timeout: 2_000 }).catch(() => undefined);
      }
      return c.getByTestId('recovery-done').isVisible();
    }, { timeout: 45_000 })
    .toBe(true);
  await expect(c.getByTestId('recovery-done')).toContainText('a hand of 7');
  // N17: the close sits at the right of the text row, not alone on a line under it.
  const text = (await c.getByTestId('recovery-done').boundingBox())!;
  const close = (await c.getByTestId('recovery-done-close').boundingBox())!;
  expect(close.x).toBeGreaterThanOrEqual(text.x + text.width - 1);
  expect(close.y).toBeLessThan(text.y + text.height);
  await c.getByTestId('recovery-done-close').click();
  await expect(c.getByTestId('recovery-done')).toHaveCount(0);
  await sameHash([c, ...others]);
  return c;
}

/** The HUD of `c` belongs to `seat`: own plate, fan, the other plates' counts, the scene's view. */
async function hudIsSeat(c: Page, seat: string, otherSeats: string[]): Promise<void> {
  await expect(c.locator('[data-testid="avatar"][data-me="true"]')).toHaveCount(1);
  await expect(c.locator('[data-testid="avatar"][data-me="true"]')).toHaveAttribute('data-seat', seat);
  await expect(c.locator('[data-hud-chrome="own-plate"] [data-testid="avatar"]')).toHaveAttribute('data-seat', seat);
  await expect(plate(c, seat).getByTestId('hand-count')).toHaveCount(0);
  await expect.poll(async () => JSON.stringify(await fanIds(c)), { timeout: 15_000 }).toBe(JSON.stringify([...(await state(c)).zones[`hand:${seat}`]!.ids].sort()));
  expect((await fanIds(c)).length).toBe(7);
  const st: TableState = await state(c);
  for (const other of otherSeats) {
    await expect(plate(c, other)).toHaveAttribute('data-me', 'false');
    await expect(plate(c, other).getByTestId('hand-count')).toHaveText(String(st.zones[`hand:${other}`]!.ids.length));
  }
  // The scene's view is turned to the claimed seat (every viewer sees their own seat at the bottom).
  await expect
    .poll(async () => {
      const v = await hook<TableViewDebug | null>(c, 'tableView');
      return v ? v.viewerAngle === v.seats.find((s) => s.seat === seat)?.angle : false;
    }, { timeout: 15_000 })
    .toBe(true);
}

/** Pass turns by the active seat's primary until it is `seat`'s turn; then `seat`'s primary is enabled. */
async function primaryOnOwnTurn(bySeat: Record<string, Page>, seat: string): Promise<void> {
  const any = bySeat[seat]!;
  await expect
    .poll(async () => {
      const s = await state(any);
      if (s.turn.active !== seat && bySeat[s.turn.active]) await pressPrimary(bySeat[s.turn.active]!);
      return s.turn.active;
    }, { timeout: 60_000, intervals: [250] })
    .toBe(seat);
  const primary = any.getByTestId('primary-action');
  await expect(primary).toBeVisible();
  await expect(primary).not.toHaveAttribute('aria-disabled', 'true');
  await expect(primary).not.toContainText(/WAITING/i);
}

test.describe('bring back a seat other than s0 (K1)', () => {
  test('1v1: Ben (s1) is brought back into a blank profile and plays from his own seat', async ({ browser }, info) => {
    test.setTimeout(240_000);
    const { context, list } = await pages(browser, 2);
    const [a, b0] = list as [Page, Page];
    try {
      await test.step('a private 1v1 from Home: seven cards each', async () => {
        await a.clock.install();
        await openSite(a, freshProfile(info, 'ann'));
        await seedDeck(a, 'gw-m19-60.txt');
        await mode(a, 'private');
        await a.getByTestId('home-primary').click();
        await expect(a.getByTestId('invite-sheet')).toBeVisible({ timeout: 20_000 });
        const link = await a.getByTestId('share-link').inputValue();
        await openSite(b0, freshProfile(info, 'ben'), link.slice(link.indexOf('#') + 1));
        await expect(b0.locator('[data-testid="chair"][data-seat="s1"]')).toHaveAttribute('data-mine', 'true', { timeout: 20_000 });
        await readyWith(b0, 'ur-m19-60.mtga.txt');
        await readyWith(a, 'gw-m19-60.txt');
        await expect(a.getByTestId('start-game')).toHaveText(/^START · [123]$/, { timeout: 15_000 });
        await a.clock.runFor(3_100);
        for (const p of [a, b0]) await expect.poll(() => hands(p, ['s0', 's1']), { timeout: 45_000 }).toEqual([7, 7]);
        await sameHash([a, b0]);
        // Versus is done only while every player is connected: it leaves before anyone leaves the table.
        for (const p of [a, b0]) await expect(p.getByTestId('versus')).toHaveCount(0, { timeout: 15_000 });
      }, { timeout: 90_000 });

      let link = '';
      await test.step('Ben leaves and his browser is lost; Ann brings him back from his plate menu', async () => {
        await b0.evaluate(() => window.__spellplane!.session!.saved());
        await leaveByArrow(b0);
        await b0.close();
        link = await bringBack(a, [a], 's1');
      }, { timeout: 45_000 });

      await test.step('the blank profile watches on the claim page, sits down as Ben and recovers; its HUD is s1’s', async () => {
        const c = await claimAndRecover(context, info, link, 's1', [a]);
        await hudIsSeat(c, 's1', ['s0']);
        await primaryOnOwnTurn({ s0: a, s1: c }, 's1');
      }, { timeout: 120_000 });
    } finally {
      await context.close();
    }
  });

  test('4 FFA with three players: Cy (s2) is brought back into a blank profile and plays from her own seat', async ({ browser }, info) => {
    test.setTimeout(300_000);
    const { context, list } = await pages(browser, 3);
    const [a, b, c0] = list as [Page, Page, Page];
    const seat = { a: '', b: '', c: '' };
    try {
      await test.step('Ann: PRIVATE GAME · 4 FFA; Ben and Cy open the link; START WITH 3 PLAYERS', async () => {
        await openSite(a, freshProfile(info, 'ann'));
        await seedDeck(a, 'gw-m19-60.txt');
        await mode(a, 'private');
        await a.getByTestId('opt-private-format').getByRole('radio', { name: '4 FFA' }).click();
        await a.getByTestId('home-primary').click();
        await expect(a.getByTestId('invite-sheet')).toBeVisible({ timeout: 20_000 });
        const link = await a.getByTestId('share-link').inputValue();
        await expect.poll(async () => (await state(a)).format).toBe('ffa4');
        for (const p of [b, c0]) {
          await openSite(p, freshProfile(info, p === b ? 'ben' : 'cy'), link.slice(link.indexOf('#') + 1));
          await expect(p.locator('[data-testid="chair"][data-mine="true"]')).toHaveCount(1, { timeout: 20_000 });
        }
        seat.a = await seatOf(a);
        seat.b = await seatOf(b);
        seat.c = await seatOf(c0);
        expect([seat.a, seat.b, seat.c]).toEqual(['s0', 's1', 's2']);
        await readyWith(b, 'ur-m19-60.mtga.txt');
        await readyWith(c0, 'gw-m19-60.txt');
        await readyWith(a, 'gw-m19-60.txt');
        await expect(a.getByTestId('start-short')).toHaveText('START WITH 3 PLAYERS', { timeout: 15_000 });
        await a.getByTestId('start-short').click();
        for (const p of [a, b, c0]) await expect.poll(() => hands(p, ['s0', 's1', 's2']), { timeout: 45_000 }).toEqual([7, 7, 7]);
        await sameHash([a, b, c0]);
        // Versus is done only while every player is connected: it leaves before anyone leaves the table.
        for (const p of [a, b, c0]) await expect(p.getByTestId('versus')).toHaveCount(0, { timeout: 15_000 });
      }, { timeout: 120_000 });

      let link = '';
      await test.step('Cy leaves and her browser is lost; Ann brings her back from her plate menu', async () => {
        await c0.evaluate(() => window.__spellplane!.session!.saved());
        await leaveByArrow(c0);
        await c0.close();
        link = await bringBack(a, [a, b], 's2');
      }, { timeout: 45_000 });

      await test.step('the blank profile watches on the claim page, sits down as Cy and recovers; its HUD is s2’s', async () => {
        const c = await claimAndRecover(context, info, link, 's2', [a, b]);
        await hudIsSeat(c, 's2', ['s0', 's1']);
        await primaryOnOwnTurn({ s0: a, s1: b, s2: c }, 's2');
      }, { timeout: 150_000 });
    } finally {
      await context.close();
    }
  });
});
