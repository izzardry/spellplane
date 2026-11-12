/**
 * Gate M2-G (docs/PLAN.md, Milestone 2): two pages run a full evening on fixtures. Ann (s0, host) and Ben (s1) open one
 * table link on the broadcast transport (`?transport=local`, distinct `?profile=`, recorded Scryfall card data and
 * MTGJSON booster data injected before load, `?faces=placeholder`) and:
 *
 * 1. choose an M19 booster draft of three packs each in the lobby settings panel and start it;
 * 2. draft all three packs, every pick marked with the arrow keys and confirmed with Enter (DESIGN "Pre-game: draft,
 *    sealed and deck building", Drafting interaction), watching the waiting indicator;
 * 3. each build a 40-card deck in the builder: 23 spells moved from the pool in the list view, 17 basics from the
 *    dispenser (one printing chosen in its picker), the table view sorted by colour, mana value and type (keys 1, 2, 3),
 *    the stats readout at 40 cards and 17 lands, then Ready;
 * 4. play a short scripted game (S shuffles, Shift+D draws seven, a land dragged from the hand onto the battlefield);
 * 5. return to the builder ("Next game" in the evening bar, confirmed in the HUD's prompt), swap a sideboard card in the
 *    list view, Ready, and start game two;
 * 6. a new draft ("New draft", confirmed) opens six sealed packs each; a further new draft from the builder runs a
 *    two-seat Rochester draft of one pack each on the shared table, in snake order with a rotating opener.
 *
 * The draft's hidden packs go through the shared leak scan (tests/leak/draft.ts): nothing a page received, holds in
 * state or keeps in its secret store or view names a card of the other seat's packs that it never held (its salt, its
 * Scryfall id unless the page legitimately knows that printing, its instance-to-card mapping), nor the other seat's pack
 * seed owner nonces. What a page may know is derived from the other side only: each remainder its owner passed on.
 *
 * Engine behaviour is asserted on state hashes and the debug hook (`state`, `secrets`, `draft.view`, `draft.build`,
 * `net.messages`), never on pixels. Screenshots are review evidence in artifacts/shots/M2/: lobby settings, pick in
 * progress, waiting indicator, Rochester table, builder table sorted three ways, list view, stats readout.
 *
 * Like the M1 gate, the evening is one test whose steps are recorded: a failed step is listed and the evening goes on
 * where it can, so one run shows every gap; the test fails if any step failed. BroadcastChannel joins pages of one
 * browser context only, so both players share a context and are kept apart by their profiles (namespaced IndexedDB,
 * own key pair). Fallbacks to the debug hook, where the UI path failed, are listed in `failures`.
 */
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import type { RevealedCard } from '../../src/core/commit';
import { rochesterOrder } from '../../src/core/drafting';
import type { CardRef, DeckBuild, PackRecord, SecretStore, Stage, TableState } from '../../src/core/types';
import type { CardData, SetData } from '../../src/data/types';
import type { DraftPrivateView } from '../../src/draft/types';
import type { NetMessageRecord } from '../../src/net/types';
import { columnOf, columnX } from '../../src/scene/builder';
import type { SceneDebugCard } from '../../src/scene/table-scene';
import type { BuilderSort } from '../../src/scene/types';
import { packLeakScan } from '../leak/draft';
import { hook, shot } from './helpers/app';
import { freshProfile, freshRoom, open, setNickname } from './lobby/helpers';

const FIXTURE_CARDS = new Map<string, CardData>(
  ['m19.json', 'tm19.json'].flatMap((f) => (JSON.parse(fs.readFileSync(path.join('tests', 'fixtures', 'scryfall', f), 'utf8')) as CardData[]).map((c) => [c.id, c] as const)),
);
const lookup = (ref: CardRef): CardData | null => FIXTURE_CARDS.get(ref.sid) ?? null;
const isLand = (c: CardData | null): boolean => !!c && /\bLand\b/.test(c.type_line);
const BASIC_OF: Record<string, string> = { W: 'Plains', U: 'Island', B: 'Swamp', R: 'Mountain', G: 'Forest' };

/** An init script that sets window.__spellplaneSets to the recorded M19 booster data (the app then never fetches MTGJSON). */
let setsScriptText: string | null = null;
function setsScript(): string {
  if (setsScriptText === null) {
    const raw = JSON.parse(fs.readFileSync(path.join('tests', 'fixtures', 'mtgjson', 'M19.json'), 'utf8')) as {
      data: { code: string; name: string; releaseDate: string; booster: Record<string, SetData['booster']>; cards: SetData['cards'] };
    };
    const d = raw.data;
    const set: SetData = { code: d.code, name: d.name, releaseDate: d.releaseDate, boosterType: 'draft', booster: d.booster.draft!, cards: d.cards };
    setsScriptText = `window.__spellplaneSets = ${JSON.stringify([set])};`;
  }
  return setsScriptText;
}

