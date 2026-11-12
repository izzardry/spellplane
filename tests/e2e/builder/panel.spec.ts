/**
 * The builder's readout, dispenser, Ready and view switch in real browsers (DESIGN "Pre-game: draft, sealed and deck
 * building", Deck building: "a basic-land dispenser hands out unlimited basics of any chosen printing. A live readout
 * shows card count, mana curve, colour split and land count"; "The limited minimum of 40 cards is shown as a hint, not
 * enforced. Ready locks the deck and publishes its commitment"; "Two views of the same pool, switchable at any time").
 * PLAN M2-P5 acceptance: the stats readout matches a hand-computed fixture pool; with M2-P6: a deck built in the table
 * view appears identically in the list view and back.
 */
import { expect, test, type Page } from '@playwright/test';
import fs from 'node:fs';
import type { CardRef, DeckBuild } from '../../../src/core/types';
import type { CardData } from '../../../src/data/types';
import { columnOf, columnX } from '../../../src/scene/builder';
import { bh, centre, dragFromTo, free, openBuilder, screenOf, settled } from './bundle';

const CARDS = JSON.parse(fs.readFileSync('tests/fixtures/scryfall/m19.json', 'utf8')) as CardData[];
const DATA = new Map(CARDS.map((c) => [c.id, c]));
const lookup = (ref: CardRef): CardData | null => DATA.get(ref.sid) ?? null;
const sid = (name: string): string => CARDS.find((c) => c.name === name)!.id;

async function build(page: Page): Promise<DeckBuild> {
  const b = await bh(page, 'build');
  if (!b) throw new Error('no build');
  return b;
}

/** The readout as the page shows it. */
async function readout(page: Page): Promise<{ cards: string | null; lands: string | null; curve: string | null; colours: string | null; below: string | null; hint: string }> {
  return {
    cards: await page.getByTestId('stats-cards').getAttribute('data-value'),
    lands: await page.getByTestId('stats-lands').getAttribute('data-value'),
    curve: await page.getByTestId('stats-curve').getAttribute('data-values'),
    colours: await page.getByTestId('stats-colours').getAttribute('data-values'),
    below: await page.getByTestId('stats-hint').getAttribute('data-below'),
    hint: (await page.getByTestId('stats-hint').textContent())!.trim(),
  };
}

/**
 * The hand-computed pool of tests/unit/builder/stats.test.ts (costs from tests/fixtures/scryfall/m19.json). Deck:
 * Llanowar Elves ×2 {G}, Draconic Disciple {1}{R}{G}, Sarkhan, Fireblood {1}{R}{R}, Shock {R}, Lightning Mare {R}{R},
 * Volcanic Dragon {4}{R}{R}, Colossal Dreadmaw {4}{G}{G}, Gigantosaurus {G}{G}{G}{G}{G}, Meteor Golem {7}, Banefire
 * {X}{R}, Skyscanner {3}, Nicol Bolas, the Ravager (front {1}{U}{B}{R}); lands Rupture Spire, Detection Tower, Mountain,
 * Forest ×3, Mountain ×2. Sideboard: Divination, Cancel, Murder, Phylactery Lich, Island.
 * By hand: 21 cards, 8 lands; curve 0·4·1·3·1·1·2·1; W0 U1 B1 R10 G10 C0.
 */
function handComputed(): DeckBuild {
  const names = [
    'Llanowar Elves',
    'Llanowar Elves',
    'Draconic Disciple',
    'Sarkhan, Fireblood',
    'Shock',
    'Lightning Mare',
    'Volcanic Dragon',
    'Colossal Dreadmaw',
    'Gigantosaurus',
    'Meteor Golem',
    'Banefire',
    'Skyscanner',
    'Nicol Bolas, the Ravager // Nicol Bolas, the Arisen',
    'Rupture Spire',
    'Detection Tower',
    'Mountain',
    'Forest',
    'Forest',
    'Forest',
    'Mountain',
    'Mountain',
    'Divination',
    'Cancel',
    'Murder',
    'Phylactery Lich',
    'Island',
  ];
  const cards = names.map((n, i) => ({ id: `h${i + 1}`, ref: { sid: sid(n) } }));
  return { cards, main: cards.slice(0, 21).map((c) => c.id) };
}

