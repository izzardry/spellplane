// Presentation, DESIGN "Table model" (Presentation column; face-down owner view) and "Specification: geometry,
// layout and motion" (stack lane cascade 22 toward each viewer, squared pile step 0.4 capped at 20).
import { describe, expect, it } from 'vitest';
import { buildHarnessState, harnessGame, harnessLayout, harnessPrivateFaces } from '../../../src/scene/harness-fixture';
import { dropTargets, fitFrame, placeCards } from '../../../src/scene/layout';
import { mtgLayout } from '../../../src/games/mtg/layout';
import { createTable } from '../../../src/core/reducer/index';
import { mtg } from '../../../src/games/index';
import type { ViewState } from '../../../src/scene/types';

const view = (over: Partial<ViewState> = {}): ViewState => ({ selection: [], hovered: null, privateFaces: {}, reducedMotion: false, pings: [], openPile: null, ...over });
const ctx = (viewerSeat: string | null) => ({ game: harnessGame, layout: harnessLayout(), viewerSeat });

describe('presentation', () => {
  const s = buildHarnessState({ scenario: 'demo' });

  it('the viewer\'s own hand is not drawn (HUD fan); other hands are rows of backs', () => {
    const p = placeCards(s, view(), ctx('s0'));
    expect([...p.values()].some((x) => x.zone === 'hand:s0')).toBe(false);
    const row = [...p.values()].filter((x) => x.zone === 'hand:s1');
    expect(row).toHaveLength(7);
    expect(row.every((x) => x.key === 'back')).toBe(true);
  });

  it('own face-down cards show their face dimmed only with a private identity', () => {
    expect(placeCards(s, view({ privateFaces: harnessPrivateFaces() }), ctx('s0')).get('s0-d0')).toMatchObject({ dimmed: true, key: 'fx-900#0' });
    expect(placeCards(s, view(), ctx('s0')).get('s0-d0')).toMatchObject({ dimmed: false, key: 'back' });
  });

  it('library cards are a squared pile of backs at the anchor, stepping 0.4 mm up to 20 mm', () => {
    const p = placeCards(s, view(), ctx('s0'));
    const lib = [...p.values()].filter((x) => x.zone === 'library:s0');
    const anchor = harnessLayout().seats[0]!.zones.library;
    expect(lib.every((x) => x.rest.x === anchor.x && x.rest.y === anchor.y && x.key === 'back')).toBe(true);
    expect(Math.max(...lib.map((x) => x.z))).toBeCloseTo(Math.min(20, 0.4 * (lib.length - 1)), 9);
  });

  it('the stack cascades 22 mm toward each viewer', () => {
    const t = structuredClone(s);
    for (const id of ['s0-b02', 's1-b02']) {
      t.cards[id]!.zone = 'stack';
      t.zones.stack!.ids.push(id);
      for (const z of ['battlefield:s0', 'battlefield:s1']) t.zones[z]!.ids = t.zones[z]!.ids.filter((x) => x !== id);
    }
    const p0 = placeCards(t, view(), ctx('s0'));
    expect(p0.get('s1-b02')!.rest.y - p0.get('s0-b02')!.rest.y).toBeCloseTo(-22, 9);
    const p1 = placeCards(t, view(), ctx('s1'));
    expect(p1.get('s1-b02')!.rest.y - p1.get('s0-b02')!.rest.y).toBeCloseTo(22, 9);
    expect(p1.get('s0-b02')!.rest.rot).toBe(180);
  });

  it('a tapped battlefield card is drawn turned 90° from its stored rotation (the state stores the flag only)', () => {
    const t = structuredClone(s);
    expect(t.cards['s0-b01']).toMatchObject({ tapped: true, pose: { rot: 0 } });
    expect(placeCards(t, view(), ctx('s0')).get('s0-b01')!.rest.rot).toBe(90);
    expect(t.cards['s1-b01']).toMatchObject({ tapped: true, pose: { rot: 180 } });
    expect(placeCards(t, view(), ctx('s0')).get('s1-b01')!.rest.rot).toBe(270);
    t.cards['s0-b01']!.tapped = false;
    expect(placeCards(t, view(), ctx('s0')).get('s0-b01')!.rest.rot).toBe(0);
  });

  it('drop targets: every seat\'s library, graveyard and exile, its avatar (hand) and the stack lane', () => {
    const zones = dropTargets(s, harnessLayout(), 0, harnessGame).map((t) => t.zone).sort();
    expect(zones).toEqual(['exile:s0', 'exile:s1', 'graveyard:s0', 'graveyard:s1', 'hand:s0', 'hand:s1', 'library:s0', 'library:s1', 'stack'].sort());
  });
});

describe('fit frame (gate M1 finding: the opponent\'s hand row of backs must not sit under the turn strip)', () => {
  it('1v1: the frame is the table plus the other seat\'s hand row; an empty chair adds nothing', () => {
    const layout = mtgLayout('1v1');
    const st = createTable({ game: mtg, format: '1v1', seats: [{ name: 'Ann', colour: 0 }, { name: 'Ben', colour: 1 }] });
    const row0 = layout.seats[0]!.zones.handRow;
    const row1 = layout.seats[1]!.zones.handRow;
    const fromBen = fitFrame(st, layout, 's1');
    // Ann's row lies beyond her near edge: the frame reaches it and still holds the whole table.
    expect(fromBen.y - fromBen.d / 2).toBeCloseTo(row0.y - row0.d / 2, 6);
    expect(fromBen.y + fromBen.d / 2).toBeCloseTo(layout.table.d / 2, 6);
    expect(fromBen.w).toBeGreaterThanOrEqual(layout.table.w);
    const fromAnn = fitFrame(st, layout, 's0');
    expect(fromAnn.y + fromAnn.d / 2).toBeCloseTo(row1.y + row1.d / 2, 6);
    expect(fromAnn.y - fromAnn.d / 2).toBeCloseTo(-layout.table.d / 2, 6);
    const solo = createTable({ game: mtg, format: '1v1', seats: [{ name: 'Ann', colour: 0 }, { name: '', colour: 1 }] });
    expect(fitFrame(solo, layout, 's0')).toEqual({ x: 0, y: 0, w: layout.table.w, d: layout.table.d });
    expect(fitFrame(null, layout, null)).toEqual({ x: 0, y: 0, w: layout.table.w, d: layout.table.d });
  });
});
