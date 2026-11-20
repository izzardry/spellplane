/**
 * The kit's pure parts (docs/design/m8/visual.md DS-5, DS-6, DS-7; PLAN M8-P1): booster art seeded by the set code,
 * the curve chart's bars and target, the sparkline, the table thumbnail from a GameThumb only, popover placement and
 * segmented-control keys.
 */
import { describe, expect, it } from 'vitest';
import { curveColumns, CURVE_PX_PER_CARD, eight, sparkHeights } from '../../../src/ui/design/curve';
import { popoverPlace } from '../../../src/ui/design/menu';
import { fnv1a, packArt, packOutline, starPoints } from '../../../src/ui/design/pack-art';
import { stepOption } from '../../../src/ui/design/segmented';
import { thumbCardSize, thumbDiscs, thumbRects } from '../../../src/ui/design/thumb';

describe('packArt', () => {
  it('is pure and seeded by "<code>:<index>" (FNV-1a)', () => {
    expect(packArt('COR', 0)).toEqual(packArt('COR', 0));
    expect(packArt('cor', 0)).toEqual(packArt('COR', 0));
    expect(packArt('COR', 0)).not.toEqual(packArt('ALP', 0));
    expect(packArt('COR', 0).hash).not.toBe(packArt('COR', 1).hash);
    expect(packArt('COR', 0).hash).toBe(fnv1a('COR:0'));
    expect(fnv1a('')).toBe(0x811c9dc5);
    expect(fnv1a('a')).toBe(0xe40c292c);
  });
  it('stays inside its ranges for many codes', () => {
    for (const code of ['COR', 'ALP', 'M19', 'DOM', 'WAR', 'ELD', 'X', 'LONGCODE']) {
      for (let i = 0; i < 6; i++) {
        const a = packArt(code, i);
        expect(a.points).toBeGreaterThanOrEqual(5);
        expect(a.points).toBeLessThanOrEqual(8);
        expect(a.turnDeg).toBeGreaterThanOrEqual(0);
        expect(a.turnDeg).toBeLessThan(360);
        expect([2, 3]).toContain(a.rings);
        expect(a.code.length).toBeLessThanOrEqual(5);
      }
    }
  });
  it('draws crimped ends with 18 teeth and a star with its points', () => {
    const d = packOutline(188, 327);
    expect(d.startsWith('M0 7')).toBe(true);
    expect(d.endsWith('Z')).toBe(true);
    expect((d.match(/L/g) ?? []).length).toBe(18 * 2 * 2 + 1);
    expect(starPoints(6, 18, 0).split(' ')).toHaveLength(12);
  });
});

describe('curve chart', () => {
  it('folds extra columns into 7+ and fills missing ones', () => {
    expect(eight([1, 2])).toEqual([1, 2, 0, 0, 0, 0, 0, 0]);
    expect(eight([0, 0, 0, 0, 0, 0, 0, 1, 2, 3])).toEqual([0, 0, 0, 0, 0, 0, 0, 6]);
  });
  it('draws bars in proportion at 9 px per card, a target per column, and scales down to fit', () => {
    const cols = curveColumns([0, 4, 6, 4, 2, 1, 0, 0], [0, 2, 3, 2, 1, 0, 1, 0], [0, 5, 7, 6, 4, 2, 1, 0], 200);
    expect(cols.map((c) => c.mv)).toEqual(['0', '1', '2', '3', '4', '5', '6', '7+']);
    expect(cols[2]!.cr).toBe(6 * CURVE_PX_PER_CARD);
    expect(cols[2]!.sp).toBe(3 * CURVE_PX_PER_CARD);
    expect(cols[2]!.tg).toBe(7 * CURVE_PX_PER_CARD);
    expect(cols[1]!.cr / cols[1]!.sp).toBe(2);
    const small = curveColumns([0, 4, 6, 4, 2, 1, 0, 0], [0, 2, 3, 2, 1, 0, 1, 0], undefined, 34);
    const tallest = Math.max(...small.map((c) => c.cr + c.sp));
    expect(tallest).toBeCloseTo(34, 5);
    expect(small.every((c) => c.tg === null)).toBe(true);
  });
  it('sparkline heights go up to 20 px in proportion', () => {
    expect(sparkHeights([1, 2, 4])).toEqual([5, 10, 20]);
    expect(sparkHeights([0, 0])).toEqual([0, 0]);
  });
});

describe('table thumbnail', () => {
  const thumb = { w: 1280, h: 720, cards: [[100, 200, 0, 0], [300, 400, 1, 1]] as [number, number, 0 | 1, number][] };
  it('draws one rectangle per card, tapped ones marked, and one disc per seat', () => {
    const rects = thumbRects(thumb);
    expect(rects).toHaveLength(2);
    expect(rects.map((r) => r.tapped)).toEqual([false, true]);
    expect(rects[0]!.x + rects[0]!.w / 2).toBe(100);
    const s = thumbCardSize(thumb);
    expect(s.h / s.w).toBeCloseTo(88 / 63, 6);
    expect(thumbDiscs(thumb, 4).map((d) => d.seat)).toEqual([0, 1, 2, 3]);
    const [bottom, top] = thumbDiscs(thumb, 2);
    expect(bottom!.cy).toBeGreaterThan(top!.cy);
  });
  it('draws at most 80 cards', () => {
    const many = { w: 1000, h: 600, cards: Array.from({ length: 120 }, (_, i) => [i, i, 0, 0] as [number, number, 0 | 1, number]) };
    expect(thumbRects(many)).toHaveLength(80);
  });
});

describe('popover placement and segmented keys', () => {
  it('opens below when there is room, above when not, and stays in the window', () => {
    const vp = { width: 1000, height: 800 };
    expect(popoverPlace({ left: 100, top: 100, bottom: 144, right: 144 }, { width: 300, height: 200 }, vp)).toEqual({ left: 100, top: 152, side: 'below' });
    expect(popoverPlace({ left: 900, top: 700, bottom: 744, right: 944 }, { width: 300, height: 200 }, vp)).toEqual({ left: 692, top: 492, side: 'above' });
    expect(popoverPlace({ left: 10, top: 10, bottom: 50, right: 50 }, { width: 100, height: 100 }, vp, 'above').top).toBe(8);
  });
  it('arrow keys skip disabled options and wrap', () => {
    const opts = [{}, { disabled: true }, {}, {}];
    expect(stepOption(opts, 0, 'ArrowRight')).toBe(2);
    expect(stepOption(opts, 2, 'ArrowLeft')).toBe(0);
    expect(stepOption(opts, 3, 'ArrowRight')).toBe(0);
    expect(stepOption(opts, 0, 'ArrowLeft')).toBe(3);
    expect(stepOption(opts, 2, 'End')).toBe(3);
    expect(stepOption(opts, 2, 'Home')).toBe(0);
    expect(stepOption(opts, 2, 'a')).toBeNull();
    expect(stepOption([{ disabled: true }], 0, 'ArrowRight')).toBeNull();
  });
});