type Seat = 's0' | 's1';
interface Player {
  name: string;
  seat: Seat;
  profile: string;
  page: Page;
}
/** One confirmed pick as its picker saw it: the front pack before the pick and the cards taken. */
interface PickRec {
  seat: Seat;
  packId: string;
  before: string[];
  picked: string[];
}

const state = (page: Page) => hook<TableState>(page, 'state');
const secrets = (page: Page) => hook<SecretStore>(page, 'secrets');
const view = (page: Page) => hook<DraftPrivateView | null>(page, 'draft.view');
const build = (page: Page) => hook<DeckBuild | null>(page, 'draft.build');
const shown = (page: Page) => hook<SceneDebugCard[]>(page, 'cards');
const hashOf = (page: Page) => page.evaluate(() => (window.__spellplane as unknown as { session: { hash(): Promise<string> } }).session.hash());
const hasPart = (page: Page, part: string, fn: string) =>
  page.evaluate(([p, f]) => typeof ((window.__spellplane as unknown as Record<string, Record<string, unknown> | undefined> | undefined)?.[p!]?.[f!]) === 'function', [part, fn] as const);
/** The deck as a build holds it (the builder table adds card positions of its own). */
const deckOf = (b: DeckBuild | null) => (b === null ? null : { cards: b.cards, main: b.main });

const STAGE_VIEW: Record<Stage, string> = { lobby: 'lobby', draft: 'draft', build: 'builder', match: 'hud' };

function firstLine(e: unknown): string {
  const text = e instanceof Error ? e.message : String(e);
  // eslint-disable-next-line no-control-regex
  return text.replace(/\u001b\[[0-9;]*m/g, '').split('\n').filter((l) => l.trim()).slice(0, 3).join(' | ');
}

async function frames(page: Page): Promise<void> {
  await page.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))));
}

/** Nothing focused, so Enter reaches the page's key handler rather than a button. */
async function blur(page: Page): Promise<void> {
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
}

async function inStage(page: Page, stage: Stage): Promise<void> {
  await expect(page.getByTestId('stage')).toHaveAttribute('data-stage', stage, { timeout: 30_000 });
  await expect(page.getByTestId(STAGE_VIEW[stage])).toBeVisible({ timeout: 30_000 });
}

/** Wait until both pages report the same state hash. */
async function converged(a: Page, b: Page): Promise<string> {
  let h = '';
  await expect
    .poll(
      async () => {
        const [x, y] = await Promise.all([hashOf(a), hashOf(b)]);
        h = x;
        return x === y;
      },
      { timeout: 20_000 },
    )
    .toBe(true);
  return h;
}

/** Choose a value in a lobby number field (typed, then blurred, as the panel commits it). */
async function fillNumber(page: Page, testId: string, value: number): Promise<void> {
  const input = page.getByTestId(testId);
  await input.fill(String(value));
  await input.blur();
}

