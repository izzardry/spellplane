// Bird's-eye rig, DESIGN "Camera and navigation" and "Specification: geometry, layout and motion" (Camera rigs, Motion).
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { BirdseyeRig } from '../../../src/scene/camera';
import { legibleScale } from '../../../src/scene/math';

const TABLE = { w: 1400, d: 1100 };
const VP = { w: 1440, h: 900 };
const tanHalf = Math.tan((3 * Math.PI) / 180);

describe('bird\'s-eye rig', () => {
  it('uses a 6 degree field of view and starts fitted', () => {
    const rig = new BirdseyeRig(TABLE, VP);
    expect(rig.fovDeg).toBe(6);
    expect(rig.view.dist).toBeCloseTo(rig.maxDist(), 9);
  });

  it('the farthest zoom shows the whole table plus a 5% margin, tight on one axis', () => {
    const rig = new BirdseyeRig(TABLE, VP);
    const halfH = rig.maxDist() * tanHalf;
    const halfW = halfH * (VP.w / VP.h);
    expect(halfH).toBeGreaterThanOrEqual((1100 * 1.05) / 2 - 1e-9);
    expect(halfW).toBeGreaterThanOrEqual((1400 * 1.05) / 2 - 1e-9);
    expect(Math.min(halfH - (1100 * 1.05) / 2, halfW - (1400 * 1.05) / 2)).toBeCloseTo(0, 6);
  });

  it('the closest zoom shows one card at 80% of the viewport height', () => {
    const rig = new BirdseyeRig(TABLE, VP);
    expect(88 * rig.pxPerMm(rig.minDist())).toBeCloseTo(0.8 * VP.h, 6);
  });

  it('zoom is clamped at both ends', () => {
    const rig = new BirdseyeRig(TABLE, VP);
    rig.zoomAt(720, 450, 1e9);
    expect(rig.view.dist).toBeCloseTo(rig.minDist(), 9);
    rig.zoomAt(720, 450, 1e-9);
    expect(rig.view.dist).toBeCloseTo(rig.maxDist(), 9);
  });

  it('zooming keeps the table point under the cursor fixed (property)', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: VP.w, noNaN: true }),
        fc.double({ min: 0, max: VP.h, noNaN: true }),
        fc.double({ min: 1.01, max: 4, noNaN: true }),
        fc.constantFrom(0, 180, 90),
        (x, y, f, angle) => {
          const rig = new BirdseyeRig(TABLE, VP, angle);
          // Start from a mid zoom near the centre so the pan clamp does not interfere.
          rig.view = { cx: 0, cy: 0, dist: (rig.minDist() + rig.maxDist()) / 2, angle };
          const p = rig.screenToTable(x, y);
          rig.zoomAt(x, y, f);
          const s = rig.tableToScreen(p);
          return Math.abs(s.x - x) < 1e-6 && Math.abs(s.y - y) < 1e-6;
        },
      ),
    );
  });

  it('zooming with the cursor over the surround keeps the nearest table edge fixed (no clamp drift)', () => {
    const rig = new BirdseyeRig(TABLE, VP, 0);
    rig.view = { cx: -685, cy: 0, dist: 250 / tanHalf, angle: 0 };
    const k = rig.pxPerMm();
    const x = 720 + (-900 - -685) * k; // the cursor is over table x = -900, 200 mm past the left edge
    expect(rig.screenToTable(x, 450).x).toBeCloseTo(-900, 6);
    const edge = { x: -700, y: 0 };
    const before = rig.tableToScreen(edge);
    for (let i = 0; i < 5; i++) {
      rig.zoomAt(x, 450, 1.1);
      const s = rig.tableToScreen(edge);
      expect(Math.abs(s.x - before.x)).toBeLessThan(1e-6);
      expect(Math.abs(s.y - before.y)).toBeLessThan(1e-6);
    }
    expect(rig.view.cx).toBeGreaterThan(-700);
  });

  it('screen and table mappings are inverse and the viewer\'s seat is at the bottom', () => {
    const rig0 = new BirdseyeRig(TABLE, VP, 0);
    expect(rig0.screenToTable(720, 900).y).toBeLessThan(0); // seat 0's near edge is -y
    const rig180 = new BirdseyeRig(TABLE, VP, 180);
    expect(rig180.screenToTable(720, 900).y).toBeGreaterThan(0);
    expect(rig180.screenToTable(1440, 450).x).toBeLessThan(0); // mirrored
    const p = rig180.screenToTable(123, 456);
    const s = rig180.tableToScreen(p);
    expect(s.x).toBeCloseTo(123, 9);
    expect(s.y).toBeCloseTo(456, 9);
  });

  it('a table seen from a 90 degree seat fits with width and depth swapped', () => {
    const rig = new BirdseyeRig(TABLE, VP, 90);
    const halfH = rig.maxDist() * tanHalf;
    expect(halfH).toBeGreaterThanOrEqual((1400 * 1.05) / 2 - 1e-9);
  });

  it('pan moves the table with the pointer', () => {
    const rig = new BirdseyeRig(TABLE, VP);
    rig.view = { ...rig.view, dist: rig.minDist() * 2 };
    const p = rig.screenToTable(500, 300);
    rig.panBy(40, -25);
    const s = rig.tableToScreen(p);
    expect(s.x).toBeCloseTo(540, 9);
    expect(s.y).toBeCloseTo(275, 9);
  });

  it('pan inertia decays with a 325 ms time constant', () => {
    const rig = new BirdseyeRig(TABLE, VP);
    rig.view = { ...rig.view, dist: rig.minDist() * 3 };
    const k = rig.pxPerMm();
    rig.fling(-1, 0); // table moving left at 1 px/ms: the view centre moves right at 1/k mm/ms
    const x0 = rig.view.cx;
    rig.step(325, 325);
    expect(rig.velocity.x * k).toBeCloseTo(Math.exp(-1), 6);
    expect((rig.view.cx - x0) * k).toBeCloseTo(325 * (1 - Math.exp(-1)), 6);
    for (let t = 0; t < 5000; t += 16) rig.step(t, 16);
    expect(rig.moving).toBe(false);
    // Total travel approaches v0 * tau.
    expect((rig.view.cx - x0) * k).toBeCloseTo(325, -1);
  });

  it('animateTo eases over the duration, or cuts with duration 0 (reduced motion)', () => {
    const rig = new BirdseyeRig(TABLE, VP);
    const to = { cx: 200, cy: -300, dist: rig.minDist(), angle: 0 };
    rig.animateTo(to, 0, 400);
    rig.step(200, 200);
    expect(rig.view.cx).toBeGreaterThan(0);
    expect(rig.view.cx).toBeLessThan(200);
    rig.step(400, 200);
    expect(rig.view).toMatchObject({ cx: 200, cy: -300 });
    rig.animateTo({ cx: 0, cy: 0, dist: rig.maxDist(), angle: 0 }, 1000, 0);
    expect(rig.view.cx).toBe(0);
    expect(rig.moving).toBe(false);
  });

  it('frames a territory with a margin', () => {
    const rig = new BirdseyeRig(TABLE, VP);
    const v = rig.rectView({ x: 0, y: -330, w: 1400, d: 440, rot: 0 });
    expect(v.cx).toBe(0);
    expect(v.cy).toBe(-330);
    const halfW = v.dist * tanHalf * (VP.w / VP.h);
    expect(halfW).toBeCloseTo((1400 * 1.05) / 2, 6);
  });
});

