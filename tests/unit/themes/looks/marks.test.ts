// Marks only where used (docs/design/m8/m7-adjustments.md, M7-P1, change 3: "library and graveyard slots always;
// exile, command and the stack lane only while they hold a card or a dragged card is within 60 mm"; PLAN Milestone 8,
// M7-P1: "empty exile unmarked, marked while a card is dragged within 60 mm or held"). The pure part: which zones are
// optional, which of them show, and what the scene's hairlines and the theme's marks then draw.
import { describe, expect, it } from 'vitest';
import type { TableState } from '../../../../src/core/types';
import { buildHarnessState, harnessGame, harnessLayout } from '../../../../src/scene/harness-fixture';
import { markings } from '../../../../src/scene/layout';
import { CARD_H, CARD_W } from '../../../../src/scene/math';
import {
  ALWAYS_MARKED,
  MARK_NEAR_MM,
  isOptionalMark,
  markedGame,
  optionalMarkings,
  optionalZones,
  rectDistance,
  shownZones,
  tableMarks,
} from '../../../../src/scene/table-marks';

const layout = harnessLayout();
const SEATS = [
  { index: 0, colour: 0, named: true },
  { index: 1, colour: 1, named: true },
];
const empty = (): TableState => buildHarnessState({ scenario: 'empty' });
const demo = (): TableState => buildHarnessState({ scenario: 'demo' });
const zonesOf = (state: TableState | null) => optionalZones(layout, harnessGame, 0, 2, state);
const at = (state: TableState | null, key: string) => zonesOf(state).find((z) => z.key === key)!;

describe('which zones are marked only while used', () => {
  it('always marks library and graveyard; exile, command and the stack lane are optional; the battlefield and the hand are no marks', () => {
    expect([...ALWAYS_MARKED].sort()).toEqual(['graveyard', 'library']);
    expect(isOptionalMark(harnessGame, 'library')).toBe(false);
    expect(isOptionalMark(harnessGame, 'graveyard')).toBe(false);
    expect(isOptionalMark(harnessGame, 'exile')).toBe(true);
    expect(isOptionalMark(harnessGame, 'command')).toBe(true);
    expect(isOptionalMark(harnessGame, 'stack')).toBe(true);
    expect(isOptionalMark(harnessGame, 'battlefield')).toBe(false);
    expect(isOptionalMark(harnessGame, 'hand')).toBe(false);
    expect(MARK_NEAR_MM).toBe(60);
  });

  it('lists exile and command per seat in use and one stack lane, keyed by their state zone ids', () => {
    expect(zonesOf(empty()).map((z) => z.key).sort()).toEqual(['command:s0', 'command:s1', 'exile:s0', 'exile:s1', 'stack'].sort());
    const ex = at(empty(), 'exile:s0');
    expect(ex.rect.w).toBe(CARD_W);
    expect(ex.rect.d).toBe(CARD_H);
    expect(ex.rect.x).toBeCloseTo(layout.seats[0]!.zones.exile.x, 6);
    expect(ex.rect.y).toBeCloseTo(layout.seats[0]!.zones.exile.y, 6);
  });
});

