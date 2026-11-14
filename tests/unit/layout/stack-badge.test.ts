/**
 * PLAN Milestone 5, owner decisions, Far-zoom stack: "DESIGN's far-zoom behaviour for the stack (it collapses to a
 * count badge that expands on hover, or on tap on touch) is built, because the fitted three- and four-player view made
 * the stack unreadable (M3 gate)." DESIGN "The effect stack", Reading it: "at far zoom it collapses to a count badge
 * that expands on hover"; items are numbered from the bottom, newest on top.
 *
 * The rule (scene/stack.ts stackCollapsed with STACK_COLLAPSE_CARD_PX) on the real rig at the views the HUD shows, and
 * what the expanded badge lists. The badge's DOM and its hover and tap behaviour are browser-tested
 * (tests/e2e/layout/stack-badge.spec.ts).
 */
import { describe, expect, it } from 'vitest';
import type { Format, TableState } from '../../../src/core/types';
import { mtg } from '../../../src/games/mtg/index';
import { TableRig, lateralOf } from '../../../src/scene/camera/rig';
import { cameraTable, fitFrame, viewerAngle } from '../../../src/scene/layout';
import { badgeItems, stackBadgeText, stackCollapsed, stackEntries, stackSlotPose } from '../../../src/scene/stack';
import { EGO_FRAMING_VIEWPORTS, STACK_COLLAPSE_CARD_PX } from '../../../src/scene/types';
import { fitInsets } from '../../../src/ui/hand';
import { act, ok, play, readyTable } from '../core/helpers';

describe('the collapse rule', () => {
  it('collapses only with items on the stack and a lane card drawn shorter than the threshold', () => {
    expect(stackCollapsed(0, 5)).toBe(false);
    expect(stackCollapsed(3, STACK_COLLAPSE_CARD_PX - 0.01)).toBe(true);
    expect(stackCollapsed(3, STACK_COLLAPSE_CARD_PX)).toBe(false);
    expect(stackCollapsed(1, 200)).toBe(false);
    // Behind the camera (no size) the lane is not drawn either: the badge stands for it (it shows only on screen).
    expect(stackCollapsed(2, 0)).toBe(true);
    expect(stackCollapsed(2, Number.NaN)).toBe(false);
    expect(stackCollapsed(2, 50, 60)).toBe(true);
  });

  it('names the count', () => {
    expect(stackBadgeText(1)).toBe('1 item on the stack');
    expect(stackBadgeText(4)).toBe('4 items on the stack');
  });
});

/** A table of `format`, every chair taken, with `n` spells on the stack (one card cast from each seat in turn). */
function withStack(format: Format, n: number): TableState {
  const seats = format === '1v1' ? 2 : format === 'ffa3' ? 3 : 4;
  let s = readyTable(4, format, seats);
  for (let i = 0; i < n; i++) {
    const seat = `s${i % seats}`;
    const id = `${'abcd'[i % seats]}0${Math.floor(i / seats)}`;
    s = play(s, id, { x: 0, y: 0, rot: 0 }, seat);
    s = ok(s, act('stackPush', { item: `it${i}`, kind: 'spell', card: id }, seat));
  }
  return s;
}

/** The lane card's on-screen height at the view the HUD opens with (fitted bird's-eye, the HUD's insets). */
function laneCardPx(format: Format, viewer: string, vp: { width: number; height: number }, rig: 'birdseye' | 'ego' = 'birdseye'): number {
  const layout = mtg.layout(format);
  const s = withStack(format, 1);
  const angle = viewerAngle(s, layout, viewer);
  const sl = layout.seats[s.seats[viewer]!.index]!;
  const r = new TableRig({ table: cameraTable(layout, angle), viewport: { w: vp.width, h: vp.height }, angle, inertiaMs: 325, rig, lateral: lateralOf(sl.territory, sl.angle) });
  const [top, right, bottom, left] = fitInsets(vp.height, false).split(' ').map(Number) as [number, number, number, number];
  r.setInsets({ top, right, bottom, left });
  r.setTable(cameraTable(layout, angle), angle, fitFrame(s, layout, viewer), lateralOf(sl.territory, sl.angle));
  return r.cardScreenHeight(stackSlotPose(layout.stackLane, 0, angle));
}

