/**
 * PLAN M2-P7 acceptance in the browser: "A reload in each stage returns to that stage with the same pool, deck and
 * table" (DESIGN "Pre-game: draft, sealed and deck building": an evening moves through lobby, draft, deck building and
 * match on one link; "Specification: card data, packs and draft formats", Evening stages). Two pages on
 * `?transport=local` (BroadcastChannel; distinct `?profile=`, so distinct key pairs and IndexedDBs) run the real app
 * path: the lobby settings panel, the draft start, the draft HUD, the builder with its Ready, the table HUD, the
 * evening bar's "Next game" answered in the HUD's confirmation prompt, and "New draft" from the builder answered in
 * the evening bar. Each page reloads in each stage; the stage, the own pool, the deck being built, the hand and the
 * table (all but the sequence number and away marks) come back as they were. Card data and booster data come from
 * tests/fixtures; card faces are placeholders.
 */
import { expect, test, type Page, type TestInfo } from '@playwright/test';
import type { DeckBuild, SecretStore, Stage, TableState } from '../../../src/core/types';
import type { DraftPrivateView } from '../../../src/draft/types';
import { hook, shot } from '../helpers/app';
import { freshProfile, freshRoom, open, twoPages } from '../lobby/helpers';
import { setsScript } from './helpers';

type Room = { roomId: string; roomKey: string };

const state = (page: Page) => hook<TableState>(page, 'state');
const secrets = (page: Page) => hook<SecretStore>(page, 'secrets');
const view = (page: Page) => hook<DraftPrivateView | null>(page, 'draft.view');
const build = (page: Page) => hook<DeckBuild | null>(page, 'draft.build');
/** The deck as a build holds it (the builder table may add card positions of its own). */
const deckOf = (b: DeckBuild | null) => (b === null ? null : { cards: b.cards, main: b.main });
const saved = (page: Page) => page.evaluate(() => window.__spellplane!.session!.saved());

/** The table a reload must keep: everything but the sequence number and the away marks. */
function tableOf(st: TableState): unknown {
  const seats = Object.fromEntries(
    Object.entries(st.seats).map(([id, s]) => {
      const { away: _away, ...rest } = s;
      return [id, rest];
    }),
  );
  return { ...st, seq: 0, seats };
}

/** What a reload must keep of the own private state. */
async function mine(page: Page): Promise<unknown> {
  const s = await secrets(page);
  return { pool: s.pool ?? null, draft: s.draft ?? null, build: s.build ?? null, hand: s.hand, library: s.libraryOrder, ids: [...s.hand, ...s.libraryOrder].map((id) => s.identities[id] ?? null) };
}

async function openRoom(page: Page, room: Room, profile: string): Promise<void> {
  await page.addInitScript({ content: setsScript() });
  await open(page, `/t/${room.roomId}/${room.roomKey}`, { profile, transport: 'local' });
}

const STAGE_VIEW: Record<Stage, string> = { lobby: 'lobby', draft: 'draft', build: 'builder', match: 'hud' };

async function inStage(page: Page, stage: Stage): Promise<void> {
  await expect(page.getByTestId('stage')).toHaveAttribute('data-stage', stage, { timeout: 30_000 });
  await expect(page.getByTestId(STAGE_VIEW[stage])).toBeVisible({ timeout: 30_000 });
}

/** Both pages have applied the same table, with nothing pending and nobody away. */
async function settled(a: Page, b: Page): Promise<void> {
  await expect
    .poll(
      async () => {
        const [sa, sb] = await Promise.all([state(a), state(b)]);
        if (Object.values(sa.seats).some((s) => s.away) || Object.values(sb.seats).some((s) => s.away)) return 'away';
        return sa.seq === sb.seq && JSON.stringify(tableOf(sa)) === JSON.stringify(tableOf(sb)) ? 'same' : `${sa.seq} != ${sb.seq}`;
      },
      { timeout: 30_000 },
    )
    .toBe('same');
}

