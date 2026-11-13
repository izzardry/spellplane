// PLAN M4-P1 acceptance, blend maths: "During a blend the world point under the cursor moves less than 2 px" and "with
// reduced motion the switch is a cut". DESIGN "Camera and navigation", Switching: one key (P) blends between the rigs in
// about 400 ms by interpolating position, tilt and field of view; the bird's-eye rig is a perspective camera with a
// very narrow field of view from far away, so the blend is continuous; the point under the cursor stays under the
// cursor. "Specification: geometry, layout and motion", Camera rigs: bird's-eye 6°, ego 45° pitched 35°; the blend
// interpolates field of view, position and pitch together over 400 ms while solving distance so the cursor's table
// point stays fixed.
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { blendPose, easeBlend } from '../../../src/scene/camera/blend';
import { poseAt, poseDist, unprojectToTable } from '../../../src/scene/camera/pose';
import { egoPose, defaultEgoNav } from '../../../src/scene/camera/ego';
import { DEFAULT_EGO_RIG } from '../../../src/scene/types';
import { BLEND_MS, TABLES, VP, makeRig, px, runSwitch, screenOf } from './helpers';

describe('blendPose', () => {
  const bird = poseAt({ x: 0, y: 0 }, 13000, 90, 6, 0);
  const ego = egoPose(DEFAULT_EGO_RIG, TABLES['1v1'], 0, defaultEgoNav(DEFAULT_EGO_RIG));

  it('starts at the first pose and ends at the second', () => {
    expect(blendPose(bird, ego, 0, VP, null)).toEqual(bird);
    expect(blendPose(bird, ego, 1, VP, null)).toEqual(ego);
  });

  it('interpolates field of view and pitch between the rigs, continuously', () => {
    let prev = blendPose(bird, ego, 0, VP, null);
    for (let i = 1; i <= 100; i++) {
      const p = blendPose(bird, ego, i / 100, VP, null);
      // Field of view grows monotonically from 6° to 45°, pitch falls from 90° to 35°.
      expect(p.fovDeg).toBeGreaterThanOrEqual(prev.fovDeg);
      expect(p.pitchDeg).toBeLessThanOrEqual(prev.pitchDeg);
      expect(p.fovDeg).toBeGreaterThanOrEqual(6);
      expect(p.fovDeg).toBeLessThanOrEqual(45);
      // No jumps: the camera never moves more than a small share of its distance per 1% of the blend.
      const step = Math.hypot(p.position[0] - prev.position[0], p.position[1] - prev.position[1], p.position[2] - prev.position[2]);
      expect(step).toBeLessThan(0.08 * Math.max(poseDist(p), poseDist(prev)));
      prev = p;
    }
  });

  it('keeps the anchor table point under the anchor screen point at every step (property)', () => {
    fc.assert(
      fc.property(fc.double({ min: 20, max: VP.w - 20, noNaN: true }), fc.double({ min: 20, max: VP.h - 20, noNaN: true }), fc.double({ min: 0, max: 1, noNaN: true }), (x, y, t) => {
        // Anchor taken from the bird's-eye view; the ego end is then solved through the rig (below); here both ends
        // hold it by construction: put the ego pose's view of the anchor on the same screen point.
        const a = unprojectToTable(bird, 0, VP, x, y)!;
        const s = { x, y };
        const egoAt = screenOf(ego, 0, a);
        // Only anchors the ego end shows at the same place are exact; elsewhere the error moves on a straight line.
        const p = blendPose(bird, ego, t, VP, { table: a, screen: s });
        const expected = { x: s.x + (egoAt.x - s.x) * t, y: s.y + (egoAt.y - s.y) * t };
        expect(px(screenOf(p, 0, a), expected)).toBeLessThan(0.01);
      }),
      { numRuns: 300 },
    );
  });

  it('eases in and out', () => {
    expect(easeBlend(0)).toBe(0);
    expect(easeBlend(1)).toBe(1);
    expect(easeBlend(0.5)).toBeCloseTo(0.5, 9);
    expect(easeBlend(0.1)).toBeLessThan(0.1);
    expect(easeBlend(0.9)).toBeGreaterThan(0.9);
  });
});

