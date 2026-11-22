/**
 * Gate M8-G (docs/PLAN.md, Milestone 8, "Gate M8-G"): the owner's walk through the journey, in one file, with the
 * screenshots. Chromium and WebKit, `?transport=local&faces=placeholder`, fixtures only (tests/fixtures), at most four
 * pages per test, each long test split into `test.step`s, product timers driven by the clock hooks
 * (`page.clock`, `mm.tick`, `bot.setClock('manual')`, `net.setClock`), screenshots to `artifacts/shots/M8/`
 * (`pnpm shots -- M8`). The helpers are M8-P8's journey helpers (tests/e2e/helpers/journey.ts).
 *
 * 1. Landing to a first game: Home, not a table; Decks → NEW DECK → CUSTOM DECK → a simple deck from the fixture search
 *    with lands added by the helper (curve and strength shown) → PLAY on its tile → Home with the deck as hero.
 * 2. Against the computer: SOLO · SPARRING → PLAY → seven cards, the log closed, no dialog, no key pressed; the turn
 *    goes to Sparring by the HUD's primary and Sparring plays; leave by the arrow → Home with CONTINUE → History lists
 *    the game first → open it: the same state hash, Sparring goes on. After each table visit every count is 0 on Home.
 * 3. Private game: two profiles, CREATE TABLE, the invite link, both READY, the self-pressing start, versus, seven
 *    cards each; one concedes; the overlay; HOME.
 * 4. Matchmaking: two profiles search 1v1 (one browses Decks with the queue bar), match found, both accept, the table
 *    without a waiting room; then four profiles form a 4 FFA match with four distinct seats.
 * 5. Sealed means sealed: six fixture boosters on a pinned seed, a locked booster deck with 40 cards; a card from
 *    outside the pool is refused in the UI (no search, no +) and through the debug hook (notInPool); CONVERT TO CUSTOM
 *    DECK makes a copy that takes it (by the search); the original is byte-equal.
 * 6. Draft night: three closed boosters with the fixture set code and no deck; OPEN DRAFT TABLE opens a waiting room
 *    whose lobby settings equal the booster setup.
 * 7. Leave and rejoin, the copy with more moves wins: three profiles in a 4 FFA created from Home (START WITH 3
 *    PLAYERS), played to turn 3 by the HUD's primary; Cy, then Ann leave by the arrow, Ben plays on and leaves; Ann
 *    returns from History (Gathering waits for Ben) and writes four chat lines; Ben returns from History: both are live
 *    on Ben's copy (more moves, fewer sequence numbers); Cy's browser is replaced by a blank profile, Ann opens Cy's
 *    plate menu, BRING CY BACK, the link opens in the blank profile, Cy sits down and recovers (a new hand of 7);
 *    three equal state hashes; History lists the game first on each page; the leak scanner over all three is clean.
 * 8. Design audit and axe on Home, Decks, the deck page, History, the waiting room and the table HUD (Gathering is
 *    audited in 7, where it is on screen).
 *
 * Engine behaviour is asserted on state hashes and the debug hook, never on pixels; screenshots are evidence.
 */
import { expect, test, type Page, type TestInfo } from '@playwright/test';
import type { SecretStore, TableState } from '../../src/core/types';
import { scan } from '../leak/scan';
import { seriousViolations } from './a11y/helpers';
import { hook, shot } from './helpers/app';
import { designAudit, settleAnimations } from './helpers/design-audit';
import {
  atTable,
  copied,
  countOf,
  deckGet,
  deckList,
  decklist,
  freshProfile,
  gamesOf,
  hands,
  homeIsClean,
  keydowns,
  leaveByArrow,
  mode,
  navTo,
  openSite,
  pages,
  readyWith,
  sameHash,
  seedDeck,
  soloOpponent,
  state,
  tableHash,
} from './helpers/journey';

const MS = 'M8';
const SEED = '00112233445566778899aabbccddeeff';

/** A profile no other test or earlier run uses (the gate's own prefix). */
const profile = (info: TestInfo, who: string): string => freshProfile(info, `g8-${who}`);
const secrets = (p: Page) => hook<SecretStore>(p, 'secrets');
const seatOf = (p: Page) => p.evaluate(() => window.__spellplane?.session?.seat() ?? '');
const plate = (p: Page, seat: string) => p.locator(`[data-testid="avatar"][data-seat="${seat}"]`);
const live = (p: Page) => p.evaluate(() => window.__spellplane?.session?.muster?.().live ?? false);
/** The HUD's one primary button of `p`, pressed when it may be (its label follows the moment). */
async function pressPrimary(p: Page): Promise<void> {
  const primary = p.getByTestId('primary-action');
  if ((await primary.isVisible().catch(() => false)) && (await primary.getAttribute('aria-disabled').catch(() => 'true')) !== 'true') await primary.click({ timeout: 2_000 }).catch(() => undefined);
}

/**
 * A screenshot as gate evidence, taken once the screen has settled: route cross-fades, sheets and the table's entry
 * cover end first (screenshots are evidence of the screen, not of a transition).
 */
async function snap(p: Page, name: string, project: string): Promise<void> {
  await settleAnimations(p, 4_000);
  try {
    await expect(p.locator('[data-testid="frame-cover"]:visible')).toHaveCount(0, { timeout: 10_000 });
  } catch {
    // Evidence only: a cover still showing is what the screenshot then shows.
  }
  await settleAnimations(p, 2_000);
  await shot(p, MS, name, project);
}

/**
 * The rules panel in the waiting room's side column, scrolled into view for a screenshot (gate M8 round 4, F5: the Mode
 * select's short label was below the fold in 07 and 15). Its chosen label fits inside the pill, and the pill inside
 * the panel; afterwards the column scrolls back, so the next screenshot shows the room as before.
 */
