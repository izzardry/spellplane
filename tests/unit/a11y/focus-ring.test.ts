/**
 * The table's focus ring stays apart from the selection outline (scene/types.ts ViewState.focused: "drawn with a focus
 * ring distinct from hover and selection"; PLAN M5-P4). Some themes draw selection in the focus colour (Paper, Wyrm,
 * Stonetable), so the ring differs in form: dashed where selection is solid, and standing off the card by a gap that
 * stays visible in the far view.
 */
import { describe, expect, it } from 'vitest';
import { FOCUS_RING_DASH, FOCUS_RING_GAP_MM, FOCUS_RING_MIN_GAP_PX, FOCUS_RING_PX, ringPolygon } from '../../../src/scene/focus-ring';
import { CARD_H, CARD_W } from '../../../src/scene/math';
import type { ScreenPoint } from '../../../src/scene/types';
import { loadTheme, THEME_IDS } from '../../../src/themes/index';

/** A card's projected corners at `pxPerMm`, top-left at (x, y), in screen order (clockwise on screen, y down). */
const rect = (x: number, y: number, pxPerMm: number): ScreenPoint[] => [
  { x, y },
  { x: x + CARD_W * pxPerMm, y },
  { x: x + CARD_W * pxPerMm, y: y + CARD_H * pxPerMm },
  { x, y: y + CARD_H * pxPerMm },
];

/** Distance from point p to the line through a and b. */
const lineDist = (p: ScreenPoint, a: ScreenPoint, b: ScreenPoint) => Math.abs((b.x - a.x) * (a.y - p.y) - (a.x - p.x) * (b.y - a.y)) / Math.hypot(b.x - a.x, b.y - a.y);

/** The gap between each card edge and the ring edge beside it. */
function gaps(card: ScreenPoint[], ring: ScreenPoint[]): number[] {
  return card.map((a, i) => lineDist(ring[i]!, a, card[(i + 1) % card.length]!));
}

describe('focus ring geometry (M5-P4)', () => {
  it('stands off the card by at least the minimum on screen in the far view (about 1 px/mm), outside the card on every side', () => {
    const card = rect(100, 100, 1);
    const ring = ringPolygon(card);
    for (const g of gaps(card, ring)) expect(g).toBeCloseTo(FOCUS_RING_MIN_GAP_PX, 6);
    // Outside: the ring's box contains the card's.
    expect(Math.min(...ring.map((p) => p.x))).toBeLessThan(100);
    expect(Math.max(...ring.map((p) => p.y))).toBeGreaterThan(100 + CARD_H);
    // The halo's inner edge leaves the card edge (and a selection outline drawn on it) visible.
    expect(FOCUS_RING_MIN_GAP_PX - FOCUS_RING_PX.halo / 2).toBeGreaterThanOrEqual(2);
  });

  it('keeps the millimetre gap when zoomed in, whichever way the corners wind', () => {
    const card = rect(0, 0, 6);
    for (const g of gaps(card, ringPolygon(card))) expect(g).toBeCloseTo(FOCUS_RING_GAP_MM * 6, 6);
    const ccw = [...card].reverse();
    const ring = ringPolygon(ccw);
    for (const g of gaps(ccw, ring)) expect(g).toBeCloseTo(FOCUS_RING_GAP_MM * 6, 6);
    expect(Math.min(...ring.map((p) => p.x))).toBeLessThan(0);
  });

  it('keeps an even gap around a trapezoid (the ego view)', () => {
    const card = [
      { x: 110, y: 100 },
      { x: 160, y: 100 },
      { x: 175, y: 190 },
      { x: 95, y: 190 },
    ];
    const ring = ringPolygon(card);
    const g = gaps(card, ring);
    for (const v of g) expect(v).toBeCloseTo(g[0]!, 6);
    expect(g[0]!).toBeGreaterThanOrEqual(FOCUS_RING_MIN_GAP_PX);
  });

  it('is dashed, so it differs from every theme\'s solid selection outline even where the colours match', async () => {
    expect(FOCUS_RING_DASH.split(/\s+/).map(Number).every((n) => n > 0)).toBe(true);
    const themes = await Promise.all(THEME_IDS.map((id) => loadTheme(id)));
    const same = themes.filter((t) => t.cardDressing.selected.colour.toLowerCase() === t.tokens.colours.focus.toLowerCase());
    // The case this guards against exists (Paper, Wyrm, Stonetable at the time of writing).
    expect(same.length).toBeGreaterThan(0);
  });
});