/** Reload `page` in its stage; the stage, the table and the own private state come back. */
async function reloadKeeps(page: Page, other: Page, stage: Stage): Promise<void> {
  await settled(page, other);
  const before = { table: tableOf(await state(page)), mine: await mine(page), seat: await hook<string>(page, 'session.seat') };
  await saved(page);
  await page.reload();
  await inStage(page, stage);
  await expect.poll(() => hook<string>(page, 'net.status'), { timeout: 20_000 }).toBe('connected');
  await settled(page, other);
  expect(await hook<string>(page, 'session.seat')).toBe(before.seat);
  expect(tableOf(await state(page))).toEqual(before.table);
  expect(await mine(page)).toEqual(before.mine);
}

/** One pick wherever a pack is in front of the page's seat; true when it picked. */
async function pickOne(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const sp = window.__spellplane!;
    const v = sp.draft!.view();
    if (!v || !v.pack || v.pack.cards.length === 0 || v.picks === 0) return false;
    const ids = v.pack.cards.slice(0, v.picks).map((c) => c.id);
    sp.flow!.mark(ids);
    return sp.flow!.pick(ids);
  });
}

test('a reload in each stage returns to that stage with the same pool, deck and table', async ({ browser }, info: TestInfo) => {
  test.setTimeout(300_000);
  const { context, a, b } = await twoPages(browser);
  const room = freshRoom();
  await openRoom(a, room, freshProfile(info, 'a'));
  await inStage(a, 'lobby');
  await openRoom(b, room, freshProfile(info, 'b'));
  await inStage(b, 'lobby');
  for (const p of [a, b]) await expect.poll(() => hook<string>(p, 'net.status'), { timeout: 15_000 }).toBe('connected');
  await expect.poll(() => hook<string>(b, 'session.seat')).toBe('s1');

  // Lobby: the host (Anna, s0) chooses a booster draft of one pack each; Ben sees it read-only.
  await expect(a.getByTestId('lobby-settings')).toHaveAttribute('data-editable', 'true');
  await expect(b.getByTestId('lobby-settings')).toHaveAttribute('data-editable', 'false');
  await a.getByTestId('lobby-mode').selectOption('booster');
  await a.getByTestId('lobby-packs').fill('1');
  await a.getByTestId('lobby-packs').blur();
  await expect.poll(async () => (await state(b)).lobby?.draft).toEqual({ format: 'pass', packs: 1, picks: 1 });
  await expect(b.getByTestId('start-draft')).toHaveCount(0);
  await expect(b.getByTestId('draft-start-blocked')).toContainText('to start');
  await shot(a, 'M2', 'flow-lobby', info.project.name);
  await reloadKeeps(b, a, 'lobby');
  await expect(b.getByTestId('lobby-packs')).toHaveValue('1');

  // Draft: one press starts it for everyone at once.
  await a.getByTestId('start-draft').click();
  await inStage(a, 'draft');
  await inStage(b, 'draft');
  await expect.poll(async () => (await view(b))?.pack?.cards.length ?? 0, { timeout: 30_000 }).toBeGreaterThan(0);
  for (let i = 0; i < 4; i++) {
    await expect.poll(() => pickOne(a), { timeout: 15_000 }).toBe(true);
    await expect.poll(() => pickOne(b), { timeout: 15_000 }).toBe(true);
  }
  // A pick returns once it is proposed; Ben's pool grows when Anna's sequencer has applied it (decision M2-G), and only
  // then is the pack in front of him the next one.
  await expect.poll(async () => (await secrets(b)).pool?.length ?? 0, { timeout: 15_000 }).toBeGreaterThanOrEqual(4);
  await expect.poll(async () => (await view(b))?.pack?.cards.length ?? 0, { timeout: 15_000 }).toBeGreaterThan(1);
  const front = (await view(b))!.pack!.cards.map((c) => c.id);
  await b.evaluate((id) => window.__spellplane!.flow!.mark([id]), front[1]!);
  const poolBefore = (await secrets(b)).pool;
  await reloadKeeps(b, a, 'draft');
  const after = (await view(b))!;
  expect(after.pack!.cards.map((c) => c.id)).toEqual(front);
  expect(after.marked).toEqual([front[1]!]);
  expect(after.pool).toEqual(poolBefore);
  await shot(b, 'M2', 'flow-draft-after-reload', info.project.name);
  // The draft runs to its end and moves everyone to the builder on its own.
  await expect
    .poll(
      async () => {
        await pickOne(a);
        await pickOne(b);
        return [(await state(a)).stage, (await state(b)).stage].join();
      },
      { timeout: 120_000, intervals: [100] },
    )
    .toBe('build,build');
  await inStage(a, 'build');
  await inStage(b, 'build');
  for (const p of [a, b]) expect((await secrets(p)).pool).toHaveLength(15);

  // Build: each takes the first 12 cards into the deck; a reload keeps the deck being built.
  const builds: DeckBuild[] = [];
  for (const p of [a, b]) {
    const fresh = (await build(p))!;
    expect(fresh.cards).toHaveLength(15);
    const next: DeckBuild = { ...fresh, main: fresh.cards.slice(0, 12).map((c) => c.id) };
    await p.evaluate((bd) => window.__spellplane!.flow!.setBuild(bd), next);
    builds.push(next);
  }
  await reloadKeeps(a, b, 'build');
  await reloadKeeps(b, a, 'build');
  for (const [i, p] of [a, b].entries()) expect(deckOf(await build(p))).toEqual(deckOf(builds[i]!));
  await shot(a, 'M2', 'flow-builder-after-reload', info.project.name);

  // Match: everyone Ready moves the table on.
  await a.getByTestId('builder-ready').click();
  await expect(a.getByTestId('evening-status')).toContainText('Waiting for');
  await b.getByTestId('builder-ready').click();
  await inStage(a, 'match');
  await inStage(b, 'match');
  expect((await state(a)).games).toBe(1);
  await Promise.all([a.evaluate(() => window.__spellplane!.session!.shuffle()), b.evaluate(() => window.__spellplane!.session!.shuffle())]);
  await a.evaluate(() => window.__spellplane!.session!.draw(7));
  await b.evaluate(() => window.__spellplane!.session!.draw(7));
  await reloadKeeps(a, b, 'match');
  expect((await secrets(a)).hand).toHaveLength(7);
  await expect.poll(() => a.getByTestId('hand-card').count()).toBe(7);

  // Next game: Anna proposes from the evening bar, Ben confirms in the HUD's prompt; both are back in the builder
  // with the decks they had, the game table cleared.
  await a.getByTestId('propose-nextGame').click();
  await expect(b.getByTestId('confirm-prompt')).toBeVisible({ timeout: 15_000 });
  await shot(b, 'M2', 'flow-next-game-prompt', info.project.name);
  await b.getByTestId('prompt-ok').click();
  await inStage(a, 'build');
  await inStage(b, 'build');
  const cleared = await state(b);
  expect(cleared.cards).toEqual({});
  expect(cleared.commitments).toEqual({});
  for (const [i, p] of [a, b].entries()) expect(deckOf(await build(p))).toEqual(deckOf(builds[i]!));

  // A new draft from the builder: Ben proposes, Anna answers OK in the evening bar; back to the lobby, nothing kept.
  await b.getByTestId('propose-newDraft').click();
  await expect(a.getByTestId('evening-ok')).toBeVisible({ timeout: 15_000 });
  await a.getByTestId('evening-ok').click();
  await inStage(a, 'lobby');
  await inStage(b, 'lobby');
  expect('draft' in (await state(a))).toBe(false);
  await expect.poll(async () => ((await secrets(a)).build ?? null) === null && ((await secrets(a)).pool ?? null) === null).toBe(true);
  await expect(a.getByTestId('start-draft')).toBeVisible();
  await context.close();
});