describe('fit clear of the screen-anchored layer (DESIGN "Camera and navigation", Screen-anchored layer)', () => {
  const insets = { top: 40, right: 316, bottom: 206, left: 190 };
  const corners = [
    { x: -700, y: -550 },
    { x: 700, y: -550 },
    { x: 700, y: 550 },
    { x: -700, y: 550 },
  ];

  it('the fitted table (plus margin) lies inside the viewport minus the insets, centred there and tight on one axis', () => {
    const rig = new BirdseyeRig(TABLE, VP);
    rig.setInsets(insets);
    const pts = corners.map((c) => rig.tableToScreen(c));
    const xs = pts.map((p) => p.x);
    const ys = pts.map((p) => p.y);
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(insets.left - 1e-6);
    expect(Math.max(...xs)).toBeLessThanOrEqual(VP.w - insets.right + 1e-6);
    expect(Math.min(...ys)).toBeGreaterThanOrEqual(insets.top - 1e-6);
    expect(Math.max(...ys)).toBeLessThanOrEqual(VP.h - insets.bottom + 1e-6);
    const centre = rig.tableToScreen({ x: 0, y: 0 });
    expect(centre.x).toBeCloseTo((insets.left + VP.w - insets.right) / 2, 6);
    expect(centre.y).toBeCloseTo((insets.top + VP.h - insets.bottom) / 2, 6);
    // Tight vertically: the table's depth plus 5% fills the free height.
    expect((Math.max(...ys) - Math.min(...ys)) * 1.05).toBeCloseTo(VP.h - insets.top - insets.bottom, 6);
    expect(rig.view.dist).toBeCloseTo(rig.maxDist(), 9);
  });

  it('a fitted view stays fitted when the insets or the viewport change; another view keeps its centre', () => {
    const rig = new BirdseyeRig(TABLE, VP);
    rig.setInsets(insets);
    expect(rig.atFit()).toBe(true);
    rig.setInsets({ ...insets, right: 0 });
    expect(rig.atFit()).toBe(true);
    rig.resize({ w: 1200, h: 800 });
    expect(rig.atFit()).toBe(true);
    rig.zoomAt(600, 400, 3);
    const v = { ...rig.view };
    rig.setInsets(insets);
    expect(rig.view).toEqual(rig.clampView(v));
  });

  it('a seat view frames the territory in the free area; huge insets never shrink it below 40% of the viewport', () => {
    const rig = new BirdseyeRig(TABLE, VP);
    rig.setInsets(insets);
    const v = rig.rectView({ x: 0, y: -330, w: 1400, d: 440, rot: 0 });
    const c = rig.tableToScreen({ x: 0, y: -330 }, 0, v);
    expect(c.x).toBeCloseTo((insets.left + VP.w - insets.right) / 2, 6);
    expect(c.y).toBeCloseTo((insets.top + VP.h - insets.bottom) / 2, 6);
    rig.setInsets({ top: 5000, right: 5000, bottom: 5000, left: 5000 });
    const safe = rig.safeArea();
    expect(safe.w).toBeCloseTo(VP.w * 0.4, 6);
    expect(safe.h).toBeCloseTo(VP.h * 0.4, 6);
  });
});