describe('which optional zones show', () => {
  it('shows none on an empty table with nothing dragged', () => {
    expect([...shownZones(zonesOf(empty()), empty(), [])]).toEqual([]);
  });

  it('shows a zone while it holds a card (the demo table has two cards in each exile)', () => {
    const s = demo();
    const shown = shownZones(zonesOf(s), s, []);
    expect(shown.has('exile:s0')).toBe(true);
    expect(shown.has('exile:s1')).toBe(true);
    expect(shown.has('command:s0')).toBe(false);
    expect(shown.has('stack')).toBe(false);
  });

  it('shows the stack lane while the stack holds an item', () => {
    const s = empty();
    s.stack = [{ id: 'i1', kind: 'ability', controller: 's0' }];
    expect(shownZones(zonesOf(s), s, []).has('stack')).toBe(true);
  });

  it('shows a zone while a dragged card is within 60 mm of its edge, not beyond', () => {
    const s = empty();
    const ex = at(s, 'exile:s0');
    // Straight out from the slot along its local x axis (rot 0 for seat 0 at the harness table).
    const edge = ex.rect.x + ex.rect.w / 2;
    expect(shownZones(zonesOf(s), s, [{ x: edge + 59, y: ex.rect.y }]).has('exile:s0')).toBe(true);
    expect(shownZones(zonesOf(s), s, [{ x: edge + MARK_NEAR_MM, y: ex.rect.y }]).has('exile:s0')).toBe(true);
    expect(shownZones(zonesOf(s), s, [{ x: edge + 61, y: ex.rect.y }]).has('exile:s0')).toBe(false);
    // Over the slot itself.
    expect(shownZones(zonesOf(s), s, [{ x: ex.rect.x, y: ex.rect.y }]).has('exile:s0')).toBe(true);
    // Only the near zone: the other seat's exile stays unmarked.
    expect(shownZones(zonesOf(s), s, [{ x: ex.rect.x, y: ex.rect.y }]).has('exile:s1')).toBe(false);
  });

  it('measures distance to an oriented rectangle (0 inside, to the nearest edge or corner outside)', () => {
    const r = { x: 100, y: 50, w: 20, d: 10, rot: 90 };
    expect(rectDistance({ x: 100, y: 50 }, r)).toBe(0);
    // Turned 90°: the rect spans 10 along x and 20 along y.
    expect(rectDistance({ x: 100, y: 50 + 10 + 7 }, r)).toBeCloseTo(7, 6);
    expect(rectDistance({ x: 100 + 5 + 3, y: 50 + 10 + 4 }, r)).toBeCloseTo(5, 6);
  });
});

describe('what is drawn', () => {
  it('the hairlines always mark library and graveyard and never an unused exile, command area or stack lane', () => {
    const m = markings(layout, markedGame(harnessGame), 0, 2, ['Ada', 'Bo']);
    const kinds = m.labels.map((l) => l.key);
    expect(kinds).toEqual(expect.arrayContaining(['zl:0:library', 'zl:0:graveyard', 'zl:1:library', 'zl:1:graveyard']));
    expect(kinds.some((k) => /exile|command|stack/.test(k))).toBe(false);
    const extra = optionalMarkings(zonesOf(empty()), new Set(), layout, harnessGame, 0);
    expect(extra.segments).toEqual([]);
    expect(extra.labels).toEqual([]);
  });

  it('a shown exile gets its outline (four segments, 2 mm clear of the card) and its label, where the full markings put them', () => {
    const zones = zonesOf(empty());
    const extra = optionalMarkings(zones, new Set(['exile:s0']), layout, harnessGame, 0);
    expect(extra.segments.length).toBe(16);
    const full = markings(layout, harnessGame, 0, 2, ['Ada', 'Bo']);
    const want = full.labels.find((l) => l.key === 'zl:0:exile')!;
    expect(extra.labels).toEqual([want]);
    const xs = extra.segments.filter((_, i) => i % 2 === 0);
    const ex = at(empty(), 'exile:s0');
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(CARD_W + 4, 6);
    expect(Math.max(...xs)).toBeCloseTo(ex.rect.x + CARD_W / 2 + 2, 6);
  });

  it('the stack lane and a command area get their outline and label when shown', () => {
    const extra = optionalMarkings(zonesOf(empty()), new Set(['stack', 'command:s1']), layout, harnessGame, 0);
    expect(extra.labels.map((l) => l.key).sort()).toEqual(['zl:1:command', 'zl:stack']);
    expect(extra.segments.length).toBe(32);
  });

  it('the theme’s marks: beds for library and graveyard always, for exile and command only when shown', () => {
    const s = empty();
    const none = tableMarks(layout, harnessGame, 0, SEATS, { keys: new Set(), state: s });
    expect(none.piles.map((p) => `${p.zone}:${p.seat}`)).toEqual(['library:0', 'graveyard:0', 'library:1', 'graveyard:1']);
    expect(none.areas).toEqual([]);
    const some = tableMarks(layout, harnessGame, 0, SEATS, { keys: new Set(['exile:s1', 'command:s0']), state: s });
    expect(some.piles.map((p) => `${p.zone}:${p.seat}`)).toEqual(['library:0', 'graveyard:0', 'library:1', 'graveyard:1', 'exile:1']);
    expect(some.areas.map((a) => `${a.zone}:${a.seat}`)).toEqual(['command:0']);
    // Without a filter (a theme's own tests, the still): every zone.
    expect(tableMarks(layout, harnessGame, 0, SEATS).piles).toHaveLength(6);
  });
});
