/**
 * M8-P7 matchmaking end to end (PLAN Milestone 8, M8-P7 E2E; matchmaking.md 2.5, 2.6; journey.md 4.5 to 4.7): pages
 * of one browser on a shell route with `?transport=local` (the lobby lives on a BroadcastChannel), each with its own
 * profile, a deck seeded through the debug hook and `__spellplane.mm` instead of Home. The matchmaker's timers (the
 * 10 s alone text, the 20 s ready ring) are driven by `mm.tick(ms)`, never slept through. Engine behaviour is asserted
 * on the debug hook and state hashes.
 */
import { expect, test, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { stateHash } from '../../../src/core/hash';
import type { MatchRecord, TableState } from '../../../src/core/types';
import { ratingChanges } from '../../../src/net/lobby/rating';
import type { DeckRecord } from '../../../src/store/types';
import { openHome } from '../helpers/app';
import { fixturesScript } from '../offline/helpers';

const FIXTURES = path.resolve('tests/fixtures');
let sidByName: Map<string, string> | null = null;

/** A deck record from a fixture decklist (`N Name` lines, plain or MTGA), resolved against the Scryfall fixtures. */
function deckRecord(id: string, name: string, file: string): DeckRecord {
  if (!sidByName) {
    sidByName = new Map();
    for (const f of ['m19.json', 'tm19.json']) {
      for (const c of JSON.parse(fs.readFileSync(path.join(FIXTURES, 'scryfall', f), 'utf8')) as { id: string; name: string }[]) {
        for (const n of [c.name, c.name.split(' // ')[0]!]) if (!sidByName.has(n)) sidByName.set(n, c.id);
      }
    }
  }
  const main: { sid: string }[] = [];
  for (const line of fs.readFileSync(path.join(FIXTURES, 'decklists', file), 'utf8').split('\n')) {
    const m = /^(\d+)\s+(.+?)\s*$/.exec(line.trim());
    if (!m) continue;
    // Plain `4 Forest` or MTGA `4 Island (M19) 268`.
    const card = m[2]!.replace(/\s+\([A-Z0-9]+\)\s+\S+$/, '');
    const sid = sidByName.get(card);
    if (!sid) throw new Error(`fixture card ${card} missing`);
    for (let i = 0; i < Number(m[1]); i++) main.push({ sid });
  }
  return { id, name, main, side: [], source: 'pasted', createdAt: 1, updatedAt: 1, kind: 'custom' } as DeckRecord;
}

type Status = { phase: string; since?: number; alone?: boolean; link?: { roomId: string; key: string }; mine?: boolean };
const status = (p: Page) => p.evaluate(() => window.__spellplane!.mm!.status()) as Promise<Status>;
const phase = async (p: Page) => (await status(p)).phase;
const tick = (p: Page, ms: number) => p.evaluate((x) => window.__spellplane!.mm!.tick(x), ms);
const seek = (p: Page, deck: DeckRecord, queue = '1v1.constructed.casual') =>
  p.evaluate(([d, q]) => window.__spellplane!.mm!.seekDeck!({ deck: d as never, queues: [q as never] }), [deck, queue] as const);
const state = (p: Page) => p.evaluate(() => window.__spellplane!.state!()) as Promise<TableState>;
const handCount = (st: TableState, seat: string) => Object.values(st.cards).filter((c) => c.zone === `hand:${seat}`).length;

async function openPages(page: Page, n: number, tag: string): Promise<Page[]> {
  const run = `${tag}-${test.info().project.name.slice(0, 3)}-${test.info().workerIndex}-${Date.now().toString(36)}`;
  const pages = [page];
  for (let i = 1; i < n; i++) pages.push(await page.context().newPage());
  for (const [i, p] of pages.entries()) {
    await p.addInitScript({ content: fixturesScript() });
    // Record, in order, when the matched entry and any waiting room mount in this page.
    await p.addInitScript(() => {
      const w = window as unknown as { __seen: string[] };
      w.__seen = [];
      new MutationObserver(() => {
        for (const id of ['matched-entry', 'lobby', 'waiting-room']) {
          const there = !!document.querySelector(`[data-testid="${id}"]`);
          const last = w.__seen.lastIndexOf(id) > w.__seen.lastIndexOf(`-${id}`);
          if (there && !last) w.__seen.push(id);
          if (!there && last) w.__seen.push(`-${id}`);
        }
      }).observe(document, { childList: true, subtree: true });
    });
    await openHome(p, { profile: `${run}-${i}`, transport: 'local' });
  }
  return pages;
}

/** Wait until every page is in a matched table at the same room, with seven cards per seat and equal state hashes. */
async function expectSeated(pages: Page[], seats: number): Promise<string> {
  const ROOM = /^#\/t\/[a-z]+-[a-z]+-[a-z]+-\d+\/[A-Za-z0-9_-]{22}$/;
  for (const p of pages) await expect.poll(() => p.evaluate(() => location.hash), { timeout: 10_000 }).toMatch(ROOM);
  const rooms = await Promise.all(pages.map((p) => p.evaluate(() => location.hash)));
  expect(new Set(rooms).size).toBe(1);
  for (const p of pages) {
    await expect(p.getByTestId('table-frame')).toBeVisible({ timeout: 30_000 });
    await expect
      .poll(
        async () => {
          const st = await state(p);
          const ids = Object.keys(st.seats).sort();
          return { stage: st.stage, committed: Object.keys(st.commitments).length, matched: st.settings.matched === true, hands: ids.map((s) => handCount(st, s)) };
        },
        { timeout: 45_000 },
      )
      .toEqual({ stage: 'match', committed: seats, matched: true, hands: Array<number>(seats).fill(7) });
  }
  await expect.poll(async () => new Set(await Promise.all(pages.map(async (p) => stateHash(await state(p))))).size, { timeout: 20_000 }).toBe(1);
  for (const p of pages) {
    const seen = await p.evaluate(() => (window as unknown as { __seen: string[] }).__seen);
    // The automatic entry ran, and no waiting room was ever rendered: the frame holds the table until its MatchRecord
    // lookup settled (PLAN M8-P7: no waiting room is rendered).
    expect(seen).toContain('matched-entry');
    expect(seen.filter((x) => x === 'lobby' || x === 'waiting-room')).toEqual([]);
  }
  return rooms[0]!;
}

test.describe('quick match over a local lobby', () => {
  test('alone, a lapsed ring, then two accepts: one table, no waiting room, 7 cards each, saved', async ({ page }) => {
    test.setTimeout(120_000);
    const [a, b] = await openPages(page, 2, 'mm2');
    const deckA = deckRecord('deck-ann', 'Ann Selesnya', 'gw-m19-60.txt');
    const deckB = deckRecord('deck-ben', 'Ben Izzet', 'ur-m19-60.mtga.txt');

    let sinceA = 0;
    await test.step('A alone: seeking, the queue chip, and the alone status after 10 s', async () => {
      expect(await phase(a!)).toBe('off');
      await seek(a!, deckA);
      await expect.poll(() => phase(a!)).toBe('seeking');
      // Home shows the search on its primary (journey.md 4.1); every other page of the shell shows the queue bar
      // with the chip (4.5): A browses Decks meanwhile.
      await expect(a!.getByTestId('home-primary')).toContainText('SEARCHING');
      await a!.evaluate(() => (location.hash = '#/decks'));
      await expect(a!.getByTestId('queue-bar')).toBeVisible();
      await expect(a!.getByTestId('queue-chip')).toHaveAttribute('data-phase', 'seeking');
      expect((await status(a!)).alone).toBe(false);
      await tick(a!, 10_000);
      await expect.poll(async () => (await status(a!)).alone).toBe(true);
      await expect(a!.getByTestId('queue-chip-count')).toHaveText('ONLY YOU SO FAR');
      sinceA = (await status(a!)).since!;
    });

    await test.step('B seeks: both see the match-found card within 3 s', async () => {
      await seek(b!, deckB);
      await expect(a!.getByTestId('match-found')).toBeVisible({ timeout: 3_000 });
      await expect(b!.getByTestId('match-found')).toBeVisible({ timeout: 3_000 });
      expect(await a!.title()).toBe('Match found · Spellplane');
      expect(await a!.evaluate(() => window.__spellplane!.mm!.chimes!())).toBe(1);
    });

    await test.step('the ring lapses on B: A is back in seeking with its timer kept; B stopped and left the lobby', async () => {
      await a!.getByTestId('match-accept').click();
      await expect(a!.getByTestId('match-accept')).toHaveText(/^WAITING FOR .+…$/);
      await tick(b!, 20_000);
      await expect.poll(() => phase(b!)).toBe('off');
      await expect(b!.getByTestId('match-found')).toHaveCount(0);
      await expect(b!.getByTestId('toast')).toContainText('You missed the match. Search stopped.');
      await expect.poll(() => phase(a!), { timeout: 5_000 }).toBe('seeking');
      expect((await status(a!)).since).toBe(sinceA);
      await expect(a!.getByTestId('match-found')).toHaveCount(0);
    });

    let room = '';
    await test.step('B seeks again; A accepts by pointer, B by Enter: both enter the same room', async () => {
      await seek(b!, deckB);
      await expect(a!.getByTestId('match-found')).toBeVisible({ timeout: 3_000 });
      await expect(b!.getByTestId('match-found')).toBeVisible({ timeout: 3_000 });
      await a!.getByTestId('match-accept').click();
      await b!.keyboard.press('Enter');
      room = await expectSeated([a!, b!], 2);
    });

    await test.step('the game is in games and matches on both; the lobby is left', async () => {
      const code = room.split('/')[2]!;
      for (const [p, deck] of [
        [a!, deckA],
        [b!, deckB],
      ] as const) {
        await expect.poll(() => phase(p)).toBe('off');
        const matches = (await p.evaluate(() => window.__spellplane!.mm!.matches!())) as { roomId: string; deckId: string; state: string }[];
        expect(matches.find((m) => m.roomId === code)).toMatchObject({ deckId: deck.id });
        const games = (await p.evaluate(() => window.__spellplane!.games!.list())) as { code: string; kind: string }[];
        expect(games.find((g) => g.code === code)).toMatchObject({ kind: 'matched' });
      }
    });
  });

  test('ranked 1v1 ended by a concession: both ratings change once, by opposite amounts from the frozen record', async ({ page }) => {
    test.setTimeout(120_000);
    const [a, b] = await openPages(page, 2, 'mmr');
    const Q = '1v1.constructed.ranked';
    await test.step('both seek ranked 1v1 and accept', async () => {
      await seek(a!, deckRecord('deck-ann', 'Ann Selesnya', 'gw-m19-60.txt'), Q);
      await seek(b!, deckRecord('deck-ben', 'Ben Izzet', 'ur-m19-60.mtga.txt'), Q);
      await expect(a!.getByTestId('match-found-rating')).toHaveText(['1500', '1500'], { timeout: 3_000 });
      await a!.getByTestId('match-accept').click();
      await b!.getByTestId('match-accept').click();
      await expectSeated([a!, b!], 2);
    });
    await test.step('B concedes: A wins; each browser applies the change once', async () => {
      await b!.evaluate(() => window.__spellplane!.dispatch!({ type: 'concede' } as never));
      for (const p of [a!, b!]) await expect.poll(async () => (await state(p)).result?.reason).toBe('concede');
      const record = ((await a!.evaluate(() => window.__spellplane!.mm!.matches!())) as MatchRecord[])[0]!;
      // The winner's seat is A's (B conceded); its index in the frozen record picks the expected change.
      const st = await state(a!);
      const winnerPeer = st.seats[st.result!.winners[0]!]!.peer;
      const winner = record.players.findIndex((p) => p.peerId === winnerPeer) as 0 | 1;
      const expected = ratingChanges(record.players.map((p, i) => ({ rating: p.rating, games: p.games, band: p.band, side: i as 0 | 1 })), winner)!;
      const mineA = winner;
      const after = (p: Page) => p.evaluate(() => window.__spellplane!.mm!.rating!('1v1.constructed')) as Promise<{ rating: number; games: number } | null>;
      await expect.poll(async () => (await after(a!))?.rating, { timeout: 10_000 }).toBe(expected[mineA]!.after);
      await expect.poll(async () => (await after(b!))?.rating, { timeout: 10_000 }).toBe(expected[1 - mineA]!.after);
      const ra = (await after(a!))!;
      const rb = (await after(b!))!;
      expect(ra.rating - 1500).toBe(-(rb.rating - 1500));
      expect(ra.rating).toBeGreaterThan(1500);
      expect([ra.games, rb.games]).toEqual([1, 1]);
      const rated = ((await a!.evaluate(() => window.__spellplane!.mm!.matches!())) as MatchRecord[])[0]!.rated;
      expect(rated).toEqual({ key: '1v1.constructed', before: 1500, after: ra.rating });
    });
  });

  test('ranked 1v1: the loser reloads its table, then concedes; both browsers still apply the change once', async ({ page }) => {
    test.setTimeout(120_000);
    const [a, b] = await openPages(page, 2, 'mmrl');
    const Q = '1v1.constructed.ranked';
    const after = (p: Page) => p.evaluate(() => window.__spellplane!.mm!.rating!('1v1.constructed')) as Promise<{ rating: number; games: number } | null>;
    await test.step('both seek ranked 1v1, accept and are dealt', async () => {
      await seek(a!, deckRecord('deck-ann', 'Ann Selesnya', 'gw-m19-60.txt'), Q);
      await seek(b!, deckRecord('deck-ben', 'Ben Izzet', 'ur-m19-60.mtga.txt'), Q);
      await expect(a!.getByTestId('match-found')).toBeVisible({ timeout: 3_000 });
      await expect(b!.getByTestId('match-found')).toBeVisible({ timeout: 3_000 });
      await a!.getByTestId('match-accept').click();
      await b!.getByTestId('match-accept').click();
      await expectSeated([a!, b!], 2);
    });
    await test.step('B reloads: its table opens again at stage match, without the matched entry', async () => {
      await b!.reload();
      await expect(b!.getByTestId('table-frame')).toBeVisible({ timeout: 30_000 });
      await expect.poll(async () => (await state(b!)).stage, { timeout: 30_000 }).toBe('match');
      await expect.poll(async () => new Set(await Promise.all([a!, b!].map(async (p) => stateHash(await state(p))))).size, { timeout: 20_000 }).toBe(1);
    });
    await test.step('B concedes from the reloaded table: A wins, and both ratings change by opposite amounts', async () => {
      await b!.evaluate(() => window.__spellplane!.dispatch!({ type: 'concede' } as never));
      for (const p of [a!, b!]) await expect.poll(async () => (await state(p)).result?.reason).toBe('concede');
      const record = ((await a!.evaluate(() => window.__spellplane!.mm!.matches!())) as MatchRecord[])[0]!;
      const st = await state(a!);
      const winner = record.players.findIndex((p) => p.peerId === st.seats[st.result!.winners[0]!]!.peer) as 0 | 1;
      const expected = ratingChanges(record.players.map((p, i) => ({ rating: p.rating, games: p.games, band: p.band, side: i as 0 | 1 })), winner)!;
      await expect.poll(async () => (await after(a!))?.rating, { timeout: 10_000 }).toBe(expected[winner]!.after);
      await expect.poll(async () => (await after(b!))?.rating, { timeout: 10_000 }).toBe(expected[1 - winner]!.after);
      expect([(await after(a!))!.games, (await after(b!))!.games]).toEqual([1, 1]);
    });
  });

  test('a deck that cannot be read: the matched entry offers LEAVE; leaving voids the match and keeps it out of History', async ({ page }) => {
    test.setTimeout(120_000);
    const [a, b] = await openPages(page, 2, 'mmlv');
    let room = '';
    await test.step('A seeks with a deck id that is not in its library; both accept', async () => {
      await a!.evaluate(() => window.__spellplane!.mm!.seek({ queues: ['1v1.constructed.casual'], deckId: 'no-such-deck' }));
      await seek(b!, deckRecord('deck-ben', 'Ben Izzet', 'ur-m19-60.mtga.txt'));
      await expect(a!.getByTestId('match-found')).toBeVisible({ timeout: 3_000 });
      await expect(b!.getByTestId('match-found')).toBeVisible({ timeout: 3_000 });
      await a!.getByTestId('match-accept').click();
      await b!.getByTestId('match-accept').click();
      await expect.poll(() => a!.evaluate(() => location.hash), { timeout: 10_000 }).toMatch(/^#\/t\//);
      room = (await a!.evaluate(() => location.hash)).split('/')[2]!;
    });
    await test.step('A stays at the matched entry (nothing to commit) with a quiet LEAVE, and leaves by it', async () => {
      await expect(a!.getByTestId('matched-entry')).toBeVisible({ timeout: 30_000 });
      await expect(a!.getByTestId('matched-entry')).toHaveAttribute('data-stage', 'entering', { timeout: 30_000 });
      await a!.getByTestId('matched-entry-leave').click();
      await expect(a!.getByTestId('route-home')).toBeVisible({ timeout: 10_000 });
      await expect.poll(async () => ((await a!.evaluate(() => window.__spellplane!.mm!.matches!())) as MatchRecord[]).find((m) => m.roomId === room)?.state, { timeout: 10_000 }).toBe('void');
      await expect.poll(async () => ((await a!.evaluate(() => window.__spellplane!.games!.list())) as { code: string }[]).some((g) => g.code === room), { timeout: 10_000 }).toBe(false);
      await expect(a!.getByTestId('toast').filter({ hasText: 'your seat is kept' })).toHaveCount(0);
    });
  });

  test('B closes right after accepting: after 30 s A is off the room, back in the queue with its wait kept; the match is void', async ({ page }) => {
    test.setTimeout(120_000);
    const [a, b] = await openPages(page, 2, 'mmx');
    let sinceA = 0;
    let room = '';
    await test.step('both accept; B closes its page once A moves to the room', async () => {
      await seek(a!, deckRecord('deck-ann', 'Ann Selesnya', 'gw-m19-60.txt'));
      await expect.poll(() => phase(a!)).toBe('seeking');
      sinceA = (await status(a!)).since!;
      await seek(b!, deckRecord('deck-ben', 'Ben Izzet', 'ur-m19-60.mtga.txt'));
      await expect(a!.getByTestId('match-found')).toBeVisible({ timeout: 3_000 });
      await expect(b!.getByTestId('match-found')).toBeVisible({ timeout: 3_000 });
      await a!.getByTestId('match-accept').click();
      await b!.getByTestId('match-accept').click();
      await expect.poll(() => phase(a!), { timeout: 5_000 }).toBe('moving');
      room = (await status(a!)).link!.roomId;
      await b!.close();
      await expect.poll(() => a!.evaluate(() => location.hash), { timeout: 10_000 }).toContain(`#/t/${room}/`);
    });
    await test.step('the arrival deadline on the matchmaker clock: off the room route, the notice with SEARCH AGAIN', async () => {
      await tick(a!, 29_000);
      expect(await phase(a!)).toBe('moving');
      await tick(a!, 1_500);
      await expect.poll(() => a!.evaluate(() => location.hash), { timeout: 10_000 }).not.toContain(room);
      await expect(a!.getByTestId('toast')).toContainText('could not be reached directly', { timeout: 10_000 });
      await expect(a!.getByTestId('toast').getByRole('button', { name: 'SEARCH AGAIN' })).toBeVisible();
      await expect.poll(() => phase(a!), { timeout: 10_000 }).toBe('seeking');
      expect((await status(a!)).since).toBe(sinceA);
      await expect.poll(async () => ((await a!.evaluate(() => window.__spellplane!.mm!.matches!())) as MatchRecord[]).find((m) => m.roomId === room)?.state).toBe('void');
    });
  });

  test('four pages form one ffa4 match: four distinct seats, one room for all', async ({ page }) => {
    test.setTimeout(120_000);
    const pages = await openPages(page, 4, 'mm4');
    const files = ['gw-m19-60.txt', 'ur-m19-60.mtga.txt', 'gw-m19-60.txt', 'ur-m19-60.mtga.txt'];
    await test.step('four seekers in 4 FREE-FOR-ALL: each sees the card with four seats, each accepts', async () => {
      for (const [i, p] of pages.entries()) await seek(p, deckRecord(`deck-${i}`, `Deck ${i}`, files[i]!), 'ffa4.constructed.casual');
      for (const p of pages) await expect(p.getByTestId('match-found')).toBeVisible({ timeout: 5_000 });
      for (const p of pages) await expect(p.getByTestId('match-found-seat')).toHaveCount(4);
      for (const p of pages) await p.getByTestId('match-accept').click();
    });
    await test.step('every page moves to the same room with the same plan of four distinct seats', async () => {
      const ROOM = /^#\/t\/[a-z]+-[a-z]+-[a-z]+-\d+\/[A-Za-z0-9_-]{22}$/;
      for (const p of pages) await expect.poll(() => p.evaluate(() => location.hash), { timeout: 10_000 }).toMatch(ROOM);
      expect(new Set(await Promise.all(pages.map((p) => p.evaluate(() => location.hash)))).size).toBe(1);
      const records = await Promise.all(pages.map(async (p) => ((await p.evaluate(() => window.__spellplane!.mm!.matches!())) as { queue: string; players: { peerId: string }[] }[])[0]!));
      for (const r of records) expect(r.queue).toBe('ffa4.constructed.casual');
      const seats = records.map((r) => r.players.map((x) => x.peerId).join(','));
      expect(new Set(seats).size).toBe(1);
      expect(new Set(records[0]!.players.map((x) => x.peerId)).size).toBe(4);
    });
  });

  // The table opens in the queue's format: main.ts's openRoom passes `format` from the MatchRecord to openNetSession
  // (matchSessionInternals in src/session/match-room.ts; the seam, fixed by the M8 gate round).
  test('four pages at one ffa4 table: four seats, 7 cards each, equal hashes', async ({ page }) => {
    test.setTimeout(150_000);
    const pages = await openPages(page, 4, 'mm4t');
    const files = ['gw-m19-60.txt', 'ur-m19-60.mtga.txt', 'gw-m19-60.txt', 'ur-m19-60.mtga.txt'];
    for (const [i, p] of pages.entries()) await seek(p, deckRecord(`deck-${i}`, `Deck ${i}`, files[i]!), 'ffa4.constructed.casual');
    for (const p of pages) await expect(p.getByTestId('match-found')).toBeVisible({ timeout: 5_000 });
    for (const p of pages) await p.getByTestId('match-accept').click();
    await expectSeated(pages, 4);
    const st = await state(pages[0]!);
    expect(new Set(Object.values(st.seats).map((s) => s.peer)).size).toBe(4);
    expect(st.format).toBe('ffa4');
  });
});