test.describe('the readout (PLAN M2-P5 acceptance: matches a hand-computed fixture pool)', () => {
  test('shows card count, land count, curve and colour split of the deck, live as cards move', async ({ page }) => {
    await openBuilder(page);
    await settled(page);
    await bh(page, 'setBuild', handComputed());
    await expect.poll(() => readout(page)).toEqual({ cards: '21', lands: '8', curve: '0,4,1,3,1,1,2,1', colours: 'W0,U1,B1,R10,G10,C0', below: 'true', hint: '40-card minimum: 19 to go' });
    await settled(page);
    // The table shows the same split: 21 in the deck area, 5 in the sideboard area.
    const cards = await bh(page, 'cards');
    expect(cards.filter((c) => c.area === 'deck')).toHaveLength(21);
    expect(cards.filter((c) => c.area === 'side').map((c) => c.id).sort()).toEqual(['h22', 'h23', 'h24', 'h25', 'h26']);

    // Divination {2}{U} into the deck (it lies below Cancel in the blue column): one more card, one more at mana
    // value 3, one more blue symbol.
    const at = await centre(page, 'h22');
    await page.mouse.dblclick(at.x, at.y);
    await settled(page);
    expect((await build(page)).main).toContain('h22');
    await expect.poll(() => readout(page)).toMatchObject({ cards: '22', lands: '8', curve: '0,4,1,4,1,1,2,1', colours: 'W0,U2,B1,R10,G10,C0', hint: '40-card minimum: 18 to go' });
    // And a deck land out: one card and one land fewer.
    const land = (await free(page, 'deck')).find((c) => /\bLand\b/.test(lookup(c.ref)!.type_line))!;
    const q = await centre(page, land.id);
    await page.mouse.dblclick(q.x, q.y);
    await settled(page);
    await expect.poll(() => readout(page)).toMatchObject({ cards: '21', lands: '7', curve: '0,4,1,4,1,1,2,1', colours: 'W0,U2,B1,R10,G10,C0' });
  });

  test('the 40-card minimum is a hint: it counts down to 40 and is met at 40', async ({ page }) => {
    await openBuilder(page, { pool: 'sealed' });
    await settled(page);
    const b = await build(page);
    await bh(page, 'setBuild', { ...b, main: b.cards.slice(0, 39).map((c) => c.id) });
    await expect.poll(() => readout(page)).toMatchObject({ cards: '39', below: 'true', hint: '40-card minimum: 1 to go' });
    await bh(page, 'setBuild', { ...b, main: b.cards.slice(0, 40).map((c) => c.id) });
    await expect.poll(() => readout(page)).toMatchObject({ cards: '40', below: 'false', hint: '40-card minimum reached' });
    await bh(page, 'setBuild', { ...b, main: b.cards.slice(0, 47).map((c) => c.id) });
    await expect.poll(() => readout(page)).toMatchObject({ cards: '47', below: 'false' });
  });
});

