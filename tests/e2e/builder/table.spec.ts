/**
 * The builder table in real browsers (DESIGN "Pre-game: draft, sealed and deck building", Deck building: "The pool
 * lies on a private table with the same gestures as play. One key sorts into solitaire columns by colour, mana value
 * or type. A deck area and a sideboard area are marked on the table"; "Card manipulation": free drag, Shift+drag
 * marquee, piles move as one when dragged by their bottom card, double-click). PLAN M2-P5 acceptance: sorting is
 * stable and reversible. Behaviour is asserted on the shared DeckBuild and the surface's debug cards, never on pixels.
 */
import { expect, test, type Page } from '@playwright/test';
import fs from 'node:fs';
import type { CardRef, DeckBuild } from '../../../src/core/types';
import type { CardData } from '../../../src/data/types';
import { BUILDER_LAYOUT, columnOf, columnX, sortLayout, type BuilderDebugCard } from '../../../src/scene/builder';
import type { BuilderSort } from '../../../src/scene/types';
import { bh, centre, dragFromTo, free, openBuilder, screenOf, settled } from './bundle';

const DATA = new Map((JSON.parse(fs.readFileSync('tests/fixtures/scryfall/m19.json', 'utf8')) as CardData[]).map((c) => [c.id, c]));
const lookup = (ref: CardRef): CardData | null => DATA.get(ref.sid) ?? null;

/** Pointer positions are whole pixels: a free drop lands within this many mm of the aimed point. */
const PX_MM = 1.5;

type Layout = Record<string, { x: number; y: number; rot: number }>;

/** Every card's resting pose on the table, rounded to 0.01 mm. */
async function layout(page: Page): Promise<Layout> {
  const out: Layout = {};
  for (const c of await bh(page, 'cards')) out[c.id] = { x: Math.round(c.pose.x * 100) / 100, y: Math.round(c.pose.y * 100) / 100, rot: c.pose.rot };
  return out;
}

function rounded(poses: Layout): Layout {
  return Object.fromEntries(Object.entries(poses).map(([id, p]) => [id, { x: Math.round(p.x * 100) / 100, y: Math.round(p.y * 100) / 100, rot: p.rot }]));
}

async function build(page: Page): Promise<DeckBuild> {
  const b = await bh(page, 'build');
  if (!b) throw new Error('no build');
  return b;
}

/** Drag a card by its centre so its centre lands on a table point. */
async function dragCardTo(page: Page, id: string, to: { x: number; y: number }, opts: { ctrl?: boolean } = {}): Promise<void> {
  await dragFromTo(page, await centre(page, id), await screenOf(page, to), opts);
  await settled(page);
}

/** The first free card of the sideboard area that is not a land (or any, with `land`). */
async function freeOne(page: Page, opts: { land?: boolean } = {}): Promise<BuilderDebugCard> {
  const list = await free(page);
  const c = opts.land ? list[0] : list.find((x) => !/\bLand\b/.test(lookup(x.ref)!.type_line));
  if (!c) throw new Error('no free card');
  return c;
}

async function press(page: Page, key: string): Promise<void> {
  await page.keyboard.press(key);
  await settled(page);
}