describe('rig switch (P)', () => {
  const anchors = fc.record({ x: fc.double({ min: 10, max: VP.w - 10, noNaN: true }), y: fc.double({ min: 10, max: VP.h - 10, noNaN: true }) });

  it('bird\'s-eye to ego: the table point under the cursor moves less than 2 px during the whole blend (property)', () => {
    fc.assert(
      fc.property(anchors, fc.constantFrom(0, 90, 180, 270), fc.constantFrom(...Object.values(TABLES)), fc.double({ min: 1, max: 4, noNaN: true }), (s, angle, table, zoom) => {
        const rig = makeRig({ angle, table });
        rig.zoomAt(s.x, s.y, zoom);
        const a = rig.screenToTable(s.x, s.y);
        const before = rig.tableToScreen(a);
        expect(px(before, s)).toBeLessThan(1e-6);
        const { poses, blending } = runSwitch(rig, 'ego', s);
        // The ego destination holds it too unless the rig's limits cannot (checked separately).
        const end = screenOf(poses.at(-1)!, angle, a);
        if (px(end, s) < 0.5) {
          for (const p of poses) expect(px(screenOf(p, angle, a), s)).toBeLessThan(2);
        }
        expect(blending.some(Boolean)).toBe(true);
        expect(rig.rig()).toBe('ego');
        expect(rig.blendState()).toBeNull();
        expect(poses.at(-1)!.fovDeg).toBe(45);
      }),
      { numRuns: 200 },
    );
  });

  it('bird\'s-eye to ego holds the cursor point exactly for cursors over the middle of a fitted table', () => {
    const rig = makeRig();
    // A grid over the middle of the screen: the table where players look when they press P.
    for (const fx of [0.3, 0.5, 0.7]) {
      for (const fy of [0.3, 0.5, 0.7]) {
        const r = makeRig();
        const s = { x: VP.w * fx, y: VP.h * fy };
        const a = r.screenToTable(s.x, s.y);
        const { poses } = runSwitch(r, 'ego', s);
        const worst = Math.max(...poses.map((p) => px(screenOf(p, 0, a), s)));
        expect(worst, `cursor at ${fx}, ${fy}`).toBeLessThan(2);
      }
    }
    expect(rig.rig()).toBe('birdseye');
  });

  it('ego to bird\'s-eye: the table point under the cursor moves less than 2 px (property)', () => {
    fc.assert(
      fc.property(anchors, fc.constantFrom(0, 90, 180, 270), fc.constantFrom(...Object.values(TABLES)), (s, angle, table) => {
        const rig = makeRig({ rig: 'ego', angle, table });
        const a = rig.screenToTableOrNull(s.x, s.y);
        if (!a) return;
        const { poses } = runSwitch(rig, 'birdseye', s);
        const end = screenOf(poses.at(-1)!, angle, a);
        if (px(end, s) < 0.5) {
          for (const p of poses) expect(px(screenOf(p, angle, a), s)).toBeLessThan(2);
        }
        expect(poses.at(-1)!.fovDeg).toBe(6);
        expect(poses.at(-1)!.pitchDeg).toBeCloseTo(90, 9);
      }),
      { numRuns: 200 },
    );
  });

  it('ego to bird\'s-eye holds the point for every cursor over the table seen in ego', () => {
    const rig = makeRig({ rig: 'ego' });
    let checked = 0;
    for (let fx = 0.1; fx < 0.95; fx += 0.2) {
      for (let fy = 0.3; fy < 0.95; fy += 0.2) {
        const r = makeRig({ rig: 'ego' });
        const s = { x: VP.w * fx, y: VP.h * fy };
        const a = r.screenToTableOrNull(s.x, s.y)!;
        // Only table points: the bird's-eye view is clamped to keep its centre on the table.
        if (Math.abs(a.x) > 700 || Math.abs(a.y) > 550) continue;
        const { poses } = runSwitch(r, 'birdseye', s);
        const worst = Math.max(...poses.map((p) => px(screenOf(p, 0, a), s)));
        expect(worst, `cursor at ${fx.toFixed(1)}, ${fy.toFixed(1)}`).toBeLessThan(2);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(8);
    expect(rig.rig()).toBe('ego');
  });

  it('without a cursor the viewport centre is the anchor', () => {
    const rig = makeRig();
    const c = { x: VP.w / 2, y: VP.h / 2 };
    const a = rig.screenToTable(c.x, c.y);
    const { poses } = runSwitch(rig, 'ego', null);
    for (const p of poses) expect(px(screenOf(p, 0, a), c)).toBeLessThan(2);
  });

  it('the blend lasts the theme\'s camera blend time (400 ms) and reports its progress', () => {
    const rig = makeRig();
    rig.setRig('ego', 0, BLEND_MS, { x: 700, y: 400 });
    rig.step(0, 0);
    expect(rig.blendState()).toMatchObject({ from: 'birdseye', to: 'ego', t: 0, durationMs: 400 });
    rig.step(200, 200);
    expect(rig.blendState()!.t).toBeCloseTo(0.5, 9);
    rig.step(399, 199);
    expect(rig.blendState()).not.toBeNull();
    rig.step(400, 1);
    expect(rig.blendState()).toBeNull();
    expect(rig.moving).toBe(false);
  });

  it('switching back mid-blend is continuous: it blends back from where the camera is', () => {
    const rig = makeRig();
    const s = { x: 800, y: 500 };
    const a = rig.screenToTable(s.x, s.y);
    rig.setRig('ego', 0, BLEND_MS, s);
    rig.step(150, 150);
    const mid = rig.pose();
    rig.setRig('birdseye', 150, BLEND_MS, s);
    expect(rig.pose()).toEqual(mid);
    expect(rig.blendState()).toMatchObject({ from: 'ego', to: 'birdseye' });
    for (let t = 150; t <= 600; t += 10) {
      rig.step(t, 10);
      expect(px(rig.tableToScreen(a), s)).toBeLessThan(2);
    }
    expect(rig.rig()).toBe('birdseye');
  });

  it('with reduced motion (duration 0) the switch is a cut', () => {
    const rig = makeRig();
    const s = { x: 600, y: 420 };
    const a = rig.screenToTable(s.x, s.y);
    rig.setRig('ego', 0, 0, s);
    // Immediately, before any frame: no blend, the ego pose.
    expect(rig.blendState()).toBeNull();
    expect(rig.moving).toBe(false);
    expect(rig.rig()).toBe('ego');
    expect(rig.pose().fovDeg).toBe(45);
    expect(rig.pose()).toEqual(rig.restPose('ego'));
    // A cut still lands with the point under the cursor.
    expect(px(rig.tableToScreen(a), s)).toBeLessThan(2);
    rig.setRig('birdseye', 0, 0, s);
    expect(rig.blendState()).toBeNull();
    expect(rig.pose().fovDeg).toBe(6);
  });

  it('gestures wait while the rigs blend (the blend owns the camera)', () => {
    const rig = makeRig();
    rig.setRig('ego', 0, BLEND_MS, null);
    rig.step(100, 100);
    const p = rig.pose();
    rig.panBy(200, 100);
    rig.zoomAt(100, 100, 3);
    rig.pitchBy(10);
    rig.fling(5, 5);
    expect(rig.pose()).toEqual(p);
  });

  it('a tilted bird\'s-eye (Dusk) blends with the cursor point fixed as well', () => {
    const rig = makeRig({ tiltDeg: 10 });
    expect(rig.pose().pitchDeg).toBe(80);
    const s = { x: 720, y: 450 };
    const a = rig.screenToTable(s.x, s.y);
    const { poses } = runSwitch(rig, 'ego', s);
    for (const p of poses) expect(px(screenOf(p, 0, a), s)).toBeLessThan(2);
    const back = runSwitch(rig, 'birdseye', s);
    for (const p of back.poses) expect(px(screenOf(p, 0, a), s)).toBeLessThan(2);
    expect(rig.pose().pitchDeg).toBe(80);
  });

  it('returns to the bird\'s-eye zoom the viewer left', () => {
    const rig = makeRig();
    rig.zoomAt(720, 450, 2.5);
    const dist = rig.bird.view.dist;
    runSwitch(rig, 'ego', { x: 720, y: 450 });
    runSwitch(rig, 'birdseye', { x: 720, y: 450 });
    expect(rig.bird.view.dist).toBeCloseTo(dist, 6);
  });

  it('the camera stays above the table throughout a blend', () => {
    fc.assert(
      fc.property(anchors, fc.constantFrom(0, 90, 180, 270), (s, angle) => {
        const rig = makeRig({ angle });
        const there = runSwitch(rig, 'ego', s);
        const back = runSwitch(rig, 'birdseye', s);
        for (const p of [...there.poses, ...back.poses]) expect(p.position[2]).toBeGreaterThan(DEFAULT_EGO_RIG.minHeight - 1e-6);
      }),
      { numRuns: 100 },
    );
  });
});