describe('where it collapses', () => {
  for (const vp of EGO_FRAMING_VIEWPORTS) {
    it(`${vp.width}x${vp.height}: the fitted three- and four-player views collapse the lane, from every seat`, () => {
      for (const format of ['ffa3', 'ffa4'] as const) {
        for (const viewer of ['s0', 's1', 's2']) {
          const px = laneCardPx(format, viewer, vp);
          expect(px, `${format} ${viewer}`).toBeLessThan(STACK_COLLAPSE_CARD_PX);
          expect(stackCollapsed(1, px)).toBe(true);
        }
      }
    });

    it(`${vp.width}x${vp.height}: the fitted 1v1 and Two-Headed Giant views keep the lane (as the earlier gates use it)`, () => {
      for (const format of ['1v1', '2hg'] as const) expect(stackCollapsed(1, laneCardPx(format, 's0', vp)), format).toBe(false);
    });
  }

  it('zooming in on the lane brings it back', () => {
    const layout = mtg.layout('ffa4');
    const s = withStack('ffa4', 2);
    const r = new TableRig({ table: cameraTable(layout, 0), viewport: { w: 1440, h: 900 }, angle: 0, inertiaMs: 325, rig: 'birdseye' });
    const [top, right, bottom, left] = fitInsets(900, false).split(' ').map(Number) as [number, number, number, number];
    r.setInsets({ top, right, bottom, left });
    r.setTable(cameraTable(layout, 0), 0, fitFrame(s, layout, 's0'));
    const lane = stackSlotPose(layout.stackLane, 0, 0);
    expect(stackCollapsed(2, r.cardScreenHeight(lane))).toBe(true);
    const at = r.tableToScreen(lane);
    for (let i = 0; i < 6; i++) r.zoomAt(at.x, at.y, 1.4);
    expect(stackCollapsed(2, r.cardScreenHeight(lane))).toBe(false);
  });
});

describe('the expanded badge lists the items readably', () => {
  it('newest first, numbered from the bottom, in the controllers\' colours, with notes; a face nobody may see stays a back', () => {
    const layout = mtg.layout('ffa3');
    let s = withStack('ffa3', 3);
    s = ok(s, act('stackNote', { item: 'it1', note: 'X = 3' }, 's1'));
    const entries = stackEntries(s, layout.stackLane, 0);
    const colours: Record<string, string> = { s0: 'red', s1: 'green', s2: 'blue' };
    const items = badgeItems(entries, (id) => (id === 'c00' ? { ref: null, faceIndex: 0 } : { ref: s.cards[id]!.identity ?? null, faceIndex: 0 }), (seat) => colours[seat]!);
    expect(items.map((i) => [i.item, i.number, i.kindLabel, i.colour, i.note])).toEqual([
      ['it2', 3, 'Spell', 'blue', null],
      ['it1', 2, 'Spell', 'green', 'X = 3'],
      ['it0', 1, 'Spell', 'red', null],
    ]);
    expect(items[0]!.ref).toBeNull();
    expect(items[1]!.ref).toEqual(s.cards.b00!.identity);
  });

  it('names each item\'s controller by glyph and name as well as colour (nothing depends on hue alone)', () => {
    const layout = mtg.layout('ffa3');
    const s = withStack('ffa3', 3);
    const entries = stackEntries(s, layout.stackLane, 0);
    const glyphs = { s0: 'circle', s1: 'square', s2: 'triangle' } as const;
    const items = badgeItems(entries, () => ({ ref: null, faceIndex: 0 }), () => '#000', (seat) => ({ glyph: glyphs[seat as keyof typeof glyphs], name: `P${seat}` }));
    expect(items.map((i) => [i.item, i.glyph, i.controller])).toEqual([
      ['it2', 'triangle', 'Ps2'],
      ['it1', 'square', 'Ps1'],
      ['it0', 'circle', 'Ps0'],
    ]);
  });
});
