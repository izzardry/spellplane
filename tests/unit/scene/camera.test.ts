// Bird's-eye rig, DESIGN "Camera and navigation" and "Specification: geometry, layout and motion" (Camera rigs, Motion).
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { BirdseyeRig } from '../../../src/scene/camera';

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