test.describe('M2 gate @gate', () => {
  test.use({ actionTimeout: 10_000 });

  test('a full draft evening: booster draft, builds, two games, sealed and Rochester, and the leak scan finds nothing', async ({ browser }, info) => {
    test.setTimeout(1_200_000);
    const project = info.project.name;
    const failures: string[] = [];
    /** Steps the UI could not reach that the gate drove through the debug hook instead. */
    const gaps: string[] = [];
    const errors: string[] = [];
    const outside: string[] = [];

    const step = async (title: string, fn: () => Promise<void>): Promise<boolean> => {
      try {
        await test.step(title, fn);
        return true;
      } catch (e) {
        failures.push(`${title}: ${firstLine(e)}`);
        return false;
      }
    };
    const soft = async (title: string, fn: () => Promise<void>): Promise<void> => {
      try {
        await fn();
      } catch (e) {
        failures.push(`${title}: ${firstLine(e)}`);
      }
    };
    const finish = async () => {
      if (errors.length || outside.length) failures.push(`page errors: ${JSON.stringify(errors.slice(0, 5))}; outside requests: ${JSON.stringify(outside.slice(0, 5))}`);
      await info.attach('gate-gaps.json', { body: JSON.stringify({ failures, gaps }, null, 2), contentType: 'application/json' });
      fs.mkdirSync(path.join('artifacts', 'gate'), { recursive: true });
      fs.writeFileSync(path.join('artifacts', 'gate', `M2-${project}.json`), JSON.stringify({ failures, gaps }, null, 2));
      await context.close();
      expect(failures).toEqual([]);
    };

    const context: BrowserContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    context.setDefaultTimeout(10_000);
    await context.addInitScript({ content: setsScript() });
    const newPage = async (who: string) => {
      const p = await context.newPage();
      p.on('pageerror', (e) => errors.push(`${who}: ${e.message}`));
      p.on('request', (r) => {
        if (!/^(data|blob):/.test(r.url()) && !new URL(r.url()).hostname.match(/^(localhost|127\.0\.0\.1)$/)) outside.push(r.url());
      });
      return p;
    };
    const room = freshRoom();
    const A: Player = { name: 'Ann', seat: 's0', profile: freshProfile(info, 'm2a'), page: await newPage('Ann') };
    const B: Player = { name: 'Ben', seat: 's1', profile: freshProfile(info, 'm2b'), page: await newPage('Ben') };
    const both = [A, B];
    const other = (p: Player) => (p === A ? B : A);
    const focus = async (p: Player) => {
      await p.page.bringToFront();
      await blur(p.page);
    };

    // ------------------------------------------------------------------------------------------------------------
    // Lobby: both join; the host chooses an M19 booster draft of three packs each in the lobby settings panel.
    // ------------------------------------------------------------------------------------------------------------
    const lobbyOk = await step('lobby: both join; Ann chooses an M19 booster draft of three packs each; Ben sees it read-only', async () => {
      for (const p of both) {
        await open(p.page, `/t/${room.roomId}/${room.roomKey}`, { profile: p.profile, transport: 'local' });
        await expect(p.page.getByTestId('lobby')).toBeVisible({ timeout: 15_000 });
        await setNickname(p.page, p.name);
      }
      await expect(A.page.getByTestId('stage'), 'the stage switch (ui/flow/Stage.svelte, M2-P7) is mounted').toHaveAttribute('data-stage', 'lobby');
      for (const p of both) await expect.poll(() => hasPart(p.page, 'draft', 'view'), { message: 'debug hook draft part (M2-P7 session wiring)' }).toBe(true);
      await expect.poll(() => hook<string>(B.page, 'session.seat')).toBe('s1');
      await expect(A.page.getByTestId('lobby-settings')).toHaveAttribute('data-editable', 'true');
      await expect(B.page.getByTestId('lobby-settings')).toHaveAttribute('data-editable', 'false');
      await A.page.getByTestId('lobby-mode').selectOption('booster');
      await expect(A.page.getByTestId('lobby-set')).toHaveValue('M19');
      await fillNumber(A.page, 'lobby-packs', 3);
      await fillNumber(A.page, 'lobby-picks', 1);
      await expect.poll(async () => (await state(B.page)).lobby).toEqual({ draft: { format: 'pass', packs: 3, picks: 1 }, sets: ['M19'], pickTimer: false });
      await expect(B.page.getByTestId('lobby-packs')).toHaveValue('3');
      await expect(B.page.getByTestId('start-draft')).toHaveCount(0);
      await expect(A.page.getByTestId('start-draft')).toBeEnabled();
      await shot(A.page, 'M2', 'lobby-settings', project);
    });
    if (!lobbyOk) return finish();

    // ------------------------------------------------------------------------------------------------------------
    // Draft helpers: a pick by the keyboard (ArrowRight marks the first card, Enter confirms).
    // ------------------------------------------------------------------------------------------------------------
    const generated: Record<Seat, Map<string, PackRecord>> = { s0: new Map(), s1: new Map() };
    const packSeen = new Set<string>();
    let keyFallbacks = 0;

    /** The packs `p` generated so far (read whenever a pack id is new to the gate). */
    const noteGenerated = async (p: Player, packId: string) => {
      if (packSeen.has(`${p.seat}:${packId}`)) return;
      packSeen.add(`${p.seat}:${packId}`);
      for (const g of (await secrets(p.page)).draft?.generated ?? []) generated[p.seat].set(g.packId, g);
    };

    /**
     * One pick by `p` if a pack is in front of it and it is its turn: ArrowRight marks the first card, Enter takes it.
     * `beforeEnter` runs with the card marked (for the pick-in-progress screenshot). Null when `p` has nothing to pick.
     */
    const keyPick = async (p: Player, beforeEnter?: () => Promise<void>): Promise<PickRec | null> => {
      const v = await view(p.page);
      if (!v || !v.pack || v.pack.cards.length === 0 || v.picks === 0) return null;
      if (v.pack.public && !v.waitingOn.includes(p.seat)) return null;
      await noteGenerated(p, v.pack.packId);
      const before = v.pack.cards.map((c) => c.id);
      const want = before.slice(0, v.picks);
      const rec: PickRec = { seat: p.seat, packId: v.pack.packId, before, picked: want };
      try {
        expect(v.picks, 'one card per confirm').toBe(1);
        await focus(p);
        if (v.marked.length) await p.page.keyboard.press('Escape');
        await p.page.keyboard.press('ArrowRight');
        await expect.poll(async () => (await view(p.page))?.marked ?? [], { timeout: 5_000 }).toEqual(want);
        if (beforeEnter) await beforeEnter();
        await p.page.keyboard.press('Enter');
        await expect
          .poll(
            async () => {
              const w = await view(p.page);
              return !w || w.pool.length > v.pool.length;
            },
            { timeout: 15_000 },
          )
          .toBe(true);
      } catch (e) {
        // The keyboard path failed: record it, take the pick through the hook so the evening can go on.
        if (keyFallbacks++ === 0) failures.push(`${p.name}'s pick by ArrowRight and Enter did not register (fell back to __spellplane.flow.pick): ${firstLine(e)}`);
        await hook(p.page, 'flow.mark', want);
        expect(await hook<boolean>(p.page, 'flow.pick', want)).toBe(true);
        await expect.poll(async () => {
          const w = await view(p.page);
          return !w || w.pool.length > v.pool.length;
        }).toBe(true);
      }
      return rec;
    };

    // ------------------------------------------------------------------------------------------------------------
    // Booster draft: three packs each, every pick by the keyboard; the waiting indicator; the leak scan.
    // ------------------------------------------------------------------------------------------------------------
    const picks: PickRec[] = [];
    const draftOk = await step('booster draft: Ann starts it; both draft three packs by the keyboard until the builder opens', async () => {
      await A.page.getByTestId('start-draft').click();
      for (const p of both) await inStage(p.page, 'draft');
      await expect.poll(async () => (await view(B.page))?.pack?.cards.length ?? 0, { timeout: 30_000 }).toBeGreaterThan(0);
      await expect(A.page.getByTestId('draft-title')).toContainText('pack 1 of 3');
      let shotPick = false;
      let shotWaiting = false;
      await expect
        .poll(
          async () => {
            for (const p of both) {
              const r = await keyPick(
                p,
                p === A && !shotPick && picks.filter((x) => x.seat === 's0').length === 1
                  ? async () => {
                      shotPick = true;
                      await expect(A.page.getByTestId('draft-confirm')).toBeEnabled();
                      await A.page.waitForTimeout(600);
                      await shot(A.page, 'M2', 'pick-in-progress', project);
                    }
                  : undefined,
              );
              if (r) picks.push(r);
              // Right after Ann's first pick her pack sits with Ben: she waits, and Ben has two packs queued.
              if (r && p === A && !shotWaiting) {
                shotWaiting = true;
                await soft('waiting indicator: Ann waits for Ben, who holds two packs', async () => {
                  await expect(A.page.getByTestId('draft-prompt')).toContainText('Waiting');
                  await expect(A.page.locator('[data-testid="draft-seat"][data-seat="s1"]')).toHaveAttribute('data-packs', '2');
                  await expect(A.page.locator('[data-testid="draft-seat"][data-seat="s1"]')).toHaveAttribute('data-picking', 'true');
                  expect((await view(A.page))?.waitingOn).toEqual(['s1']);
                  await A.page.waitForTimeout(600);
                  await shot(A.page, 'M2', 'waiting-indicator', project);
                });
              }
            }
            return [(await state(A.page)).stage, (await state(B.page)).stage].join();
          },
          { timeout: 600_000, intervals: [100] },
        )
        .toBe('build,build');
      for (const p of both) await inStage(p.page, 'build');
      const packSize = picks.find((x) => x.seat === 's0')!.before.length;
      for (const p of both) {
        expect(picks.filter((x) => x.seat === p.seat)).toHaveLength(3 * packSize);
        expect((await secrets(p.page)).pool).toHaveLength(3 * packSize);
      }
      expect(generated.s0.size).toBe(3);
      expect(generated.s1.size).toBe(3);
      // With two seats every pack goes to the other seat after each pick (left and right are the same seat): its
      // picks alternate, starting with the seat that opened it.
      for (const id of new Set(picks.map((r) => r.packId))) {
        const owner = (['s0', 's1'] as Seat[]).find((s) => generated[s].has(id));
        expect(owner, `pack ${id} has a generating seat`).toBeDefined();
        const seats = picks.filter((r) => r.packId === id).map((r) => r.seat);
        expect(seats).toEqual(seats.map((_, i) => (i % 2 === 0 ? owner : owner === 's0' ? 's1' : 's0')));
      }
    });

    if (draftOk) {
      for (const viewer of both) {
        const owner = other(viewer);
        await step(`leak scan: nothing ${viewer.name}'s page received, holds or shows names a card of ${owner.name}'s packs it never held`, async () => {
          const received = (await hook<NetMessageRecord[]>(viewer.page, 'net.messages')).filter((m) => m.dir === 'in');
          expect(received.length).toBeGreaterThan(0);
          const own = [...generated[viewer.seat].values()].flatMap((g) => g.cards);
          const others = [...generated[owner.seat].values()].flatMap((g) => g.cards);
          // What the viewer may know of the owner's packs: each remainder the owner passed on (owner side only).
          const passed = picks.filter((r) => r.seat === owner.seat).map((r) => r.before.filter((id) => !r.picked.includes(id)));
          const allowed = new Set<string>([...own.map((c) => c.instanceId), ...passed.flat()]);
          const all = new Map<string, RevealedCard>([...own, ...others].map((c) => [c.instanceId, c]));
          const known = [...allowed].map((id) => all.get(id)).filter((c): c is RevealedCard => c !== undefined);
          const report = packLeakScan({
            observed: [received, await state(viewer.page), await secrets(viewer.page), await view(viewer.page)],
            others,
            nonces: [...generated[owner.seat].values()].map((g) => g.ownerNonce),
            allowed,
            known,
          });
          // With two seats the owner's first pick of each own pack never reaches the viewer (three cards).
          expect(report.forbidden).toBeGreaterThan(0);
          expect(report.tokens.slice(0, 10)).toEqual([]);
          expect(report.pairs.slice(0, 10)).toEqual([]);
          // Every pack hand-over the viewer received is a remainder its owner passed on, exactly as it was then.
          const handOvers = received.filter((m) => m.channel === 'prv' && (m.msg as { t?: string }).t === 'pack');
          expect(handOvers.length, 'pack hand-overs captured on the pair channel').toBeGreaterThan(0);
          const remainders = new Set(passed.map((ids) => [...ids].sort().join()));
          for (const m of handOvers) {
            const ids = ((m.msg as { cards?: { instanceId: string }[] }).cards ?? []).map((c) => c.instanceId).sort();
            if (ids.length === 0) continue;
            expect(remainders.has(ids.join()), `hand-over of ${ids.length} cards is one the owner passed on`).toBe(true);
          }
        });
      }
    }
    if (!draftOk) return finish();

    // ------------------------------------------------------------------------------------------------------------
    // Builder: 23 spells from the pool in the list view, 17 basics from the dispenser, sorted three ways, Ready.
    // ------------------------------------------------------------------------------------------------------------
    /** The two colours with the most coloured cards among the build's deck spells. */
    const mainColours = (b: DeckBuild): [string, string] => {
      const n: Record<string, number> = { W: 0, U: 0, B: 0, R: 0, G: 0 };
      for (const id of b.main) {
        const c = lookup(b.cards.find((x) => x.id === id)!.ref);
        for (const col of c?.colors ?? []) if (col in n) n[col]!++;
      }
      const order = Object.entries(n).sort((x, y) => y[1] - x[1]);
      return [order[0]![0], order[1]![0]];
    };
    const deckSize = (b: DeckBuild | null) => b?.main.length ?? 0;

    /** Move one card of the first pool row that is not a land into the deck (list view, a click on the row). */
    const spellToDeck = async (page: Page) => {
      const rows = page.locator('[data-testid="list-pool"] [data-testid="list-row"]');
      const sids = await rows.evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.sid ?? ''));
      const i = sids.findIndex((sid) => !isLand(lookup({ sid })));
      if (i < 0) throw new Error('no spell left in the pool');
      await rows.nth(i).locator('button.main').click();
    };

    const decks: Record<Seat, DeckBuild | null> = { s0: null, s1: null };
    for (const p of both) {
      await step(`${p.name} builds 40 cards: 23 spells in the list view, 17 basics from the dispenser`, async () => {
        const page = p.page;
        await focus(p);
        const fresh = (await build(page))!;
        expect(fresh.cards.length).toBe((await secrets(page)).pool!.length);
        expect(fresh.main).toEqual([]);
        await page.getByTestId('view-list').click();
        await expect(page.getByTestId('builder-list')).toBeVisible();
        await expect(page.getByTestId('list-minimum-hint')).toHaveText('40-card minimum: 40 to go');
        for (let i = 0; i < 23; i++) {
          await spellToDeck(page);
          await expect.poll(async () => deckSize(await build(page))).toBe(i + 1);
        }
        await expect(page.getByTestId('list-deck-count')).toHaveText('23');
        const [c1, c2] = mainColours((await build(page))!);
        const basics: [string, number][] = [
          [BASIC_OF[c1]!, 9],
          [BASIC_OF[c2]!, 8],
        ];
        // The dispenser's printing choice: the second printing of the first basic.
        const [first] = basics[0]!;
        const row0 = page.locator(`[data-testid="dispenser-row"][data-basic="${first}"]`);
        const printing = row0.getByTestId('dispenser-printing');
        const options = await printing.locator('option').evaluateAll((os) => os.map((o) => (o as HTMLOptionElement).value).filter((v) => v !== ''));
        let chosen: string | null = null;
        await soft(`${p.name}'s dispenser offers more than one ${first} printing`, async () => {
          expect(options.length).toBeGreaterThan(1);
          chosen = options[1]!;
          await printing.selectOption(chosen);
        });
        for (const [name, n] of basics) {
          const row = page.locator(`[data-testid="dispenser-row"][data-basic="${name}"]`);
          const had = Number(await row.getByTestId('dispenser-count').textContent());
          for (let i = 0; i < n; i++) await row.getByTestId('dispenser-add').click();
          await expect(row.getByTestId('dispenser-count')).toHaveText(String(had + n));
        }
        const b = (await build(page))!;
        expect(b.main).toHaveLength(40);
        const deckLands = b.main.map((id) => b.cards.find((c) => c.id === id)!).filter((c) => c.basic);
        expect(deckLands).toHaveLength(17);
        if (chosen) expect(deckLands.filter((c) => c.ref.sid === chosen)).toHaveLength(9);
        await expect(page.getByTestId('list-deck-count')).toHaveText('40');
        await expect(page.getByTestId('list-minimum-hint')).toHaveCount(0);
        if (p === A) await shot(page, 'M2', 'list-view', project);
        decks[p.seat] = b;
      });

      await step(`${p.name}'s builder table sorts by colour, mana value and type (keys 1, 2, 3); the readout shows 40 cards and 17 lands`, async () => {
        const page = p.page;
        await page.getByTestId('view-table').click();
        await expect(page.getByTestId('builder')).toHaveAttribute('data-view', 'table');
        await focus(p);
        for (const [key, k, name] of [
          ['manaValue', '2', 'builder-sorted-manavalue'],
          ['type', '3', 'builder-sorted-type'],
          ['colour', '1', 'builder-sorted-colour'],
        ] as [BuilderSort, string, string][]) {
          await page.keyboard.press(k);
          await expect(page.getByTestId(`sort-${key}`)).toHaveAttribute('aria-pressed', 'true');
          await expect
            .poll(async () => {
              const b = (await build(page))!;
              return b.cards.filter((c) => Math.abs((b.poses?.[c.id]?.x ?? NaN) - columnX(columnOf(lookup(c.ref), key).index)) > 0.01).length;
            })
            .toBe(0);
          // Sorting never changes the deck.
          expect(deckOf(await build(page))).toEqual(deckOf(decks[p.seat]));
          if (p === A) {
            await page.waitForTimeout(800);
            await shot(page, 'M2', name, project);
          }
        }
        await expect(page.getByTestId('stats-cards')).toHaveAttribute('data-value', '40');
        await expect(page.getByTestId('stats-lands')).toHaveAttribute('data-value', '17');
        await expect(page.getByTestId('stats-hint')).toHaveAttribute('data-below', 'false');
        const curve = (await page.getByTestId('stats-curve').getAttribute('data-values'))!.split(',').map(Number);
        expect(curve.reduce((s, x) => s + x, 0)).toBe(23);
        if (p === A) await shot(page, 'M2', 'stats-readout', project);
        decks[p.seat] = await build(page);
      });
    }

    const readyBoth = async (game: number) => {
      await A.page.getByTestId('builder-ready').click();
      await expect(A.page.getByTestId('builder-locked')).toBeVisible();
      await expect(A.page.getByTestId('evening-status')).toContainText('Waiting for Ben');
      await B.page.getByTestId('builder-ready').click();
      for (const p of both) await inStage(p.page, 'match');
      await expect.poll(async () => (await state(A.page)).games).toBe(game);
      for (const p of both) await expect.poll(async () => (await secrets(p.page)).libraryOrder.length, { timeout: 15_000 }).toBe(40);
    };

    const game1 = await step('both press Ready: the first game starts with the 40-card decks', () => readyBoth(1));
    if (!game1) return finish();

    // ------------------------------------------------------------------------------------------------------------
    // A short scripted game: shuffle, draw seven, a land onto the battlefield each.
    // ------------------------------------------------------------------------------------------------------------
    const hoverHand = async (page: Page, id: string) => {
      const el = page.locator(`[data-testid="hand-card"][data-card="${id}"]`);
      const box = await el.boundingBox({ timeout: 5000 });
      if (!box) throw new Error(`hand card ${id} is not shown`);
      await page.mouse.move(box.x + box.width / 2, box.y + box.height - 12, { steps: 4 });
      await expect(el).toHaveClass(/hovered/);
    };
    const landInHand = async (page: Page): Promise<string | null> => {
      const sec = await secrets(page);
      return sec.hand.find((id) => isLand(lookup(sec.identities[id]!.card))) ?? null;
    };

    for (const p of both) {
      await step(`game one: ${p.name} shuffles (S), draws seven (Shift+D) and plays a land by dragging it from the hand`, async () => {
        const page = p.page;
        await focus(p);
        await page.mouse.move(720, 330);
        await frames(page);
        const before = (await secrets(page)).libraryOrder;
        await page.keyboard.press('KeyS');
        await expect.poll(async () => (await secrets(page)).libraryOrder).not.toEqual(before);
        await page.keyboard.press('Shift+KeyD');
        await expect(page.getByTestId('draw-n-input')).toBeFocused();
        await page.getByTestId('draw-n-input').fill('7');
        await page.keyboard.press('Enter');
        await expect.poll(async () => (await secrets(page)).hand).toHaveLength(7);
        await expect.poll(async () => (await state(other(p).page)).zones[`hand:${p.seat}`]?.ids.length).toBe(7);
        let land = await landInHand(page);
        for (let i = 0; land === null && i < 10; i++) {
          const n = (await secrets(page)).hand.length;
          await page.mouse.move(720, 330);
          await page.keyboard.press('KeyD');
          await expect.poll(async () => (await secrets(page)).hand.length).toBe(n + 1);
          land = await landInHand(page);
        }
        if (land === null) throw new Error('no land in seventeen draws');
        await hoverHand(page, land);
        const vp = page.viewportSize()!;
        const lb = (await page.locator(`[data-testid="hand-card"][data-card="${land}"]`).boundingBox({ timeout: 5000 }))!;
        await page.mouse.down();
        await page.mouse.move(lb.x + lb.width / 2, vp.height * 0.72, { steps: 6 });
        await page.mouse.move(vp.width * 0.24, vp.height * 0.66, { steps: 12 });
        await page.mouse.up();
        await expect.poll(async () => (await state(page)).cards[land]?.zone).toBe(`battlefield:${p.seat}`);
        const ref = (await secrets(page)).identities[land]!.card;
        await expect.poll(async () => (await state(other(p).page)).cards[land]?.identity).toEqual(ref);
        await expect.poll(async () => (await shown(other(p).page)).some((c) => c.id === land && c.visible)).toBe(true);
      });
    }
    await step('game one: both pages agree on the state hash', async () => {
      await converged(A.page, B.page);
      expect(await state(A.page)).toEqual(await state(B.page));
    });

    // ------------------------------------------------------------------------------------------------------------
    // Back to the builder: Ann proposes the next game, Ben confirms in the HUD's prompt; Ann swaps a sideboard card.
    // ------------------------------------------------------------------------------------------------------------
    const backOk = await step('next game: Ann proposes it in the evening bar, Ben confirms in the HUD prompt; both return to their builds', async () => {
      await A.page.getByTestId('propose-nextGame').click();
      await expect(B.page.getByTestId('confirm-prompt')).toBeVisible({ timeout: 15_000 });
      await B.page.getByTestId('prompt-ok').click();
      for (const p of both) await inStage(p.page, 'build');
      const st = await state(B.page);
      expect(st.cards).toEqual({});
      expect(st.commitments).toEqual({});
      for (const p of both) expect(deckOf(await build(p.page))).toEqual(deckOf(decks[p.seat]));
    });
    if (!backOk) return finish();

    await step('sideboarding: Ann swaps one deck spell for a sideboard spell in the list view', async () => {
      const page = A.page;
      await focus(A);
      await page.getByTestId('view-list').click();
      await expect(page.getByTestId('builder-list')).toBeVisible();
      const before = (await build(page))!;
      const deckRows = page.locator('[data-testid="list-deck"] [data-testid="list-row"]');
      const deckSids = await deckRows.evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.sid ?? ''));
      const out = deckSids.findIndex((sid) => !isLand(lookup({ sid })));
      expect(out).toBeGreaterThanOrEqual(0);
      const outSid = deckSids[out]!;
      await deckRows.nth(out).locator('button.main').click();
      await expect.poll(async () => deckSize(await build(page))).toBe(39);
      const poolRows = page.locator('[data-testid="list-pool"] [data-testid="list-row"]');
      const poolSids = await poolRows.evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.sid ?? ''));
      const into = poolSids.findIndex((sid) => sid !== outSid && !isLand(lookup({ sid })));
      expect(into).toBeGreaterThanOrEqual(0);
      const inSid = poolSids[into]!;
      await poolRows.nth(into).locator('button.main').click();
      await expect.poll(async () => deckSize(await build(page))).toBe(40);
      const after = (await build(page))!;
      const count = (b: DeckBuild, sid: string) => b.main.filter((id) => b.cards.find((c) => c.id === id)!.ref.sid === sid).length;
      expect(count(after, outSid)).toBe(count(before, outSid) - 1);
      expect(count(after, inSid)).toBe(count(before, inSid) + 1);
      expect(after.cards).toEqual(before.cards);
      decks.s0 = after;
    });

    const game2 = await step('game two: both press Ready; the table starts the second game with Ann\'s new deck', async () => {
      await readyBoth(2);
      const sec = await secrets(A.page);
      const sids = [...sec.libraryOrder, ...sec.hand].map((id) => sec.identities[id]!.card.sid).sort();
      const b = decks.s0!;
      expect(sids).toEqual(b.main.map((id) => b.cards.find((c) => c.id === id)!.ref.sid).sort());
      await soft('the evening bar names game two', () => expect(A.page.getByTestId('evening-status')).toHaveText('Game 2.'));
      await converged(A.page, B.page);
    });
    if (!game2) return finish();

    // ------------------------------------------------------------------------------------------------------------
    // Sealed: a new draft from the match opens six packs each.
    // ------------------------------------------------------------------------------------------------------------
    const sealedOk = await step('sealed: a new draft (Ben proposes, Ann confirms in the HUD prompt); Ann opens six sealed packs each', async () => {
      await B.page.getByTestId('propose-newDraft').click();
      await expect(A.page.getByTestId('confirm-prompt')).toBeVisible({ timeout: 15_000 });
      await A.page.getByTestId('prompt-ok').click();
      for (const p of both) await inStage(p.page, 'lobby');
      await expect.poll(async () => 'draft' in (await state(A.page))).toBe(false);
      await A.page.getByTestId('lobby-mode').selectOption('sealed');
      await fillNumber(A.page, 'lobby-packs', 6);
      await expect.poll(async () => (await state(B.page)).lobby?.draft).toEqual({ format: 'sealed', packs: 6 });
      await expect(A.page.getByTestId('start-draft')).toHaveText('Open the sealed pools');
      await A.page.getByTestId('start-draft').click();
      for (const p of both) await inStage(p.page, 'build');
      const packSize = picks.find((x) => x.seat === 's0')!.before.length;
      for (const p of both) {
        await expect.poll(async () => (await secrets(p.page)).pool?.length ?? 0, { timeout: 20_000 }).toBe(6 * packSize);
        const b = (await build(p.page))!;
        expect(b.cards).toHaveLength(6 * packSize);
        expect(b.main).toEqual([]);
      }
      await soft('sealed: shared state counts six packs per pool', async () => {
        expect((await state(A.page)).draft?.pools).toEqual({ s0: 6 * packSize, s1: 6 * packSize });
      });
    });
    if (!sealedOk) return finish();

    // ------------------------------------------------------------------------------------------------------------
    // Rochester: a new draft from the builder; one pack each on the shared table, snake order, rotating opener.
    // ------------------------------------------------------------------------------------------------------------
    const rochesterPicks: PickRec[] = [];
    await step('Rochester: a new draft from the builder (Ann proposes, Ben answers OK in the evening bar); one pack each on the shared table', async () => {
      await A.page.getByTestId('propose-newDraft').click();
      await expect(B.page.getByTestId('evening-ok')).toBeVisible({ timeout: 15_000 });
      await B.page.getByTestId('evening-ok').click();
      for (const p of both) await inStage(p.page, 'lobby');
      await A.page.getByTestId('lobby-mode').selectOption('rochester');
      await fillNumber(A.page, 'lobby-packs', 1);
      await expect.poll(async () => (await state(B.page)).lobby?.draft).toEqual({ format: 'rochester', packs: 1, burn: 0 });
      await A.page.getByTestId('start-draft').click();
      for (const p of both) await inStage(p.page, 'draft');
      await expect.poll(async () => (await view(A.page))?.pack?.public ?? false, { timeout: 30_000 }).toBe(true);
      // The pack lies face up for both: the same cards on both pages.
      const pa = (await view(A.page))!.pack!;
      await expect.poll(async () => (await view(B.page))?.pack?.cards.map((c) => c.id)).toEqual(pa.cards.map((c) => c.id));
      await expect(A.page.getByTestId('draft-pack-label')).toContainText('Shared table');
      await A.page.waitForTimeout(800);
      await shot(A.page, 'M2', 'rochester-table', project);
      await expect
        .poll(
          async () => {
            for (const p of both) {
              const r = await keyPick(p);
              if (r) rochesterPicks.push(r);
            }
            return [(await state(A.page)).stage, (await state(B.page)).stage].join();
          },
          { timeout: 300_000, intervals: [100] },
        )
        .toBe('build,build');
      const packSize = pa.cards.length;
      const pools = (await state(A.page)).draft?.pools;
      expect((pools?.s0 ?? 0) + (pools?.s1 ?? 0)).toBe(2 * packSize);
      for (const p of both) await expect.poll(async () => (await secrets(p.page)).pool?.length ?? 0).toBe(pools?.[p.seat] ?? -1);
      // Snake order with a rotating opener: Ann opens the first pack, Ben the second.
      const packIds = [...new Set(rochesterPicks.map((r) => r.packId))];
      expect(packIds).toHaveLength(2);
      packIds.forEach((id, n) => {
        const order = rochesterOrder(['s0', 's1'], n === 0 ? 's0' : 's1');
        const seats = rochesterPicks.filter((r) => r.packId === id).map((r) => r.seat);
        expect(seats).toEqual(seats.map((_, i) => order[i % order.length]));
      });
    });

    await step('no page error and no request leaves the test server', async () => {
      expect(errors).toEqual([]);
      expect(outside).toEqual([]);
    });
    errors.length = 0;
    outside.length = 0;
    return finish();
  });
});