async function snapRules(p: Page, name: string, project: string): Promise<void> {
  const rules = p.getByTestId('lobby-settings');
  await rules.scrollIntoViewIfNeeded();
  const modeSelect = rules.getByTestId('lobby-mode');
  await expect(modeSelect).toBeInViewport();
  const fit = await modeSelect.evaluate((el) => {
    const select = el as HTMLSelectElement;
    const card = select.closest('[data-testid="lobby-settings"]')!.getBoundingClientRect();
    const box = select.getBoundingClientRect();
    const cs = getComputedStyle(select);
    const ctx = document.createElement('canvas').getContext('2d')!;
    ctx.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
    const text = select.selectedOptions[0]?.text ?? '';
    const room = select.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    return { text, inside: box.left >= card.left - 0.5 && box.right <= card.right + 0.5, fits: ctx.measureText(text).width <= room + 0.5 };
  });
  expect(fit).toEqual({ text: fit.text, inside: true, fits: true });
  await snap(p, name, project);
  await rules.evaluate((el) => {
    for (let n = el.parentElement; n; n = n.parentElement) if (n.scrollTop > 0) n.scrollTop = 0;
  });
}

/** Build a small custom deck through the deck page: four searches, then the land helper. Returns its id. */
async function buildCustomDeck(p: Page, project: string): Promise<string> {
  await p.getByTestId('new-deck').first().click();
  await expect(p.getByTestId('new-deck-chooser')).toBeVisible();
  await snap(p, '02a-new-deck-chooser', project);
  await p.getByTestId('new-custom').click();
  await expect(p.getByTestId('card-search')).toBeVisible();
  const id = decodeURIComponent((await p.evaluate(() => location.hash)).replace('#/decks/', ''));
  for (const [query, name] of [
    ['elves', 'Llanowar Elves'],
    ['druid', 'Druid of the Cowl'],
    ['oakenform', 'Oakenform'],
    ['titanic', 'Titanic Growth'],
  ] as const) {
    await p.getByTestId('card-search').fill(query);
    const card = p.locator(`[data-testid="result-card"][data-name="${name}"]`);
    await expect(card).toBeVisible();
    for (let i = 0; i < 4; i++) await card.click();
  }
  const add = p.getByTestId('add-lands');
  await expect(add).toBeVisible();
  await add.click();
  await expect(p.getByTestId('land-note')).toHaveCount(0);
  await expect(p.getByTestId('curve-text')).toHaveText(/^Mana curve: /);
  await expect(p.getByTestId('deck-strength')).toBeVisible();
  await expect.poll(async () => (await deckGet(p, id))?.main.length ?? 0).toBeGreaterThan(16);
  return id;
}

/** Every value of every object store of a profile's database (what that browser keeps). */
function idbDump(p: Page, who: string): Promise<unknown[]> {
  return p.evaluate(async (name) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const r = indexedDB.open(name);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error ?? new Error('open'));
    });
    try {
      const out: unknown[] = [];
      for (const s of Array.from(db.objectStoreNames)) {
        out.push(
          await new Promise<unknown[]>((resolve, reject) => {
            const r = db.transaction(s, 'readonly').objectStore(s).getAll();
            r.onsuccess = () => resolve(r.result as unknown[]);
            r.onerror = () => reject(r.error ?? new Error('getAll'));
          }),
        );
      }
      return JSON.parse(JSON.stringify(out)) as unknown[];
    } finally {
      db.close();
    }
  }, `spellplane-${who}`);
}