test.describe('the builder table (DESIGN "Pre-game", Deck building)', () => {
  test('a fresh pool lies in the sideboard area sorted by colour; a card dragged into the deck area joins the deck', async ({ page }) => {
    const { errors, external } = await openBuilder(page);
    await settled(page);
    const cards = await bh(page, 'cards');
    expect(cards).toHaveLength(45);
    expect(cards.every((c) => c.area === 'side' && !c.inMain && c.visible)).toBe(true);
    // Sorted by colour: each card lies in the column its colour names.
    for (const c of cards) expect(c.pose.x).toBeCloseTo(columnX(columnOf(lookup(c.ref), 'colour').index), 3);
    await expect(page.getByTestId('stats-cards')).toHaveAttribute('data-value', '0');
    await expect(page.getByTestId('stats-hint')).toHaveAttribute('data-below', 'true');
    await expect(page.locator('[data-testid="builder-area-label"][data-area="side"]')).toHaveAttribute('data-count', '45');

    const spell = await freeOne(page);
    await dragCardTo(page, spell.id, { x: 0, y: 200 });
    expect((await build(page)).main).toEqual([spell.id]);
    const moved = (await bh(page, 'cards')).find((c) => c.id === spell.id)!;
    expect(moved).toMatchObject({ area: 'deck', inMain: true });
    // Free drops land where they were let go, up to a screen pixel.
    expect(Math.abs(moved.pose.x)).toBeLessThan(PX_MM);
    expect(Math.abs(moved.pose.y - 200)).toBeLessThan(PX_MM);
    await expect(page.getByTestId('stats-cards')).toHaveAttribute('data-value', '1');
    await expect(page.locator('[data-testid="builder-area-label"][data-area="deck"]')).toHaveAttribute('data-count', '1');
    // A moved card takes the highest draw order.
    expect(moved.order).toBe(44);

    // And back into the sideboard area: out of the deck again, where it was dropped.
    await dragCardTo(page, spell.id, { x: 200, y: -300 });
    expect((await build(page)).main).toEqual([]);
    await expect(page.getByTestId('stats-cards')).toHaveAttribute('data-value', '0');
    // The build carries every card's position, so the other view and a reload see the same table.
    const b = await build(page);
    expect(Object.keys(b.poses ?? {}).sort()).toEqual(b.cards.map((c) => c.id).sort());
    expect(Math.abs(b.poses![spell.id]!.y + 300)).toBeLessThan(PX_MM);
    expect(errors).toEqual([]);
    expect(external).toEqual([]);
  });

  test('a double-click sends a card to the other area; the selection goes across as one', async ({ page }) => {
    await openBuilder(page);
    await settled(page);
    const a = await freeOne(page);
    const at = await centre(page, a.id);
    await page.mouse.dblclick(at.x, at.y);
    await settled(page);
    expect((await build(page)).main).toEqual([a.id]);
    expect((await bh(page, 'cards')).find((x) => x.id === a.id)).toMatchObject({ area: 'deck', inMain: true });

    // The double-click's clicks selected the card; Escape clears that. Shift+click two more, double-click one of
    // them: both go across in one step.
    await page.keyboard.press('Escape');
    expect(await bh(page, 'selection')).toEqual([]);
    const [b2, c] = (await free(page)).slice(-2) as [BuilderDebugCard, BuilderDebugCard];
    for (const id of [b2!.id, c.id]) {
      const p = await centre(page, id);
      await page.keyboard.down('Shift');
      await page.mouse.click(p.x, p.y);
      await page.keyboard.up('Shift');
    }
    expect((await bh(page, 'selection')).sort()).toEqual([b2!.id, c.id].sort());
    await expect(page.getByTestId('builder-selected')).toHaveText('2 selected');
    const writes = await bh(page, 'writes');
    const p = await centre(page, c.id);
    await page.mouse.dblclick(p.x, p.y);
    await settled(page);
    expect((await build(page)).main.sort()).toEqual([a.id, b2!.id, c.id].sort());
    // Two writes at most: the double-click's first click re-selects, the second sends both.
    expect((await bh(page, 'writes')) - writes).toBeLessThanOrEqual(2);

    // Double-click a deck card: back to the sideboard area.
    const q = await centre(page, a.id);
    await page.keyboard.press('Escape');
    await page.mouse.dblclick(q.x, q.y);
    await settled(page);
    expect((await build(page)).main.sort()).toEqual([b2!.id, c.id].sort());
    expect((await bh(page, 'cards')).find((x) => x.id === a.id)!.area).toBe('side');
  });

  test('sorting is stable and reversible (PLAN M2-P5 acceptance)', async ({ page }) => {
    await openBuilder(page);
    await settled(page);
    // A hand-made layout: a few cards into the deck at odd spots, one moved within the sideboard.
    const ids: string[] = [];
    for (const [to, ctrl] of [
      [{ x: -250, y: 250 }, false],
      [{ x: 40, y: 120 }, false],
      [{ x: 300, y: 300 }, true],
      [{ x: 280, y: -300 }, true],
    ] as const) {
      const c = (await free(page))[ids.length * 2]!;
      ids.push(c.id);
      await dragCardTo(page, c.id, to, { ctrl });
    }
    const handMade = await layout(page);
    const b = await build(page);
    expect([...b.main].sort()).toEqual(ids.slice(0, 3).sort());

    for (const [key, k] of [
      ['manaValue', '2'],
      ['type', '3'],
      ['colour', '1'],
    ] as [BuilderSort, string][]) {
      await press(page, k);
      const sorted = await layout(page);
      // Each card in its column, in its area; the layout is the one the sort defines, whatever lay there before.
      expect(sorted).toEqual(rounded(sortLayout(await build(page), lookup, key)));
      for (const c of await bh(page, 'cards')) {
        expect(c.pose.x).toBeCloseTo(columnX(columnOf(lookup(c.ref), key).index), 3);
        expect(c.area).toBe(c.inMain ? 'deck' : 'side');
      }
      expect((await bh(page, 'sort'))!.showing).toBe(key);
      await expect(page.getByTestId(`sort-${key}`)).toHaveAttribute('aria-pressed', 'true');
      // Sorting never changes the deck or the cards.
      expect((await build(page)).main).toEqual(b.main);
      expect((await build(page)).cards).toEqual(b.cards);
      // The same key again restores the layout from before the sort, exactly.
      await press(page, k);
      expect(await layout(page)).toEqual(handMade);
      expect((await bh(page, 'sort'))!.showing).toBeNull();
    }

    // A chain unwinds one step at a time: colour, then type, then type again gives the colour layout back.
    await press(page, '1');
    const byColour = await layout(page);
    await press(page, '3');
    await press(page, '3');
    expect(await layout(page)).toEqual(byColour);
    // Stable: sorting by colour from the type layout gives the same colour layout as from the hand-made one.
    await press(page, '3');
    await page.getByTestId('sort-colour').click();
    await settled(page);
    expect(await layout(page)).toEqual(byColour);
    // The build carries the sorted positions (the list view keeps them, a reload shows them).
    expect(rounded((await build(page)).poses ?? {})).toEqual(byColour);
  });

  test('a cascade moves as one by its base card, any other card pulls out singly; Shift+drag selects and the selection moves together', async ({ page }) => {
    await openBuilder(page);
    await settled(page);
    // The longest colour column in the sideboard.
    const cards = await bh(page, 'cards');
    const columns = new Map<number, typeof cards>();
    for (const c of cards) {
      const k = Math.round(c.pose.x);
      columns.set(k, [...(columns.get(k) ?? []), c]);
    }
    const column = [...columns.values()].sort((a, b) => b.length - a.length)[0]!.sort((a, b) => b.pose.y - a.pose.y);
    expect(column.length).toBeGreaterThanOrEqual(4);
    const base = column[0]!;
    const strip = (pose: { x: number; y: number }, dy = 4) => screenOf(page, { x: pose.x, y: pose.y + 44 - dy });

    // The base card (grabbed by its title strip, the rest of it lies under the cascade) takes the whole cascade along,
    // keeping its shape; dropped in the deck area, the whole column joins the deck.
    await dragFromTo(page, await strip(base.pose), await screenOf(page, { x: base.pose.x + 30, y: 330 }));
    await settled(page);
    expect((await build(page)).main.sort()).toEqual(column.map((c) => c.id).sort());
    let after = new Map((await bh(page, 'cards')).map((c) => [c.id, c.pose]));
    const dx = after.get(base.id)!.x - base.pose.x;
    const dy = after.get(base.id)!.y - base.pose.y;
    for (const c of column) {
      expect(after.get(c.id)!.x - c.pose.x).toBeCloseTo(dx, 1);
      expect(after.get(c.id)!.y - c.pose.y).toBeCloseTo(dy, 1);
    }

    // Any other card of the cascade pulls out singly: the cards below it stay put.
    const pulled = column[1]!;
    const before = after;
    await dragFromTo(page, await strip(before.get(pulled.id)!), await screenOf(page, { x: 250, y: 120 }), { ctrl: true });
    await settled(page);
    after = new Map((await bh(page, 'cards')).map((c) => [c.id, c.pose]));
    expect(Math.abs(after.get(pulled.id)!.x - 250)).toBeLessThan(PX_MM);
    for (const c of column.filter((x) => x.id !== pulled.id)) expect(after.get(c.id)).toEqual(before.get(c.id));

    // Shift+drag on empty table draws a marquee: it selects the cards whose centres it covers.
    const others = (await bh(page, 'cards')).filter((c) => c.area === 'side');
    const target = others.reduce((m, c) => (c.pose.x < m.pose.x ? c : m), others[0]!);
    const colX = target.pose.x;
    const inCol = others.filter((c) => Math.abs(c.pose.x - colX) < 1).map((c) => c.id);
    expect(inCol.length).toBeGreaterThanOrEqual(2);
    const from = await screenOf(page, { x: colX - 34, y: -BUILDER_LAYOUT.margin - 12 });
    const to = await screenOf(page, { x: colX + 34, y: -372 });
    await dragFromTo(page, from, to, { shift: true });
    expect((await bh(page, 'selection')).sort()).toEqual([...inCol].sort());
    await expect(page.getByTestId('builder-selected')).toHaveText(`${inCol.length} selected`);
    // Dragging one selected card moves the whole selection; dropped in the deck area, all join the deck.
    const lowest = others.filter((c) => inCol.includes(c.id)).sort((a, b) => a.pose.y - b.pose.y)[0]!;
    await dragFromTo(page, await centre(page, lowest.id), await screenOf(page, { x: lowest.pose.x + 420, y: 150 }));
    await settled(page);
    const main = (await build(page)).main;
    for (const id of inCol) expect(main).toContain(id);
    expect((await bh(page, 'cards')).filter((c) => inCol.includes(c.id)).every((c) => c.area === 'deck')).toBe(true);
    // Escape clears the selection.
    await page.keyboard.press('Escape');
    expect(await bh(page, 'selection')).toEqual([]);
  });

  test('magnetic snapping: dropped near a card it squares up or cascades below it; Ctrl drops freely', async ({ page }) => {
    await openBuilder(page);
    await settled(page);
    const pose = async (id: string) => (await bh(page, 'cards')).find((x) => x.id === id)!.pose;
    const a = await freeOne(page);
    await dragCardTo(page, a.id, { x: -100, y: 200 });
    const c = await freeOne(page);
    // Dropped with its top edge in the lower third of a card: a cascade 14 below it.
    await dragCardTo(page, c.id, { x: -95, y: 140 });
    const base = await pose(a.id);
    expect((await pose(c.id)).x).toBeCloseTo(base.x, 6);
    expect((await pose(c.id)).y).toBeCloseTo(base.y - BUILDER_LAYOUT.cascade, 6);
    // Dropped with its centre within 12 of a card's centre: a squared pile on the same spot.
    const b2 = await freeOne(page);
    await dragCardTo(page, b2.id, { x: 120, y: 200 });
    const d = await freeOne(page);
    await dragCardTo(page, d.id, { x: 125, y: 196 });
    const spot = await pose(b2.id);
    expect((await pose(d.id)).x).toBeCloseTo(spot.x, 6);
    expect((await pose(d.id)).y).toBeCloseTo(spot.y, 6);
    // The squared pile shows: a count badge, and its upper card one 0.4 mm step up (DESIGN "Card manipulation").
    const badge = page.getByTestId('builder-pile-count');
    await expect(badge).toHaveCount(1);
    await expect(badge).toHaveAttribute('data-count', '2');
    await expect(badge).toHaveText('×2');
    const pileOf = async (id: string) => (await bh(page, 'cards')).find((x) => x.id === id)!;
    expect((await pileOf(d.id)).pile).toMatchObject({ kind: 'squared', index: 1, count: 2 });
    expect((await pileOf(d.id)).z).toBeCloseTo(0.4, 6);
    expect((await pileOf(b2.id)).z).toBe(0);
    // With Ctrl held the same drop stays where it was let go.
    await dragCardTo(page, c.id, { x: 250, y: 300 });
    await dragCardTo(page, c.id, { x: -95, y: 140 }, { ctrl: true });
    expect(Math.abs((await pose(c.id)).x + 95)).toBeLessThan(PX_MM);
    expect(Math.abs((await pose(c.id)).y - 140)).toBeLessThan(PX_MM);
    expect([...(await build(page)).main].sort()).toEqual([a.id, b2.id, c.id, d.id].sort());
  });

  test('hold Space over a card to inspect it; letting go closes the view', async ({ page }) => {
    await openBuilder(page);
    await settled(page);
    const a = await freeOne(page);
    const p = await centre(page, a.id);
    await page.mouse.move(p.x, p.y);
    await expect.poll(async () => (await bh(page, 'cards')).find((c) => c.id === a.id)!.hovered).toBe(true);
    await page.keyboard.down('Space');
    await expect(page.getByTestId('inspect')).toBeVisible();
    await expect(page.getByTestId('inspect-text')).toContainText(lookup(a.ref)!.name);
    await page.keyboard.up('Space');
    await expect(page.getByTestId('inspect')).toBeHidden();
  });
});