describe('fitted frame beyond the table (gate M1 finding: the opponent\'s hand row)', () => {
  it('the fitted view shows the whole frame clear of the insets, and a fitted view stays fitted when the frame changes', () => {
    const rig = new BirdseyeRig(TABLE, VP, 180);
    rig.setInsets({ top: 40, right: 316, bottom: 206, left: 190 });
    // The 1v1 hand row of seat 0 lies beyond seat 0's near edge (y < -d/2); seen from seat 1 that is the top.
    const frame = { x: 0, y: -50, w: 1400, d: 1200 };
    rig.setFrame(frame);
    const safe = rig.safeArea();
    for (const p of [
      { x: -700, y: -650 },
      { x: 700, y: -650 },
      { x: -700, y: 550 },
      { x: 700, y: 550 },
    ]) {
      const s = rig.tableToScreen(p);
      expect(s.x).toBeGreaterThanOrEqual(safe.x - 1e-6);
      expect(s.x).toBeLessThanOrEqual(safe.x + safe.w + 1e-6);
      expect(s.y).toBeGreaterThanOrEqual(safe.y - 1e-6);
      expect(s.y).toBeLessThanOrEqual(safe.y + safe.h + 1e-6);
    }
    // The far edge of the frame (seat 0's hand row) is drawn at the top of the safe area, below the top inset.
    expect(rig.tableToScreen({ x: 0, y: -650 }).y).toBeLessThan(rig.tableToScreen({ x: 0, y: 550 }).y);
    expect(rig.atFit()).toBe(true);
    rig.setFrame({ x: 0, y: 0, w: 1400, d: 1100 });
    expect(rig.atFit()).toBe(true);
    expect(rig.view.dist).toBeCloseTo(rig.maxDist(), 9);
  });
});

describe('legible table text (gate M1 finding: zone labels at the fitted view)', () => {
  it('scales small type up to the pixel floor in quarter steps, within [1, max]', () => {
    // 5.5 mm at 0.6 px per mm (the fitted 1v1 table) is 3.3 px: scaled to at least 9 px.
    const k = legibleScale(5.5, 9, 3, 0.6);
    expect(k).toBe(2.75);
    expect(5.5 * 0.6 * k).toBeGreaterThanOrEqual(9);
    expect(k * 4).toBe(Math.round(k * 4));
    expect(legibleScale(5.5, 9, 3, 5)).toBe(1);
    expect(legibleScale(5.5, 9, 3, 0.1)).toBe(3);
    expect(legibleScale(5.5, 9, 3, 0)).toBe(3);
  });
});