/** Two seated pages at a fresh table in the lobby; Anna (s0) hosts. */
async function seatedPages(browser: Parameters<typeof twoPages>[0], info: TestInfo) {
  const { context, a, b } = await twoPages(browser);
  const room = freshRoom();
  await openRoom(a, room, freshProfile(info, 'a'));
  await inStage(a, 'lobby');
  await openRoom(b, room, freshProfile(info, 'b'));
  await inStage(b, 'lobby');
  for (const p of [a, b]) await expect.poll(() => hook<string>(p, 'net.status'), { timeout: 15_000 }).toBe('connected');
  await expect.poll(() => hook<string>(b, 'session.seat')).toBe('s1');
  return { context, a, b };
}

test('sealed: the pools open for everyone at once; the builder searches the card data and a reload keeps the added card', async ({ browser }, info: TestInfo) => {
  test.setTimeout(180_000);
  const { context, a, b } = await seatedPages(browser, info);
  await a.getByTestId('lobby-mode').selectOption('sealed');
  await a.getByTestId('lobby-packs').fill('1');
  await a.getByTestId('lobby-packs').blur();
  await expect.poll(async () => (await state(b)).lobby?.draft).toEqual({ format: 'sealed', packs: 1 });
  await expect(a.getByTestId('start-draft')).toHaveText('Open the sealed pools');
  await a.getByTestId('start-draft').click();
  await inStage(a, 'build');
  await inStage(b, 'build');
  for (const p of [a, b]) expect((await secrets(p)).pool).toHaveLength(15);

  // Search-and-add in the list view, over the app's card data.
  await b.getByTestId('view-list').click();
  await expect(b.getByTestId('builder-list')).toBeVisible();
  await b.getByTestId('list-search-query').fill('Shivan Dragon');
  await b.getByTestId('list-search-go').click();
  const result = b.getByTestId('list-search-result').first();
  await expect(result).toContainText('Shivan Dragon');
  const sid = await result.getAttribute('data-sid');
  await result.getByTestId('list-search-add-deck').click();
  await expect.poll(async () => {
    const bd = await build(b);
    return bd ? bd.main.map((id) => bd.cards.find((c) => c.id === id)?.ref.sid) : [];
  }).toEqual([sid]);
  await reloadKeeps(b, a, 'build');
  const kept = (await build(b))!;
  expect(kept.main.map((id) => kept.cards.find((c) => c.id === id)!.ref.sid)).toEqual([sid]);
  expect(kept.cards).toHaveLength(16);
  await context.close();
});