test.describe('the basic-land dispenser (unlimited basics of any chosen printing)', () => {
  test('hands out basics of the chosen printing into the deck; − and a drop in the sideboard hand them back', async ({ page }) => {
    await openBuilder(page);
    await settled(page);
    const row = page.locator('[data-testid="dispenser-row"][data-basic="Forest"]');
    const printing = row.getByTestId('dispenser-printing');
    // Every M19 Forest printing is on offer, by collector number.
    const forests = CARDS.filter((c) => c.name === 'Forest').sort((a, b) => Number(a.collector_number) - Number(b.collector_number));
    await expect(printing.locator('option')).toHaveCount(forests.length);
    const chosen = forests[2]!;
    await printing.selectOption(chosen.id);
    const lands0 = Number(await page.getByTestId('stats-lands').getAttribute('data-value'));
    const n0 = (await build(page)).cards.length;

    for (let i = 0; i < 3; i++) await row.getByTestId('dispenser-add').click();
    await settled(page);
    let b = await build(page);
    const dispensed = b.cards.filter((c) => c.basic);
    expect(b.cards).toHaveLength(n0 + 3);
    expect(dispensed).toHaveLength(3);
    expect(dispensed.every((c) => c.ref.sid === chosen.id && !c.ref.foil)).toBe(true);
    expect(b.main).toEqual(dispensed.map((c) => c.id));
    await expect(row.getByTestId('dispenser-count')).toHaveText('3');
    await expect(page.getByTestId('stats-lands')).toHaveAttribute('data-value', String(lands0 + 3));
    // They lie in the deck area, in the lands column, as a cascade.
    const onTable = (await bh(page, 'cards')).filter((c) => c.basic);
    expect(onTable.every((c) => c.area === 'deck' && Math.abs(c.pose.x - columnX(columnOf(lookup(c.ref), 'colour').index)) < 1e-6)).toBe(true);
    expect(new Set(onTable.map((c) => Math.round(c.pose.y))).size).toBe(3);

    // A second printing for the next one: each basic keeps the printing it was dispensed with.
    await printing.selectOption(forests[0]!.id);
    await row.getByTestId('dispenser-add').click();
    await settled(page);
    b = await build(page);
    expect(b.cards.filter((c) => c.basic).map((c) => c.ref.sid)).toEqual([chosen.id, chosen.id, chosen.id, forests[0]!.id]);

    // − returns the latest dispensed copy.
    await row.getByTestId('dispenser-remove').click();
    await expect(row.getByTestId('dispenser-count')).toHaveText('3');
    b = await build(page);
    expect(b.cards.filter((c) => c.basic).map((c) => c.ref.sid)).toEqual([chosen.id, chosen.id, chosen.id]);
    await settled(page);

    // A dispensed basic dropped in the sideboard area goes back to the dispenser: it leaves the pool.
    const last = (await bh(page, 'cards')).filter((c) => c.basic).sort((x, y) => x.pose.y - y.pose.y)[0]!;
    await dragFromTo(page, await centre(page, last.id), await screenOf(page, { x: 300, y: -300 }));
    await settled(page);
    b = await build(page);
    expect(b.cards.some((c) => c.id === last.id)).toBe(false);
    expect(b.cards.filter((c) => c.basic)).toHaveLength(2);
    await expect(row.getByTestId('dispenser-count')).toHaveText('2');
    await expect(page.getByTestId('stats-lands')).toHaveAttribute('data-value', String(lands0 + 2));
  });

  test('the lands of a limited deck all stay in sight: two drafted lands and 17 dispensed Forests make one cascade, no hidden pile', async ({ page }) => {
    await openBuilder(page);
    await settled(page);
    const b0 = await build(page);
    const drafted = b0.cards.filter((c) => !c.basic && /\bLand\b/.test(lookup(c.ref)!.type_line)).slice(0, 2);
    expect(drafted).toHaveLength(2);
    await bh(page, 'setBuild', { ...b0, main: drafted.map((c) => c.id) });
    await settled(page);
    const row = page.locator('[data-testid="dispenser-row"][data-basic="Forest"]');
    for (let i = 0; i < 17; i++) await row.getByTestId('dispenser-add').click();
    await settled(page);
    const deck = (await bh(page, 'cards')).filter((c) => c.area === 'deck');
    expect(deck).toHaveLength(19);
    expect(new Set(deck.map((c) => `${c.pose.x.toFixed(2)}:${c.pose.y.toFixed(2)}`)).size).toBe(19);
    expect(deck.every((c) => c.pile?.kind === 'cascade' && c.pile.count === 19 && c.visible)).toBe(true);
    await expect(page.getByTestId('builder-pile-count')).toHaveCount(0);
    await expect(page.locator('[data-testid="builder-column-label"][data-area="deck"][data-column="L"]')).toHaveAttribute('data-count', '19');
  });
});

