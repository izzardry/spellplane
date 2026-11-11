// Temporary-move signals, DESIGN "Combat and annotation" (Temporary move: ghost outline at the home slot, displacement
// marker on the card) and "Themes and rendering" (functional signals rendered by every theme).
import { describe, expect, it } from 'vitest';
import { GHOST_DASH, MARKER_MAX, MARKER_MIN, ghostSegments, markerSegments, markerSize } from '../../../src/scene/ghost';

const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);

describe('ghost outline', () => {
  it('a solid ghost is the card rectangle at the home pose', () => {
    const s = ghostSegments({ x: 10, y: -160, rot: 0 }, false);
    expect(s).toHaveLength(4);
    expect(s[0]).toEqual({ from: { x: 10 - 31.5, y: -160 - 44 }, to: { x: 10 + 31.5, y: -160 - 44 } });
    expect(s.reduce((n, g) => n + dist(g.from, g.to), 0)).toBeCloseTo(2 * (63 + 88), 9);
  });

  it('a dashed ghost covers the outline with dashes and gaps, starting and ending on each corner', () => {
    const s = ghostSegments({ x: 0, y: 0, rot: 0 }, true);
    const drawn = s.reduce((n, g) => n + dist(g.from, g.to), 0);
    expect(drawn).toBeGreaterThan(0.45 * 2 * (63 + 88));
    expect(drawn).toBeLessThan(2 * (63 + 88));
    for (const g of s) expect(dist(g.from, g.to)).toBeGreaterThan(GHOST_DASH.dash * 0.6);
    expect(s[0]!.from).toEqual({ x: -31.5, y: -44 });
  });

  it('follows the home rotation (a far seat at 180°)', () => {
    const s = ghostSegments({ x: 0, y: 160, rot: 180 }, false);
    const xs = s.flatMap((g) => [g.from.x, g.to.x]);
    const ys = s.flatMap((g) => [g.from.y, g.to.y]);
    expect(Math.min(...xs)).toBeCloseTo(-31.5, 9);
    expect(Math.max(...ys)).toBeCloseTo(204, 9);
  });
});

describe('displacement marker', () => {
  it('an attacker 110 mm forward shows a chevron between its back edge and the ghost, pointing forward', () => {
    const home = { x: -137.5, y: -160 };
    // Tapped attacker: drawn at 90°, so its half extent along the seat's axis is half the card width.
    const s = markerSegments(home, { x: -137.5, y: -50, rot: 90 }, 8);
    expect(s).toHaveLength(2);
    const tip = s[0]!.to;
    expect(s[1]!.to).toEqual(tip);
    expect(tip.x).toBeCloseTo(-137.5, 9);
    expect(tip.y).toBeCloseTo(-50 - 31.5 - 2, 9);
    // Wings lie behind the tip (toward home) and either side of the axis.
    expect(s[0]!.from.y).toBeLessThan(tip.y);
    expect(s.map((g) => g.from.x).sort((a, b) => a - b)).toEqual([-137.5 - 4, -137.5 + 4]);
    // Untapped: the half extent is half the card height.
    expect(markerSegments(home, { x: -137.5, y: -50, rot: 0 }, 8)[0]!.to.y).toBeCloseTo(-50 - 44 - 2, 9);
  });

  it('no marker for a card at (or within 2 mm of) home', () => {
    expect(markerSegments({ x: 0, y: 0 }, { x: 1, y: 1, rot: 0 }, 8)).toEqual([]);
  });

  it('keeps a legible size on screen at far zoom, within bounds', () => {
    expect(markerSize(10)).toBe(MARKER_MIN);
    expect(markerSize(0.6)).toBe(MARKER_MAX);
    expect(markerSize(1.5)).toBe(8);
  });
});
