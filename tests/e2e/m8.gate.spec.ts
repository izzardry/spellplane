/**
 * Gate M8-G (docs/PLAN.md, Milestone 8, "Gate M8-G"): the owner's walk through the journey, in one file, with the
 * screenshots. Chromium and WebKit, `?transport=local&faces=placeholder`, fixtures only (tests/fixtures), at most four
 * pages per test, each long test split into `test.step`s, product timers driven by the clock hooks
 * (`mm.tick`, `bot.setClock('manual')`, `net.setClock`), screenshots to `artifacts/shots/M8/` (`pnpm shots -- M8`).
 *
 * 1. Landing to a first game: Home, not a table; Decks → NEW DECK → CUSTOM DECK → a simple deck from the fixture search
 *    with lands added by the helper (curve and strength shown) → PLAY on its tile → Home with the deck as hero.
 * 2. Against the computer: SOLO · SPARRING → PLAY → seven cards, the log closed, no key pressed; Sparring plays; leave
 *    by the arrow → Home with CONTINUE → History lists the game first → open it: the same state hash, Sparring goes
 *    on. After each table visit every lifecycle count is 0 on Home.
 * 3. Private game: two profiles, CREATE TABLE, the invite link, both READY, the self-pressing start, versus, seven
 *    cards each; one concedes; the overlay; HOME.
 * 4. Matchmaking: two profiles search 1v1 (one browses Decks with the queue bar), match found, both accept, the table
 *    without a waiting room; then four profiles form a 4 FFA match with four distinct seats.
 * 5. Sealed means sealed: six fixture boosters on a pinned seed, a locked booster deck with 40 cards; a card from
 *    outside the pool is refused in the UI (no search) and through the debug hook; CONVERT TO CUSTOM DECK makes a copy
 *    that takes it; the original is unchanged.
 * 6. Draft night: three closed boosters with the fixture set code and no deck; OPEN DRAFT TABLE opens a waiting room
 *    whose lobby settings equal the booster setup.
 * 7. Leave and rejoin, the copy with more moves wins (three profiles in a 4 FFA with three players).
 * 8. Design audit and axe on Home, Decks, the deck page, History, the waiting room, Gathering and the table HUD.
 *
 * Engine behaviour is asserted on state hashes and the debug hook, never on pixels; screenshots are evidence.
 */
import { expect, test, type Browser, type BrowserContext, type Page, type TestInfo } from '@playwright/test';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { SecretStore, TableState } from '../../src/core/types';
import type { DeckRecord, GameSummary } from '../../src/store/types';
import { scan } from '../leak/scan';
import { seriousViolations } from './a11y/helpers';
import { setsScript } from './flow/helpers';
import { hook, shot } from './helpers/app';
import { designAudit } from './helpers/design-audit';

const MS = 'M8';
const FIXTURES = path.join('tests', 'fixtures');
let cardsScript: string | null = null;
/** The recorded Scryfall cards of the fixtures (M19, M20, M21 and the M19 tokens), injected before the page loads. */
function fixturesScript(): string {
  if (!cardsScript) {
    const cards = ['m19.json', 'm20.json', 'm21.json', 'tm19.json'].flatMap((f) => JSON.parse(fs.readFileSync(path.join(FIXTURES, 'scryfall', f), 'utf8')) as unknown[]);
    cardsScript = `window.__spellplaneFixtures = ${JSON.stringify({ cards })};`;
  }
  return cardsScript;
}
const decklist = (file: string) => fs.readFileSync(path.join(FIXTURES, 'decklists', file), 'utf8');
const SEED = '00112233445566778899aabbccddeeff';

/** A profile no other test or earlier run uses. */
function profile(info: TestInfo, who: string): string {
  return `m8g-${who}-${info.project.name.slice(0, 3)}-${info.workerIndex}-${crypto.randomBytes(4).toString('hex')}`;
}