// --------------------------------------------------------------------------------------------------------------------
test.describe('@gate M8-G', () => {
  test('1 and 2: landing to a first game, then Sparring, leave, CONTINUE, History and back', async ({ page }, info) => {
    test.setTimeout(180_000);
    const project = info.project.name;
    const who = profile(info, 'solo');
    let deckId = '';
    await test.step('a fresh profile opens the site: Home, not a table', async () => {
      await openSite(page, who);
      await expect(page.getByTestId('route-home')).toBeVisible();
      await expect(page.locator('canvas')).toHaveCount(0);
      await expect(page.getByTestId('shell-nav')).toBeVisible();
      await homeIsClean(page);
      await snap(page, '01-home-first-run', project);
    }, { timeout: 30_000 });
    await test.step('Decks → NEW DECK → CUSTOM DECK: a simple deck from the search, lands by the helper', async () => {
      await navTo(page, 'DECKS');
      await expect(page.getByTestId('deck-library')).toBeVisible();
      deckId = await buildCustomDeck(page, project);
      await snap(page, '02-deck-page', project);
      await page.getByTestId('deck-done').click();
      await expect(page.getByTestId('deck-library')).toBeVisible();
      await snap(page, '02b-decks-library', project);
    }, { timeout: 45_000 });
    await test.step('PLAY on its tile: Home with the deck as hero', async () => {
      const tile = page.locator(`[data-testid="deck-tile"][data-deck-id="${deckId}"]`);
      await tile.hover();
      await tile.getByTestId('tile-play').click();
      await expect(page.getByTestId('route-home')).toBeVisible();
      const name = (await deckGet(page, deckId))!.name;
      await expect(page.getByTestId('hero-name')).toHaveText(name);
      await expect(page.getByTestId('hero-curve')).toBeVisible();
      await snap(page, '03-home-hero', project);
    }, { timeout: 20_000 });

    let room = '';
    let hash = '';
    await test.step('SOLO · SPARRING → PLAY: seven cards, the log closed, no dialog, no key pressed', async () => {
      await soloOpponent(page, 'SPARRING');
      await expect(page.getByTestId('home-primary')).toHaveText(/PLAY/);
      await page.getByTestId('home-primary').click();
      await atTable(page, 'computer');
      room = (await page.evaluate(() => location.hash)).replace(/^#\/c\//, '');
      await expect.poll(() => page.evaluate(() => typeof window.__spellplane?.bot?.setClock === 'function')).toBe(true);
      await page.evaluate(() => window.__spellplane!.bot!.setClock('manual'));
      await expect.poll(() => page.evaluate(() => window.__spellplane!.bot!.view()?.hand.length ?? -1), { timeout: 30_000 }).toBe(7);
      await expect.poll(() => page.evaluate(() => window.__spellplane!.bot!.view()?.oppHand ?? -1)).toBe(7);
      await expect(page.locator('[data-testid="log"][data-open="true"]')).toHaveCount(0);
      await expect(page.locator('[role="dialog"]:visible')).toHaveCount(0);
      // No key pressed on the way (debug.input counts every keydown since the page loaded; fill() sends none).
      expect(await keydowns(page)).toBe(0);
      await snap(page, '04-sparring-table', project);
    }, { timeout: 45_000 });
    await test.step('the turn goes to Sparring by the HUD primary; Sparring plays', async () => {
      // Ten own actions that change nothing in the end (a solo game left after fewer is not kept), by the plate's
      // buttons; then the turn goes to Sparring by the one primary button and its manual clock runs.
      const own = plate(page, 's0');
      for (let i = 0; i < 5; i++) {
        await own.getByTestId('life-minus').click();
        await own.getByTestId('life-plus').click();
      }
      const before = await page.evaluate(() => window.__spellplane!.bot!.steps());
      await expect
        .poll(async () => {
          const active = (await state(page)).turn.active;
          if (active === 's0') await pressPrimary(page);
          return active;
        }, { timeout: 20_000 })
        .toBe('s1');
      expect(await keydowns(page)).toBe(0);
      await expect
        .poll(async () => {
          await page.evaluate(() => window.__spellplane!.bot!.tick(5_000));
          return page.evaluate(() => window.__spellplane!.bot!.steps());
        }, { timeout: 20_000 })
        .toBeGreaterThan(before);
    }, { timeout: 45_000 });
    await test.step('leave by the arrow: Home with the CONTINUE strip; every count 0', async () => {
      hash = await tableHash(page);
      await leaveByArrow(page);
      await expect(page.getByTestId('toast').first()).toContainText('Game saved. Continue any time.');
      await expect(page.getByTestId('home-continue')).toBeVisible();
      await homeIsClean(page);
      await snap(page, '05-home-continue', project);
    }, { timeout: 30_000 });
    await test.step('History lists the game first; open it: the same state hash, Sparring goes on', async () => {
      await navTo(page, 'HISTORY');
      const rows = page.getByTestId('history-row');
      await expect(rows.first()).toHaveAttribute('data-code', room);
      expect((await gamesOf(page))[0]?.code).toBe(room);
      await snap(page, '06-history', project);
      await rows.first().click();
      await atTable(page, 'computer');
      await expect.poll(() => page.evaluate(() => window.__spellplane?.session?.hash() ?? '')).toBe(hash);
      await expect.poll(() => page.evaluate(() => window.__spellplane!.bot!.active())).toBe(true);
    }, { timeout: 45_000 });
    await test.step('leave again: every count 0 on Home', async () => {
      await leaveByArrow(page);
      await homeIsClean(page);
    }, { timeout: 30_000 });
  });

  test('3: a private game from CREATE TABLE to HOME', async ({ browser }, info) => {
    test.setTimeout(180_000);
    const project = info.project.name;
    const { context, list } = await pages(browser, 2);
    const [a, b] = list as [Page, Page];
    try {
      await a.clock.install();
      let link = '';
      await test.step('Ann: PRIVATE GAME → CREATE TABLE: the waiting room with the invite sheet', async () => {
        await openSite(a, profile(info, 'a'));
        await seedDeck(a, 'gw-m19-60.txt');
        await mode(a, 'private');
        await expect(a.getByTestId('home-primary')).toHaveText('CREATE TABLE');
        await a.getByTestId('home-primary').click();
        await expect(a.getByTestId('invite-sheet')).toBeVisible({ timeout: 20_000 });
        link = await a.getByTestId('share-link').inputValue();
        await a.getByTestId('copy-link').click();
        expect(await copied(a)).toEqual([link]);
        expect((await state(a)).settings.autoSetup).toBe(true);
        await snap(a, '07-waiting-room', project);
        await snapRules(a, '07c-rules-panel', project);
      }, { timeout: 45_000 });
      await test.step('Ben opens the invite link; both READY', async () => {
        await openSite(b, profile(info, 'b'), link.slice(link.indexOf('#') + 1));
        await expect(b.locator('[data-testid="chair"][data-seat="s1"]')).toHaveAttribute('data-mine', 'true', { timeout: 20_000 });
        // Ben has no deck of his own: he pastes his list; Ann brings the deck Home had selected.
        await readyWith(b, 'ur-m19-60.mtga.txt');
        await readyWith(a, 'gw-m19-60.txt');
      }, { timeout: 45_000 });
      await test.step('the start presses itself; versus; seven cards each', async () => {
        await expect(a.getByTestId('start-game')).toHaveText(/^START · [123]$/, { timeout: 15_000 });
        await snap(a, '07b-start-counting', project);
        await a.clock.runFor(3_100);
        for (const p of [a, b]) await expect(p.getByTestId('stage')).toHaveAttribute('data-stage', 'match', { timeout: 20_000 });
        await expect.poll(() => hands(b, ['s0', 's1']), { timeout: 30_000 }).toEqual([7, 7]);
        await sameHash([a, b]);
        await expect(b.getByTestId('primary-action')).toBeVisible({ timeout: 20_000 });
        await snap(b, '08-private-table', project);
      }, { timeout: 60_000 });
      await test.step('Ben concedes; the overlay; HOME', async () => {
        await b.getByTestId('open-menu').click();
        await b.getByRole('menuitem', { name: /concede/i }).click();
        const ok = b.getByTestId('concede-ok');
        if (await ok.isVisible().catch(() => false)) await ok.click();
        for (const p of [a, b]) await expect(p.getByTestId('game-over')).toBeVisible({ timeout: 20_000 });
        await snap(a, '09-game-over', project);
        await a.getByTestId('game-over-home').click();
        await expect(a.getByTestId('route-home')).toBeVisible();
      }, { timeout: 45_000 });
    } finally {
      await context.close();
    }
  });

  test('4: quick match 1v1 with the queue bar, then a 4 FFA of four distinct seats', async ({ browser }, info) => {
    test.setTimeout(240_000);
    const project = info.project.name;
    const { context, list } = await pages(browser, 4);
    try {
      await test.step('four profiles, each with a deck', async () => {
        for (const [i, p] of list.entries()) {
          await openSite(p, profile(info, `mm${i}`), '/');
          await seedDeck(p, i % 2 ? 'ur-m19-60.mtga.txt' : 'gw-m19-60.txt');
        }
      }, { timeout: 90_000 });
      const [a, b] = list as [Page, Page];
      const phase = (p: Page) => p.evaluate(() => window.__spellplane!.mm!.status().phase);
      await test.step('Ann searches 1v1 and browses Decks with the queue bar', async () => {
        await mode(a, 'quick');
        await a.getByTestId('home-primary').click();
        await expect.poll(() => phase(a)).toBe('seeking');
        await navTo(a, 'DECKS');
        await expect(a.getByTestId('queue-bar')).toBeVisible();
        await snap(a, '10-queue-bar', project);
      }, { timeout: 30_000 });
      let room = '';
      await test.step('Ben searches; match found; both accept; the table without a waiting room', async () => {
        await mode(b, 'quick');
        await b.getByTestId('home-primary').click();
        for (const p of [a, b]) await expect(p.getByTestId('match-found')).toBeVisible({ timeout: 10_000 });
        await snap(b, '11-match-found', project);
        for (const p of [a, b]) await p.getByTestId('match-accept').click();
        for (const p of [a, b]) await expect.poll(() => p.evaluate(() => location.hash), { timeout: 20_000 }).toMatch(/^#\/t\//);
        room = await a.evaluate(() => location.hash);
        expect(await b.evaluate(() => location.hash)).toBe(room);
        for (const p of [a, b]) {
          await expect
            .poll(async () => {
              const s = await state(p).catch(() => null);
              return s ? { stage: s.stage, matched: s.settings.matched === true, hands: [countOf(s, 'hand:s0'), countOf(s, 'hand:s1')] } : null;
            }, { timeout: 45_000 })
            .toEqual({ stage: 'match', matched: true, hands: [7, 7] });
          await expect(p.getByTestId('lobby')).toHaveCount(0);
        }
        await sameHash([a, b]);
        await expect(a.getByTestId('primary-action')).toBeVisible({ timeout: 20_000 });
        await snap(a, '12-matched-table', project);
      }, { timeout: 90_000 });
      await test.step('four profiles form one 4 FFA match with four distinct seats', async () => {
        for (const p of list) {
          await p.evaluate(() => (location.hash = '#/'));
          await expect(p.getByTestId('route-home')).toBeVisible();
          await mode(p, 'quick');
          await p.getByTestId('opt-quick-format').getByRole('radio', { name: '4 FFA' }).click();
          await p.getByTestId('home-primary').click();
        }
        for (const p of list) await expect(p.getByTestId('match-found')).toBeVisible({ timeout: 15_000 });
        for (const p of list) await p.getByTestId('match-accept').click();
        for (const p of list) await expect.poll(() => p.evaluate(() => location.hash), { timeout: 30_000 }).toMatch(/^#\/t\//);
        const rooms = new Set(await Promise.all(list.map((p) => p.evaluate(() => location.hash))));
        expect(rooms.size).toBe(1);
        expect([...rooms][0]).not.toBe(room);
        await expect.poll(async () => new Set(await Promise.all(list.map((p) => seatOf(p)))).size, { timeout: 45_000 }).toBe(4);
        await sameHash(list);
        // The versus screen hands over to the table: the HUD's primary shows.
        await expect(list[2]!.getByTestId('primary-action')).toBeVisible({ timeout: 20_000 });
        await snap(list[2]!, '12b-matched-ffa4-table', project);
      }, { timeout: 90_000 });
    } finally {
      await context.close();
    }
  });

  test('5: sealed means sealed', async ({ page }, info) => {
    test.setTimeout(120_000);
    const project = info.project.name;
    await openSite(page, profile(info, 'sealed'), '/decks/new');
    await expect.poll(() => page.evaluate(() => typeof window.__spellplane?.decks?.nextSeed === 'function')).toBe(true);
    await page.evaluate((s) => window.__spellplane!.decks!.nextSeed!(s), SEED);
    let id = '';
    await test.step('six fixture boosters on a pinned seed: a locked booster deck with 40 cards', async () => {
      // The app offers the newest core set; the fixtures hold M19, chosen in the booster setup.
      await expect(page.getByTestId('open-setup')).toHaveText(/^6 × /);
      await page.getByTestId('open-setup').click();
      const set = page.getByTestId('setup-set');
      for (let i = 0; i < 60 && !((await set.textContent()) ?? '').includes('(M19)'); i++) await set.getByRole('button', { name: 'Next set' }).click();
      await expect(set).toContainText('(M19)');
      await snap(page, '13a-booster-setup', project);
      await page.getByTestId('setup-open').click();
      await expect(page.getByTestId('opening')).toBeVisible();
      id = decodeURIComponent((await page.evaluate(() => location.hash)).replace(/^#\/decks\//, '').replace(/\/open$/, ''));
      await page.getByTestId('open-all').click();
      await expect(page.getByTestId('deck-page')).toHaveAttribute('data-kind', 'sealed');
      await expect(page.getByTestId('deck-count')).toHaveText(/^\s*40 \/ 40\s*$/);
      const d = (await deckGet(page, id))!;
      expect(d.kind).toBe('sealed');
      expect(d.seal!.seed).toBe(SEED);
      // The lock: the deck page's kind chip (the seal band is the library tile's, checked after the conversion).
      await expect(page.getByTestId('deck-kind')).toContainText('🔒 Booster');
      await snap(page, '13-sealed-deck', project);
    }, { timeout: 45_000 });
    let outside = '';
    await test.step('a card from outside the pool: no search and no + in the UI; refused through the debug hook', async () => {
      await expect(page.getByTestId('card-search')).toHaveCount(0);
      await expect(page.getByTestId('pool-grid')).toBeVisible();
      const pool = (await deckGet(page, id))!.seal!.pool.map((r) => r.sid);
      outside = await page.evaluate((p) => window.__spellplaneFixtures!.cards.find((c) => c.set === 'm20' && !p.includes(c.id) && !/Basic/.test(c.type_line))!.id, pool);
      // Nothing on the page offers the outside card.
      await expect(page.locator(`[data-sid="${outside}"]`)).toHaveCount(0);
      expect(await page.evaluate(([d, s]) => window.__spellplane!.decks!.edit!(d, { op: 'add', sid: s }), [id, outside] as const)).toEqual({ ok: false, reason: 'notInPool' });
    }, { timeout: 20_000 });
    await test.step('CONVERT TO CUSTOM DECK: the copy takes it; the original is byte-equal', async () => {
      // The page saves the built deck a moment after showing it (main and summary): the original as stored then.
      await expect.poll(async () => {
        const d = await deckGet(page, id);
        return d ? d.main.length === 40 && d.summary !== undefined : false;
      }, { timeout: 15_000 }).toBe(true);
      const before = JSON.stringify(await deckGet(page, id));
      await page.getByTestId('convert-open').click();
      await page.getByTestId('convert-go').click();
      await expect(page.getByTestId('deck-page')).toHaveAttribute('data-kind', 'custom');
      const copy = (await deckList(page)).find((d) => d.id !== id)!;
      // decks.md D4: a custom deck named "<name> (custom)", made from the booster deck.
      expect(copy.kind).toBe('custom');
      expect(copy.name).toBe(`${JSON.parse(before).name as string} (custom)`);
      expect(copy.convertedFrom?.id).toBe(id);
      // The copy takes the outside card through the UI: the search is back, a click adds it.
      const name = await page.evaluate((s) => window.__spellplaneFixtures!.cards.find((c) => c.id === s)!.name, outside);
      await expect(page.getByTestId('card-search')).toBeVisible();
      await page.getByTestId('card-search').fill(name);
      const card = page.locator(`[data-testid="result-card"][data-sid="${outside}"]`);
      await expect(card).toBeVisible();
      await card.click();
      await expect.poll(async () => (await deckGet(page, copy.id))?.main.some((r) => r.sid === outside) ?? false).toBe(true);
      // The debug hook agrees.
      const r = await page.evaluate(([d, s]) => window.__spellplane!.decks!.edit!(d, { op: 'add', sid: s }), [copy.id, outside] as const);
      expect((r as { ok: boolean }).ok).toBe(true);
      expect(JSON.stringify(await deckGet(page, id))).toBe(before);
      await snap(page, '13b-converted-deck', project);
    }, { timeout: 30_000 });
    await test.step('Decks lists both: the booster deck with its seal band, the copy without', async () => {
      await page.getByTestId('deck-done').click();
      await expect(page.getByTestId('deck-library')).toBeVisible();
      await expect(page.locator(`[data-testid="deck-tile"][data-deck-id="${id}"] [data-testid="seal-band"]`)).toBeVisible();
      await expect(page.locator('[data-testid="deck-tile"]')).toHaveCount(2);
      await snap(page, '13c-library-sealed-and-copy', project);
    }, { timeout: 20_000 });
  });

  test('6: draft night: three closed boosters, OPEN DRAFT TABLE, lobby settings equal the booster setup', async ({ page }, info) => {
    test.setTimeout(90_000);
    const project = info.project.name;
    await openSite(page, profile(info, 'draft'), '/');
    await expect(page.getByTestId('route-home')).toBeVisible();
    await mode(page, 'draft');
    await expect(page.getByTestId('home-hero')).toHaveAttribute('data-hero', 'boosters');
    await expect(page.getByTestId('home-boosters')).toHaveAccessibleName(/^3 closed boosters of M19$/);
    await expect(page.getByTestId('home-hero')).toContainText('M19');
    await expect(page.getByTestId('hero-name')).toHaveCount(0);
    await snap(page, '14-draft-night', project);
    const prefs = (await page.evaluate(() => window.__spellplane!.home!.prefs!())) as { draft: { boosters: { how: string; packs: number; picks: number; sets: string[]; pickTimer: boolean } } } | null;
    await expect(page.getByTestId('home-primary')).toHaveText('OPEN DRAFT TABLE');
    await page.getByTestId('home-primary').click();
    await expect(page.getByTestId('lobby')).toBeVisible({ timeout: 20_000 });
    const b = prefs?.draft.boosters ?? { how: 'pass', packs: 3, picks: 1, sets: ['M19'], pickTimer: true };
    await expect
      .poll(async () => (await state(page)).lobby)
      .toEqual({ draft: { format: 'pass', packs: b.packs, picks: b.picks }, sets: b.sets.length ? b.sets : ['M19'], pickTimer: b.pickTimer });
    expect((await state(page)).settings.autoSetup).toBe(true);
    await snap(page, '15-draft-waiting-room', project);
    await snapRules(page, '15b-draft-rules-panel', project);
  });

  test('7: leave and rejoin; the copy with more moves wins; bring Cy back', async ({ browser }, info) => {
    test.setTimeout(360_000);
    const project = info.project.name;
    const { context, list } = await pages(browser, 3);
    const [a, b, c0] = list as [Page, Page, Page];
    const profiles = { a: profile(info, 'ann'), b: profile(info, 'ben'), c: profile(info, 'cy'), cNew: profile(info, 'cy-new') };
    const seat = { a: '', b: '', c: '' };
    const gaps: string[] = [];
    let room = '';
    let c: Page | null = null;
    try {
      await test.step('Ann: PRIVATE GAME · 4 FFA → CREATE TABLE; Ben and Cy open the link; all READY; START WITH 3 PLAYERS', async () => {
        await openSite(a, profiles.a);
        await seedDeck(a, 'gw-m19-60.txt');
        await mode(a, 'private');
        await a.getByTestId('opt-private-format').getByRole('radio', { name: '4 FFA' }).click();
        await expect(a.getByTestId('home-primary')).toHaveText('CREATE TABLE');
        await a.getByTestId('home-primary').click();
        await expect(a.getByTestId('invite-sheet')).toBeVisible({ timeout: 20_000 });
        const link = await a.getByTestId('share-link').inputValue();
        room = link.split('/t/')[1]!.split('/')[0]!;
        await expect.poll(async () => (await state(a)).format).toBe('ffa4');
        const hash = link.slice(link.indexOf('#') + 1);
        for (const [p, who] of [
          [b, profiles.b],
          [c0, profiles.c],
        ] as const) {
          await openSite(p, who, hash);
          await expect(p.locator('[data-testid="chair"][data-mine="true"]')).toHaveCount(1, { timeout: 20_000 });
        }
        seat.a = await seatOf(a);
        seat.b = await seatOf(b);
        seat.c = await seatOf(c0);
        expect(new Set(Object.values(seat)).size).toBe(3);
        await readyWith(b, 'ur-m19-60.mtga.txt');
        await readyWith(c0, 'gw-m19-60.txt');
        await readyWith(a, 'gw-m19-60.txt');
        // A chair stays empty, so the start does not press itself: the host starts with the three who came.
        await expect(a.getByTestId('start-short')).toHaveText('START WITH 3 PLAYERS', { timeout: 15_000 });
        await a.getByTestId('start-short').click();
        const seats = [seat.a, seat.b, seat.c];
        for (const p of [a, b, c0]) await expect.poll(() => hands(p, seats), { timeout: 45_000 }).toEqual([7, 7, 7]);
        await sameHash([a, b, c0]);
        expect((await state(a)).format).toBe('ffa4');
      }, { timeout: 120_000 });

      await test.step('play to turn 3 by the HUD primary of whoever is active', async () => {
        const bySeat: Record<string, Page> = { [seat.a]: a, [seat.b]: b, [seat.c]: c0 };
        await expect
          .poll(async () => {
            const s = await state(a);
            if (s.turn.number < 3 && bySeat[s.turn.active]) await pressPrimary(bySeat[s.turn.active]!);
            return s.turn.number;
          }, { timeout: 60_000, intervals: [250] })
          .toBeGreaterThanOrEqual(3);
        await sameHash([a, b, c0]);
        await snap(a, '20-ffa4-turn3', project);
      }, { timeout: 75_000 });

      let benSeq = 0;
      let benLife = 0;
      await test.step('Cy leaves by the arrow; Ann and Ben play on; Ann leaves; Ben plays on and leaves', async () => {
        await c0.evaluate(() => window.__spellplane!.session!.saved());
        await leaveByArrow(c0);
        await c0.close();
        await expect.poll(async () => (await state(a)).seats[seat.c]?.away === true, { timeout: 20_000 }).toBe(true);
        const annLife = (await state(a)).seats[seat.a]!.life;
        for (let i = 0; i < 2; i++) await plate(a, seat.a).getByTestId('life-minus').click();
        await expect.poll(async () => (await state(b)).seats[seat.a]?.life).toBe(annLife - 2);
        await sameHash([a, b]);
        await a.evaluate(() => window.__spellplane!.session!.saved());
        await leaveByArrow(a);
        await expect.poll(async () => (await state(b)).seats[seat.a]?.away === true, { timeout: 20_000 }).toBe(true);
        // One move: Ben's copy has more moves than Ann's, and (after Ann's chat) fewer sequence numbers.
        const lifeBefore = (await state(b)).seats[seat.b]!.life;
        await plate(b, seat.b).getByTestId('life-minus').click();
        await expect.poll(async () => (await state(b)).seats[seat.b]?.life).toBe(lifeBefore - 1);
        benLife = lifeBefore - 1;
        benSeq = (await state(b)).seq;
        await b.evaluate(() => window.__spellplane!.session!.saved());
        await leaveByArrow(b);
        for (const p of [a, b]) await homeIsClean(p);
      }, { timeout: 75_000 });

      let annSeq = 0;
      await test.step('Ann returns from History: Gathering waits for Ben; she writes four chat lines', async () => {
        await navTo(a, 'HISTORY');
        await expect(a.getByTestId('history-row').first()).toHaveAttribute('data-code', room);
        await a.getByTestId('history-row').first().click();
        await expect(a.getByTestId('gathering-card')).toBeVisible({ timeout: 20_000 });
        // It waits for Ben, whose copy is the newest one Ann has heard of; Cy had left before her.
        await expect.poll(() => a.evaluate(() => window.__spellplane!.session!.muster!().waitingFor)).toEqual([seat.b]);
        await expect(a.getByTestId('gathering-card')).toContainText((await state(a)).seats[seat.b]!.name);
        await snap(a, '16-gathering', project);
        await designAudit(a);
        expect(await seriousViolations(a, '[data-testid="gathering-card"]'), 'Gathering').toEqual([]);
        // Four chat lines: through the log's chat field when the table is looked at, else (a gap) the debug hook.
        const seqBefore = (await state(a)).seq;
        await a.getByTestId('gathering-look').click();
        await expect(a.getByTestId('gathering-banner')).toBeVisible();
        const byUi = await (async () => {
          try {
            await a.getByTestId('open-log').click({ timeout: 3_000 });
            const field = a.getByTestId('chat-input');
            await expect(field).toBeVisible({ timeout: 3_000 });
            for (let i = 0; i < 4; i++) {
              await field.fill(`line ${i + 1}`);
              await field.press('Enter');
            }
            return true;
          } catch {
            return false;
          }
        })();
        if (!byUi) {
          gaps.push('step 7: the chat field is not reachable while Gathering (read-only table); the four chat lines went through __spellplane.dispatch');
          const s = await state(a);
          for (let i = (s.seq > seqBefore ? s.seq - seqBefore : 0); i < 4; i++) await a.evaluate((t) => window.__spellplane!.dispatch!({ type: 'chat', text: t, channel: 'table' } as never), `line ${i + 1}`);
        }
        await expect.poll(async () => (await state(a)).seq, { timeout: 15_000 }).toBeGreaterThanOrEqual(seqBefore + 4);
        annSeq = (await state(a)).seq;
        info.annotations.push({ type: 'chat route', description: byUi ? 'chat field' : 'debug hook (gap)' });
        console.log(`[gate M8 ${project}] step 7 chat route: ${byUi ? 'the chat field' : 'the debug hook (a gap)'}`);
      }, { timeout: 60_000 });

      let benHash = '';
      await test.step('Ben returns from History: both live on Ben’s copy (more moves, fewer sequence numbers)', async () => {
        await navTo(b, 'HISTORY');
        await expect(b.getByTestId('history-row').first()).toHaveAttribute('data-code', room);
        await b.getByTestId('history-row').first().click();
        for (const p of [a, b]) await expect.poll(() => live(p), { timeout: 30_000 }).toBe(true);
        benHash = await sameHash([a, b]);
        info.annotations.push({ type: 'copies', description: `Ann's copy seq ${annSeq}, Ben's copy seq ${benSeq} (Ben's has one more move)` });
        expect(annSeq).toBeGreaterThan(benSeq);
        // Ben's move is on both tables: his copy won.
        for (const p of [a, b]) expect((await state(p)).seats[seat.b]!.life).toBe(benLife);
        await expect(a.getByTestId('gathering-card')).toHaveCount(0);
      }, { timeout: 60_000 });

      let link = '';
      await test.step('Cy’s browser is lost; Ann opens Cy’s plate menu: BRING CY BACK shows the QR code and the link', async () => {
        const cy = (await state(a)).seats[seat.c]!.name;
        // The sequencer accepts an invite after 30 s of absence on its own clock (contracts.md Part G "Rejoin" item 7).
        // A new sequencer starts the 30 seconds again: first both pages agree on who sequences; the pinned clock is moved
        // on twice, so an activation in between still sees the seat away for more than 30 s.
        await expect
          .poll(async () => new Set(await Promise.all([a, b].map((p) => p.evaluate(() => window.__spellplane!.net!.sequencer())))).size, { timeout: 15_000 })
          .toBe(1);
        const t0 = await a.evaluate(() => Date.now());
        for (const p of [a, b]) await p.evaluate((t) => window.__spellplane!.net!.setClock!(t), t0 + 31_000);
        await plate(a, seat.c).getByTestId('plate-more').click();
        await expect(a.getByTestId('seat-menu-away')).toBeVisible();
        const bring = a.getByTestId('seat-menu-bring');
        await expect(bring).toHaveText(`BRING ${cy.toUpperCase()} BACK`);
        await snap(a, '17-plate-menu-away', project);
        for (const p of [a, b]) await p.evaluate((t) => window.__spellplane!.net!.setClock!(t), t0 + 62_000);
        await bring.click();
        await expect(a.getByTestId('qr-plate')).toBeVisible({ timeout: 15_000 });
        await expect(a.getByTestId('share-link')).toHaveValue(new RegExp(`/rejoin/${seat.c}/`), { timeout: 15_000 });
        link = await a.getByTestId('share-link').inputValue();
        await snap(a, '18-bring-back', project);
        for (const p of [a, b]) await p.evaluate(() => window.__spellplane!.net!.setClock!(null));
        await a.keyboard.press('Escape');
      }, { timeout: 45_000 });

      await test.step('the link in a blank profile: Cy sits down and recovers (a new hand of 7)', async () => {
        c = await context.newPage();
        await openSite(c, profiles.cNew, link.slice(link.indexOf('#') + 1));
        await expect(c.getByTestId('claim-page')).toBeVisible({ timeout: 30_000 });
        await snap(c, '19-claim-page', project);
        await c.getByTestId('claim-sit').click();
        await expect.poll(() => seatOf(c!), { timeout: 20_000 }).toBe(seat.c);
        await expect(c.getByTestId('recovery')).toBeVisible({ timeout: 20_000 });
        await expect(c.getByTestId('recovery')).toHaveAttribute('data-phase', 'lost', { timeout: 20_000 });
        await snap(c, '19b-recovery', project);
        await c.getByTestId('recovery-hand').fill('7');
        await c.getByTestId('recovery-start').click();
        const dialog = c.getByTestId('recovery-import');
        await dialog.getByTestId('deck-text').fill(decklist('gw-m19-60.txt'));
        await dialog.getByTestId('deck-check').click();
        await dialog.getByTestId('deck-import-go').click();
        await expect(dialog).toHaveCount(0);
        // The others agree to the new hand (whoever is asked).
        await expect
          .poll(async () => {
            for (const p of [a, b]) {
              const ok = p.getByTestId('prompt-ok');
              if (await ok.isVisible().catch(() => false)) await ok.click({ timeout: 2_000 }).catch(() => undefined);
            }
            return c!.getByTestId('recovery-done').isVisible();
          }, { timeout: 45_000 })
          .toBe(true);
        await expect(c.getByTestId('recovery-done')).toContainText('a hand of 7');
        const h = await sameHash([a, b, c]);
        expect(h).not.toBe('');
        expect(benHash).not.toBe('');
        for (const p of [a, b, c]) {
          await expect.poll(async () => countOf(await state(p), `hand:${seat.c}`), { timeout: 15_000 }).toBe(7);
          expect((await state(p)).seats[seat.c]!.recovering).toBeUndefined();
          expect((await gamesOf(p))[0]?.code).toBe(room);
        }
      }, { timeout: 120_000 });

      await test.step('the leak scanner over all three pages is clean', async () => {
        const all: [Page, string][] = [
          [a, profiles.a],
          [b, profiles.b],
          [c!, profiles.cNew],
        ];
        // Each owner's hidden cards: salts always, Scryfall ids of cards nobody has seen face up.
        const hidden = async (p: Page) => {
          const s: TableState = await state(p);
          const sec = await secrets(p);
          const shown = new Set(Object.values(s.cards).flatMap((x) => (x.identity ? [x.identity.sid] : [])));
          const salts: string[] = [];
          const sids: string[] = [];
          for (const [id, x] of Object.entries(sec.identities)) {
            if (s.cards[id]?.identity) continue;
            salts.push(x.salt);
            if (!shown.has(x.card.sid)) sids.push(x.card.sid);
          }
          return { salts, sids };
        };
        for (const [owner] of all) {
          const t = await hidden(owner);
          expect(t.salts.length).toBeGreaterThan(0);
          for (const [other, otherProfile] of all) {
            if (other === owner) continue;
            // What the other page received and holds as shared state: no salt and no unseen Scryfall id.
            expect(scan([await hook(other, 'net.messages'), await state(other)], [...t.salts, ...t.sids])).toEqual([]);
            // Its own secrets and database (which hold its own deck, possibly the same cards): no salt of the owner's.
            expect(scan([await secrets(other), await idbDump(other, otherProfile)], t.salts)).toEqual([]);
          }
        }
      }, { timeout: 60_000 });

      await test.step('History lists the game first on each page; every count 0 on Home', async () => {
        for (const p of [a, b, c!]) {
          await leaveByArrow(p);
          await homeIsClean(p);
          await navTo(p, 'HISTORY');
          await expect(p.getByTestId('history-row').first()).toHaveAttribute('data-code', room);
        }
        await snap(c!, '21-history-after-rejoin', project);
      }, { timeout: 60_000 });
      if (gaps.length) info.annotations.push({ type: 'gaps', description: gaps.join('; ') });
    } finally {
      await context.close();
    }
  });

  test('8: design audit and axe on Home, Decks, the deck page, History, the waiting room and the table HUD', async ({ page }, info) => {
    test.setTimeout(120_000);
    await openSite(page, profile(info, 'audit'), '/');
    const check = async (where: string, scope?: string) => {
      await page.mouse.move(2, 2);
      await designAudit(page);
      expect(await seriousViolations(page, scope), where).toEqual([]);
    };
    await test.step('Home', async () => {
      await expect(page.getByTestId('route-home')).toBeVisible();
      await check('Home');
    }, { timeout: 20_000 });
    await test.step('Decks and the deck page', async () => {
      await seedDeck(page, 'gw-m19-60.txt');
      await navTo(page, 'DECKS');
      await expect(page.getByTestId('deck-library')).toBeVisible();
      await check('Decks');
      await page.locator('[data-testid="deck-tile"]').first().dblclick();
      await expect(page.getByTestId('deck-page')).toBeVisible();
      await check('the deck page');
    }, { timeout: 40_000 });
    await test.step('History', async () => {
      await page.evaluate(() => (location.hash = '#/history'));
      await expect(page.getByTestId('route-history')).toBeVisible();
      await check('History');
    }, { timeout: 20_000 });
    await test.step('the waiting room', async () => {
      await page.evaluate(() => (location.hash = '#/'));
      await mode(page, 'private');
      await page.getByTestId('home-primary').click();
      await expect(page.getByTestId('lobby')).toBeVisible({ timeout: 20_000 });
      await check('the waiting room');
    }, { timeout: 40_000 });
    await test.step('the table HUD (a practice table)', async () => {
      await page.evaluate(() => (location.hash = '#/'));
      await soloOpponent(page, 'ALONE');
      await page.getByTestId('home-primary').click();
      await expect(page.getByTestId('table-frame')).toBeVisible({ timeout: 30_000 });
      await expect(page.getByTestId('primary-action')).toBeVisible({ timeout: 20_000 });
      await check('the table HUD', '[data-testid="hud"]');
    }, { timeout: 45_000 });
  });
});