test.describe('Ready (DESIGN: Ready locks the deck and publishes its commitment)', () => {
  test('commits the deck below the 40-card minimum too (a hint, never enforced) and locks the builder', async ({ page }) => {
    await openBuilder(page);
    await settled(page);
    const b = await build(page);
    const main = b.cards.slice(0, 23).map((c) => c.id);
    await bh(page, 'setBuild', { ...b, main });
    await expect(page.getByTestId('stats-cards')).toHaveAttribute('data-value', '23');
    await settled(page);
    await page.getByTestId('builder-ready').click();
    await expect(page.getByTestId('builder-locked')).toBeVisible();
    await expect(page.getByTestId('builder')).toHaveAttribute('data-locked', 'true');
    const state = await bh(page, 'state');
    expect(state.commitments['s0']!.commits).toHaveLength(23);
    // The identities stay in this browser: the shared state names none of the pool's cards.
    const shared = JSON.stringify(state);
    for (const c of b.cards) expect(shared).not.toContain(c.ref.sid);
    const secrets = await bh(page, 'secrets');
    expect(Object.values(secrets.identities).map((i) => i.card.sid).sort()).toEqual(main.map((id) => b.cards.find((c) => c.id === id)!.ref.sid).sort());
    // The sideboard is the rest of the pool.
    expect((secrets.pool ?? []).map((r) => r.sid).sort()).toEqual(b.cards.slice(23).map((c) => c.ref.sid).sort());

    // Locked: no drag, double-click, sort or dispenser changes the deck any more.
    expect(await bh(page, 'locked')).toBe(true);
    const writes = await bh(page, 'writes');
    const side = (await bh(page, 'cards')).filter((c) => c.area === 'side').at(-1)!;
    await dragFromTo(page, await centre(page, side.id), await screenOf(page, { x: 0, y: 200 }));
    const p = await centre(page, side.id);
    await page.mouse.dblclick(p.x, p.y);
    await page.keyboard.press('2');
    await settled(page);
    expect(await bh(page, 'writes')).toBe(writes);
    expect((await build(page)).main).toEqual(main);
    await expect(page.getByTestId('sort-colour')).toBeDisabled();
    await expect(page.locator('[data-testid="dispenser-row"][data-basic="Island"]').getByTestId('dispenser-add')).toBeDisabled();
    await expect(page.getByTestId('builder-ready')).toHaveCount(0);
  });
});

test.describe('two views of one build (PLAN M2-P5 and P6: a deck built in the table view appears identically in the list view and back)', () => {
  test('switching to the list and back keeps the deck, the sort and every position', async ({ page }) => {
    await openBuilder(page);
    await settled(page);
    await page.keyboard.press('3');
    await settled(page);
    // Two cards into the deck in the table view.
    const two = (await free(page)).slice(-2);
    for (const c of two) {
      const p = await centre(page, c.id);
      await page.mouse.dblclick(p.x, p.y);
      await settled(page);
    }
    const before = await build(page);
    expect([...before.main].sort()).toEqual(two.map((c) => c.id).sort());

    await page.getByTestId('view-list').click();
    await expect(page.getByTestId('builder-list')).toBeVisible();
    await expect(page.getByTestId('builder')).toHaveAttribute('data-view', 'list');
    await expect(page.getByTestId('list-deck-count')).toHaveText('2');
    await expect(page.getByTestId('list-pool-count')).toHaveText('43');
    // The list follows the table's sort.
    await expect(page.getByTestId('list-sort')).toHaveValue('type');
    // The readout stays beside the list.
    await expect(page.getByTestId('stats-cards')).toHaveAttribute('data-value', '2');

    // One pool card into the deck from the list.
    const row = page.getByTestId('list-pool').getByTestId('list-row').first();
    const movedSid = await row.getAttribute('data-sid');
    await row.locator('button.main').click();
    await expect(page.getByTestId('list-deck-count')).toHaveText('3');
    const listed = await build(page);
    const moved = listed.main.find((id) => !before.main.includes(id))!;
    expect(listed.cards.find((c) => c.id === moved)!.ref.sid).toBe(movedSid);

    await page.getByTestId('view-table').click();
    await expect(page.getByTestId('builder')).toHaveAttribute('data-view', 'table');
    await settled(page);
    const after = await bh(page, 'cards');
    // The table shows the list's deck: the moved card in the deck area, every other card where it lay.
    expect(after.filter((c) => c.area === 'deck').map((c) => c.id).sort()).toEqual([...two.map((c) => c.id), moved].sort());
    for (const c of after) {
      if (c.id === moved) continue;
      const was = before.poses![c.id]!;
      expect(c.pose.x).toBeCloseTo(was.x, 6);
      expect(c.pose.y).toBeCloseTo(was.y, 6);
    }
    await expect(page.getByTestId('stats-cards')).toHaveAttribute('data-value', '3');
    // And back again: the same build, nothing re-laid by the switch itself.
    const once = await build(page);
    await page.getByTestId('view-list').click();
    await expect(page.getByTestId('list-deck-count')).toHaveText('3');
    await page.getByTestId('view-table').click();
    await settled(page);
    expect(await build(page)).toEqual(once);
  });
});