/** The clipboard is never read: a stub records what was written. */
const CLIPBOARD = () => {
  const w = window as unknown as { __copied: string[] };
  w.__copied = [];
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (t: string) => void w.__copied.push(t) } });
};

/** Open the real app (no harness) at `hash` (`''`: the bare site) with fixtures, placeholder faces and the local transport. */
async function openSite(page: Page, who: string, hash = ''): Promise<void> {
  await page.addInitScript({ content: fixturesScript() });
  await page.addInitScript({ content: setsScript(['M19']) });
  await page.addInitScript(CLIPBOARD);
  await page.goto(`./?faces=placeholder&transport=local&profile=${encodeURIComponent(who)}${hash ? `#${hash}` : ''}`);
  await expect.poll(() => page.evaluate(() => typeof window.__spellplane === 'object')).toBe(true);
}

async function pages(browser: Browser, n: number): Promise<{ context: BrowserContext; list: Page[] }> {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const list: Page[] = [];
  for (let i = 0; i < n; i++) list.push(await context.newPage());
  return { context, list };
}

const state = (p: Page) => hook<TableState>(p, 'state');
const secrets = (p: Page) => hook<SecretStore>(p, 'secrets');
const live = (p: Page) => p.evaluate(() => window.__spellplane!.home!.live!());
const residue = (p: Page) => p.evaluate(() => (window.__spellplane?.render?.memory?.() ?? null) as Record<string, number> | null);
const games = (p: Page) => p.evaluate(() => window.__spellplane!.games!.list()) as Promise<GameSummary[]>;
const deckGet = (p: Page, id: string) => p.evaluate((x) => window.__spellplane!.decks!.get!(x), id) as Promise<DeckRecord | null>;
const deckList = (p: Page) => p.evaluate(() => window.__spellplane!.decks!.list()) as Promise<DeckRecord[]>;
function countOf(s: TableState, zone: string): number {
  const z = s.zones[zone];
  if (!z) return 0;
  return z.visibility === 'public' ? z.ids.length : (z.count ?? z.ids.length);
}

/** On Home: every lifecycle count is 0 and nothing a renderer held is left (contracts.md Part C). */
async function homeIsClean(p: Page): Promise<void> {
  await expect(p.getByTestId('route-home')).toBeVisible();
  await expect.poll(async () => Object.entries(await live(p)).filter(([, v]) => v !== 0), { timeout: 15_000 }).toEqual([]);
  await expect
    .poll(async () => {
      const m = await residue(p);
      return m ? { geometries: m.geometries, textures: m.textures, programs: m.programs } : null;
    })
    .toEqual({ geometries: 0, textures: 0, programs: 0 });
}

/** A nav place of the shell. */
const navTo = (p: Page, place: 'PLAY' | 'DECKS' | 'HISTORY') => p.getByTestId('shell-nav').getByRole('radio', { name: place }).click();

/** Wait until the pages agree on one state hash, and return it. */
async function sameHash(list: Page[]): Promise<string> {
  await expect
    .poll(async () => new Set(await Promise.all(list.map(async (p) => p.evaluate(() => window.__spellplane!.session!.hash())))).size, { timeout: 30_000 })
    .toBe(1);
  return list[0]!.evaluate(() => window.__spellplane!.session!.hash());
}

/** Build a small custom deck through the deck page: four searches, then the land helper. Returns its id. */
async function buildCustomDeck(p: Page): Promise<string> {
  await p.getByTestId('new-deck').first().click();
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

/** Store a fixture decklist as this profile's deck and select it on Home (through Decks' import path). */
async function importDeck(p: Page, file: string): Promise<string> {
  await p.evaluate((h) => (location.hash = h), '#/decks/new/import');
  await p.getByTestId('deck-text').fill(decklist(file));
  await p.getByTestId('deck-check').click();
  await p.getByTestId('deck-import-go').click();
  await expect(p.getByTestId('deck-page')).toBeVisible();
  const id = decodeURIComponent((await p.evaluate(() => location.hash)).replace('#/decks/', ''));
  await expect.poll(async () => (await deckGet(p, id))?.main.length ?? 0).toBe(60);
  await p.evaluate((x) => window.__spellplane!.decks!.select!(x), id);
  await p.evaluate(() => (location.hash = '#/'));
  await expect(p.getByTestId('route-home')).toBeVisible();
  return id;
}

/** Pick a Home mode card. */
async function mode(p: Page, m: 'solo' | 'quick' | 'private' | 'draft'): Promise<void> {
  await p.getByTestId(`mode-${m}`).click();
  await expect(p.getByTestId(`mode-${m}`)).toHaveAttribute('aria-checked', 'true');
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
      await shot(page, MS, '01-home-first-run', project);
    });
    await test.step('Decks → NEW DECK → CUSTOM DECK: a simple deck from the search, lands by the helper', async () => {
      await navTo(page, 'DECKS');
      await expect(page.getByTestId('deck-library')).toBeVisible();
      deckId = await buildCustomDeck(page);
      await shot(page, MS, '02-deck-page', project);
      await page.getByTestId('deck-done').click();
      await expect(page.getByTestId('deck-library')).toBeVisible();
    });
    await test.step('PLAY on its tile: Home with the deck as hero', async () => {
      const tile = page.locator(`[data-testid="deck-tile"][data-deck-id="${deckId}"]`);
      await tile.hover();
      await tile.getByTestId('tile-play').click();
      await expect(page.getByTestId('route-home')).toBeVisible();
      const name = (await deckGet(page, deckId))!.name;
      await expect(page.getByTestId('hero-name')).toHaveText(name);
      await expect(page.getByTestId('hero-curve')).toBeVisible();
      await shot(page, MS, '03-home-hero', project);
    });

    let room = '';
    let hash = '';
    await test.step('SOLO · SPARRING → PLAY: seven cards, the log closed, no key pressed', async () => {
      await mode(page, 'solo');
      await page.getByTestId('opt-opponent').getByRole('radio', { name: 'SPARRING' }).click();
      await expect(page.getByTestId('home-primary')).toHaveText(/PLAY/);
      await page.getByTestId('home-primary').click();
      await expect(page.getByTestId('table-frame')).toHaveAttribute('data-kind', 'computer', { timeout: 30_000 });
      room = (await page.evaluate(() => location.hash)).replace(/^#\/c\//, '');
      await expect.poll(() => page.evaluate(() => typeof window.__spellplane?.bot?.setClock === 'function')).toBe(true);
      await page.evaluate(() => window.__spellplane!.bot!.setClock('manual'));
      await expect.poll(() => page.evaluate(() => window.__spellplane!.bot!.view()?.hand.length ?? -1), { timeout: 30_000 }).toBe(7);
      await expect.poll(() => page.evaluate(() => window.__spellplane!.bot!.view()?.oppHand ?? -1)).toBe(7);
      await expect(page.locator('[data-testid="log"][data-open="true"]')).toHaveCount(0);
      await expect(page.locator('[role="dialog"]:visible')).toHaveCount(0);
      await shot(page, MS, '04-sparring-table', project);
    });
    await test.step('Sparring plays', async () => {
      // Ten own actions that change nothing in the end (a solo game left after fewer is not kept), by the plate's
      // buttons; then the turn goes to Sparring and its manual clock runs.
      const plate = page.locator('[data-testid="avatar"][data-seat="s0"]');
      for (let i = 0; i < 5; i++) {
        await plate.getByTestId('life-minus').click();
        await plate.getByTestId('life-plus').click();
      }
      const before = await page.evaluate(() => window.__spellplane!.bot!.steps());
      if ((await state(page)).turn.active === 's0') await page.evaluate(() => window.__spellplane!.dispatch!({ type: 'turnPass', to: 's1' } as never));
      await expect
        .poll(async () => {
          await page.evaluate(() => window.__spellplane!.bot!.tick(5_000));
          return page.evaluate(() => window.__spellplane!.bot!.steps());
        }, { timeout: 20_000 })
        .toBeGreaterThan(before);
    });
    await test.step('leave by the arrow: Home with the CONTINUE strip; every count 0', async () => {
      hash = await page.evaluate(() => window.__spellplane!.session!.hash());
      await page.getByTestId('leave').click();
      await expect(page.getByTestId('route-home')).toBeVisible();
      await expect(page.getByTestId('toast').first()).toContainText('Game saved. Continue any time.');
      await expect(page.getByTestId('home-continue')).toBeVisible();
      await homeIsClean(page);
      await shot(page, MS, '05-home-continue', project);
    });
    await test.step('History lists the game first; open it: the same state hash, Sparring goes on', async () => {
      await navTo(page, 'HISTORY');
      const rows = page.getByTestId('history-row');
      await expect(rows.first()).toBeVisible();
      expect((await games(page))[0]?.code).toBe(room);
      await shot(page, MS, '06-history', project);
      await rows.first().click();
      await expect(page.getByTestId('table-frame')).toHaveAttribute('data-kind', 'computer', { timeout: 30_000 });
      await expect.poll(() => page.evaluate(() => window.__spellplane?.session?.hash() ?? '')).toBe(hash);
      await expect.poll(() => page.evaluate(() => window.__spellplane!.bot!.active())).toBe(true);
    });
    await test.step('leave again: every count 0 on Home', async () => {
      await page.getByTestId('leave').click();
      await homeIsClean(page);
    });
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
        await importDeck(a, 'gw-m19-60.txt');
        await mode(a, 'private');
        await expect(a.getByTestId('home-primary')).toHaveText('CREATE TABLE');
        await a.getByTestId('home-primary').click();
        await expect(a.getByTestId('invite-sheet')).toBeVisible({ timeout: 20_000 });
        link = await a.getByTestId('share-link').inputValue();
        await a.getByTestId('copy-link').click();
        expect(await a.evaluate(() => (window as unknown as { __copied: string[] }).__copied)).toEqual([link]);
        expect((await state(a)).settings.autoSetup).toBe(true);
        await shot(a, MS, '07-waiting-room', project);
      });
      await test.step('Ben opens the invite link; both READY', async () => {
        await openSite(b, profile(info, 'b'), link.slice(link.indexOf('#') + 1));
        await expect(b.locator('[data-testid="chair"][data-seat="s1"]')).toHaveAttribute('data-mine', 'true', { timeout: 20_000 });
        for (const [p, file] of [
          [a, 'gw-m19-60.txt'],
          [b, 'ur-m19-60.mtga.txt'],
        ] as const) {
          if (await p.getByTestId('lobby-deck-text').isVisible().catch(() => false)) {
            await p.getByTestId('lobby-deck-text').fill(decklist(file));
            await p.getByTestId('lobby-deck-check').click();
          }
        }
        // Ben has no deck of his own: he pastes his list; Ann brings the deck Home had selected.
        if (!(await b.getByTestId('lobby-deck-text').isVisible().catch(() => false))) {
          await b.getByTestId('paste-instead').click();
          await b.getByTestId('lobby-deck-text').fill(decklist('ur-m19-60.mtga.txt'));
          await b.getByTestId('lobby-deck-check').click();
        }
        await b.getByTestId('ready').click();
        await expect(b.getByTestId('ready-done')).toBeVisible({ timeout: 15_000 });
        await a.getByTestId('ready').click();
        await expect(a.getByTestId('ready-done')).toBeVisible({ timeout: 15_000 });
      });
      await test.step('the start presses itself; versus; seven cards each', async () => {
        await expect(a.getByTestId('start-game')).toHaveText(/^START · [123]$/, { timeout: 15_000 });
        await a.clock.runFor(3_100);
        for (const p of [a, b]) await expect(p.getByTestId('stage')).toHaveAttribute('data-stage', 'match', { timeout: 20_000 });
        await expect
          .poll(async () => {
            const s = await state(b).catch(() => null);
            return s ? [countOf(s, 'hand:s0'), countOf(s, 'hand:s1')] : null;
          }, { timeout: 30_000 })
          .toEqual([7, 7]);
        await sameHash([a, b]);
        await shot(b, MS, '08-private-table', project);
      });
      await test.step('Ben concedes; the overlay; HOME', async () => {
        await b.getByTestId('open-menu').click();
        await b.getByRole('menuitem', { name: /concede/i }).click();
        const ok = b.getByTestId('concede-ok');
        if (await ok.isVisible().catch(() => false)) await ok.click();
        for (const p of [a, b]) await expect(p.getByTestId('game-over')).toBeVisible({ timeout: 20_000 });
        await shot(a, MS, '09-game-over', project);
        await a.getByTestId('game-over-home').click();
        await expect(a.getByTestId('route-home')).toBeVisible();
      });
    } finally {
      await context.close();
    }
  });

  test('4: quick match 1v1 with the queue bar, then a 4 FFA of four distinct seats', async ({ browser }, info) => {
    test.setTimeout(240_000);
    const project = info.project.name;
    const { context, list } = await pages(browser, 4);
    try {
      for (const [i, p] of list.entries()) {
        await openSite(p, profile(info, `mm${i}`), '/');
        await importDeck(p, i % 2 ? 'ur-m19-60.mtga.txt' : 'gw-m19-60.txt');
      }
      const [a, b] = list as [Page, Page];
      const phase = (p: Page) => p.evaluate(() => window.__spellplane!.mm!.status().phase);
      await test.step('Ann searches 1v1 and browses Decks with the queue bar', async () => {
        await mode(a, 'quick');
        await a.getByTestId('home-primary').click();
        await expect.poll(() => phase(a)).toBe('seeking');
        await navTo(a, 'DECKS');
        await expect(a.getByTestId('queue-bar')).toBeVisible();
        await shot(a, MS, '10-queue-bar', project);
      });
      let room = '';
      await test.step('Ben searches; match found; both accept; the table without a waiting room', async () => {
        await mode(b, 'quick');
        await b.getByTestId('home-primary').click();
        for (const p of [a, b]) await expect(p.getByTestId('match-found')).toBeVisible({ timeout: 10_000 });
        await shot(b, MS, '11-match-found', project);
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
        await shot(a, MS, '12-matched-table', project);
      });
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
        await expect.poll(async () => new Set(await Promise.all(list.map((p) => p.evaluate(() => window.__spellplane?.session?.seat() ?? '')))).size, { timeout: 45_000 }).toBe(4);
        await sameHash(list);
      });
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
      await page.getByTestId('setup-open').click();
      await expect(page.getByTestId('opening')).toBeVisible();
      id = decodeURIComponent((await page.evaluate(() => location.hash)).replace(/^#\/decks\//, '').replace(/\/open$/, ''));
      await page.getByTestId('open-all').click();
      await expect(page.getByTestId('deck-page')).toHaveAttribute('data-kind', 'sealed');
      await expect(page.getByTestId('deck-count')).toHaveText(/^\s*40 \/ 40\s*$/);
      const d = (await deckGet(page, id))!;
      expect(d.kind).toBe('sealed');
      expect(d.seal!.seed).toBe(SEED);
      await expect(page.getByTestId('seal-band').first()).toBeVisible();
      await shot(page, MS, '13-sealed-deck', project);
    });
    let outside = '';
    await test.step('a card from outside the pool: no search in the UI; refused through the debug hook', async () => {
      await expect(page.getByTestId('card-search')).toHaveCount(0);
      const pool = (await deckGet(page, id))!.seal!.pool.map((r) => r.sid);
      outside = await page.evaluate((p) => window.__spellplaneFixtures!.cards.find((c) => c.set === 'm20' && !p.includes(c.id) && !/Basic/.test(c.type_line))!.id, pool);
      expect(await page.evaluate(([d, s]) => window.__spellplane!.decks!.edit!(d, { op: 'add', sid: s }), [id, outside] as const)).toEqual({ ok: false, reason: 'notInPool' });
    });
    await test.step('CONVERT TO CUSTOM DECK: the copy takes it; the original is unchanged', async () => {
      const before = JSON.stringify(await deckGet(page, id));
      await page.getByTestId('convert-open').click();
      await page.getByTestId('convert-go').click();
      await expect(page.getByTestId('deck-page')).toHaveAttribute('data-kind', 'custom');
      const copy = (await deckList(page)).find((d) => d.id !== id)!;
      const r = await page.evaluate(([d, s]) => window.__spellplane!.decks!.edit!(d, { op: 'add', sid: s }), [copy.id, outside] as const);
      expect((r as { ok: boolean }).ok).toBe(true);
      expect(JSON.stringify(await deckGet(page, id))).toBe(before);
    });
  });

  test('6: draft night: three closed boosters, OPEN DRAFT TABLE, lobby settings equal the booster setup', async ({ page }, info) => {
    test.setTimeout(90_000);
    const project = info.project.name;
    await openSite(page, profile(info, 'draft'), '/');
    await expect(page.getByTestId('route-home')).toBeVisible();
    await mode(page, 'draft');
    await expect(page.getByTestId('home-hero')).toHaveAttribute('data-hero', 'boosters');
    await expect(page.getByTestId('home-hero')).toContainText('M19');
    await expect(page.getByTestId('hero-name')).toHaveCount(0);
    await shot(page, MS, '14-draft-night', project);
    const prefs = (await page.evaluate(() => window.__spellplane!.home!.prefs!())) as { draft: { boosters: { how: string; packs: number; picks: number; sets: string[]; pickTimer: boolean } } } | null;
    await expect(page.getByTestId('home-primary')).toHaveText('OPEN DRAFT TABLE');
    await page.getByTestId('home-primary').click();
    await expect(page.getByTestId('lobby')).toBeVisible({ timeout: 20_000 });
    const b = prefs?.draft.boosters ?? { how: 'pass', packs: 3, picks: 1, sets: ['M19'], pickTimer: true };
    await expect
      .poll(async () => (await state(page)).lobby)
      .toEqual({ draft: { format: 'pass', packs: b.packs, picks: b.picks }, sets: b.sets.length ? b.sets : ['M19'], pickTimer: b.pickTimer });
    expect((await state(page)).settings.autoSetup).toBe(true);
    await shot(page, MS, '15-draft-waiting-room', project);
  });

  test('7: leave and rejoin; the copy with more moves wins; bring Cy back', async ({ browser }, info) => {
    test.setTimeout(240_000);
    const project = info.project.name;
    const { context, list } = await pages(browser, 3);
    const [a0, b0, c0] = list as [Page, Page, Page];
    let a = a0;
    let b = b0;
    const profiles = { a: profile(info, 'ann'), b: profile(info, 'ben'), c: profile(info, 'cy') };
    const room = { roomId: `gate-${crypto.randomBytes(4).toString('hex')}-7`, roomKey: crypto.randomBytes(16).toString('base64url') };
    const tableHash = `/t/${room.roomId}/${room.roomKey}`;
    const dispatch = (p: Page, action: unknown) => p.evaluate((x) => window.__spellplane!.dispatch!(x as never), action);
    const leaveTable = async (p: Page) => {
      await p.evaluate(async () => {
        await window.__spellplane!.session!.saved();
        await window.__spellplane!.session!.leave!();
      });
      await p.close();
    };
    const join = async (who: string, hash: string): Promise<Page> => {
      const p = await context.newPage();
      await openSite(p, who, hash);
      await expect.poll(() => p.evaluate(() => window.__spellplane?.net?.status() ?? 'none'), { timeout: 20_000 }).toMatch(/connected|alone/);
      return p;
    };
    try {
      await test.step('three players in a 4 FFA: decks, seven cards each, play to turn 3', async () => {
        // Ann creates the table and makes it a four-player free-for-all before the others sit down.
        await openSite(a, profiles.a, tableHash);
        await expect.poll(() => a.evaluate(() => window.__spellplane?.session?.seat() ?? ''), { timeout: 20_000 }).toBe('s0');
        await dispatch(a, { type: 'formatSet', format: 'ffa4', life: 20, by: 's0', cid: 'x' });
        await expect.poll(async () => (await state(a)).format).toBe('ffa4');
        for (const [p, who] of [
          [b, profiles.b],
          [c0, profiles.c],
        ] as const) {
          await openSite(p, who, tableHash);
          await expect.poll(() => p.evaluate(() => window.__spellplane?.session?.seat() ?? ''), { timeout: 20_000 }).toMatch(/^s\d$/);
        }
        await expect.poll(async () => Object.values((await state(a)).seats).filter((s) => s.peer !== undefined).length, { timeout: 20_000 }).toBe(3);
        for (const [p, file] of [
          [a, 'gw-m19-60.txt'],
          [b, 'ur-m19-60.mtga.txt'],
          [c0, 'gw-m19-60.txt'],
        ] as const)
          await p.evaluate((t) => window.__spellplane!.session!.importDecklist(t), decklist(file));
        await dispatch(a, { type: 'stageSet', stage: 'match', by: 's0', cid: 'x' });
        for (const p of [a, b, c0]) await expect.poll(async () => (await state(p)).stage, { timeout: 20_000 }).toBe('match');
        await Promise.all([a, b, c0].map((p) => p.evaluate(() => window.__spellplane!.session!.shuffle())));
        for (const p of [a, b, c0]) await p.evaluate(() => window.__spellplane!.session!.draw(7));
        await sameHash([a, b, c0]);
        // Play to turn 3: the turn passes around the table twice.
        for (let t = 0; t < 2; t++)
          for (const [p, seat, next] of [
            [a, 's0', 's1'],
            [b, 's1', 's2'],
            [c0, 's2', 's0'],
          ] as const)
            await dispatch(p, { type: 'turnPass', to: next, by: seat, cid: 'x' });
        await sameHash([a, b, c0]);
      });
      await test.step('Cy leaves; Ann and Ben play on; Ann leaves; Ben plays on and leaves', async () => {
        await leaveTable(c0);
        await expect.poll(async () => (await state(a)).seats.s2!.away === true, { timeout: 15_000 }).toBe(true);
        for (let i = 0; i < 2; i++) await dispatch(a, { type: 'life', seat: 's0', delta: -1, by: 's0', cid: 'x' });
        await sameHash([a, b]);
        await leaveTable(a);
        for (let i = 0; i < 5; i++) await dispatch(b, { type: 'life', seat: 's1', delta: -1, by: 's1', cid: 'x' });
        await expect.poll(async () => (await state(b)).seats.s1!.life, { timeout: 10_000 }).toBe(15);
        await leaveTable(b);
      });
      let benHash = '';
      await test.step('Ann returns (Gathering waits for Ben) and writes four chat lines; Ben returns: both live on Ben’s copy', async () => {
        a = await join(profiles.a, tableHash);
        await expect(a.getByTestId('gathering-card')).toBeVisible({ timeout: 20_000 });
        // It waits for Ben, whose copy is the newest one Ann has heard of.
        await expect(a.getByTestId('gathering-card')).toContainText((await state(a)).seats.s1!.name);
        await shot(a, MS, '16-gathering', project);
        for (let i = 0; i < 4; i++) await dispatch(a, { type: 'chat', text: `line ${i + 1}`, channel: 'table', by: 's0', cid: 'x' });
        b = await join(profiles.b, tableHash);
        await expect.poll(() => a.evaluate(() => window.__spellplane!.session!.muster!().live), { timeout: 30_000 }).toBe(true);
        await expect.poll(() => b.evaluate(() => window.__spellplane!.session!.muster!().live), { timeout: 30_000 }).toBe(true);
        benHash = await sameHash([a, b]);
        expect((await state(a)).seats.s1!.life).toBe(15);
      });
      await test.step('Cy’s browser is lost; Ann brings Cy back from his plate menu; Cy sits down and recovers', async () => {
        const link = await a.evaluate(async () => {
          window.__spellplane!.net!.setClock!(Date.now() + 31_000);
          try {
            return await window.__spellplane!.session!.invite!('s2');
          } finally {
            window.__spellplane!.net!.setClock!(null);
          }
        });
        expect(link).toMatch(/\/rejoin\/s2\//);
        const c = await join(profile(info, 'cy-blank'), link.slice(link.indexOf('#') + 1));
        await expect(c.getByTestId('claim-page')).toBeVisible({ timeout: 30_000 });
        await c.getByTestId('claim-sit').click();
        await expect.poll(() => c.evaluate(() => window.__spellplane?.session?.seat() ?? null), { timeout: 20_000 }).toBe('s2');
        await expect(c.getByTestId('recovery')).toBeVisible({ timeout: 20_000 });
        const h = await sameHash([a, b, c]);
        expect(h).not.toBe('');
        expect(benHash).not.toBe('');
        for (const p of [a, b, c]) expect((await games(p))[0]?.code).toBe(room.roomId);
        // The leak scanner over all three pages: nobody's hidden cards reach another page.
        const hidden = async (p: Page) => {
          const s = await state(p);
          const sec = await secrets(p);
          const shown = new Set(Object.values(s.cards).flatMap((x) => (x.identity ? [x.identity.sid] : [])));
          return Object.entries(sec.identities).flatMap(([id, x]) => (s.cards[id]?.identity ? [] : [x.salt, ...(shown.has(x.card.sid) ? [] : [x.card.sid])]));
        };
        const all = [a, b, c];
        for (const owner of all) {
          const tokens = await hidden(owner);
          for (const other of all) {
            if (other === owner) continue;
            const seen = [await hook(other, 'net.messages'), await state(other)];
            expect(scan(seen, tokens)).toEqual([]);
          }
        }
      });
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
    });
    await test.step('Decks and the deck page', async () => {
      await importDeck(page, 'gw-m19-60.txt');
      await navTo(page, 'DECKS');
      await expect(page.getByTestId('deck-library')).toBeVisible();
      await check('Decks');
      await page.locator('[data-testid="deck-tile"]').first().dblclick();
      await expect(page.getByTestId('deck-page')).toBeVisible();
      await check('the deck page');
    });
    await test.step('History', async () => {
      await page.evaluate(() => (location.hash = '#/history'));
      await expect(page.getByTestId('route-history')).toBeVisible();
      await check('History');
    });
    await test.step('the waiting room', async () => {
      await page.evaluate(() => (location.hash = '#/'));
      await mode(page, 'private');
      await page.getByTestId('home-primary').click();
      await expect(page.getByTestId('lobby')).toBeVisible({ timeout: 20_000 });
      await check('the waiting room');
    });
    await test.step('the table HUD (a practice table)', async () => {
      await page.evaluate(() => (location.hash = '#/'));
      await mode(page, 'solo');
      await page.getByTestId('opt-opponent').getByRole('radio', { name: 'ALONE' }).click();
      await page.getByTestId('home-primary').click();
      await expect(page.getByTestId('table-frame')).toBeVisible({ timeout: 30_000 });
      await expect(page.getByTestId('primary-action')).toBeVisible({ timeout: 20_000 });
      await check('the table HUD', '[data-testid="hud"]');
    });
  });
});