test('Winston: the piles reach only the player looking at them, through the session, until the builder', async ({ browser }, info: TestInfo) => {
  test.setTimeout(180_000);
  const { context, a, b } = await seatedPages(browser, info);
  await a.getByTestId('lobby-mode').selectOption('winston');
  await a.getByTestId('lobby-packs').fill('1');
  await a.getByTestId('lobby-packs').blur();
  await expect.poll(async () => (await state(b)).lobby?.draft).toEqual({ format: 'winston', packs: 1 });
  // Winston has no pick timer to offer.
  await expect(a.getByTestId('lobby-pick-timer')).toHaveCount(0);
  await a.getByTestId('start-draft').click();
  await inStage(a, 'draft');
  await inStage(b, 'draft');
  // Each takes the pile it looks at; Ben, who does not deal, sees a pile only on his turn.
  let benSawAPile = false;
  await expect
    .poll(
      async () => {
        for (const p of [a, b]) {
          const v = await view(p);
          if (v?.pile && v.pile.length > 0) {
            if (p === b) benSawAPile = true;
            await p.evaluate(() => window.__spellplane!.flow!.pileLook(true));
          }
        }
        return [(await state(a)).stage, (await state(b)).stage].join();
      },
      { timeout: 120_000, intervals: [200] },
    )
    .toBe('build,build');
  expect(benSawAPile).toBe(true);
  const st = await state(a);
  for (const [p, seat] of [
    [a, 's0'],
    [b, 's1'],
  ] as const) {
    await expect.poll(async () => (await secrets(p)).pool?.length ?? 0, { timeout: 20_000 }).toBe(st.draft!.pools[seat]);
  }
  expect(st.draft!.pools.s0! + st.draft!.pools.s1!).toBe(15);
  await context.close();
});
