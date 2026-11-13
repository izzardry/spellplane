// PLAN M4-P1 acceptance: "the ego camera never passes below the table edge". DESIGN "Camera and navigation", Ego
// perspective: a perspective camera at the player's seat, tilted roughly 35° below horizontal; the player can lean
// (pan), dolly (zoom) and pitch within limits; the camera never goes below the table edge or behind the seat.
// "Specification: geometry, layout and motion", Camera rigs: field of view 45°, 260 behind the viewer's table edge and
// 620 above the table, pitched 35°, pitch adjustable between 25° and 60°. Limits beyond the spec: DEFAULT_EGO_RIG
// (DECISIONS [M4-C]).
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { clampEgoNav, defaultEgoNav, egoLimitsFor, egoPose, egoSeat, halfDepth, halfWidth, maxDollyAt } from '../../../src/scene/camera/ego';
import { basis, dot, sub } from '../../../src/scene/camera/pose';
import type { TableRig } from '../../../src/scene/camera/rig';
import { forward } from '../../../src/scene/math';
import { DEFAULT_EGO_RIG, type CameraPose } from '../../../src/scene/types';
import { TABLES, VP, makeRig, px, screenOf } from './helpers';

const P = DEFAULT_EGO_RIG;

/** How far the camera is in front of the seat along the viewer's forward axis (negative: behind the seat). */
function aheadOfSeat(pose: CameraPose, angle: number, table: { w: number; d: number }): number {
  const seat = egoSeat(P, table, angle);
  const f = forward(angle);
  return (pose.position[0] - seat[0]) * f.x + (pose.position[1] - seat[1]) * f.y;
}

describe('ego rig pose', () => {
  it('sits 260 behind the viewer\'s table edge, 620 above the table, pitched 35°, with a 45° field of view', () => {
    const pose = egoPose(P, TABLES['1v1'], 0, defaultEgoNav(P));
    expect(pose.fovDeg).toBe(45);
    expect(pose.pitchDeg).toBe(35);
    expect(pose.position[0]).toBeCloseTo(0, 9);
    expect(pose.position[1]).toBeCloseTo(-550 - 260, 9);
    expect(pose.position[2]).toBeCloseTo(620, 9);
    // The view ray hits the table 620 / tan 35° ahead of the seat.
    expect(pose.target[1]).toBeCloseTo(-810 + 620 / Math.tan((35 * Math.PI) / 180), 6);
    expect(pose.target[2]).toBe(0);
  });

  it('stands behind each viewer\'s own edge, whatever their seat', () => {
    for (const [angle, table, expected] of [
      [180, TABLES['1v1'], [0, 810]],
      [90, TABLES.ffa4, [-1160, 0]],
      [270, TABLES.ffa4, [1160, 0]],
      [0, TABLES['2hg'], [0, -810]],
    ] as const) {
      const pose = egoPose(P, table, angle, defaultEgoNav(P));
      expect(pose.position[0]).toBeCloseTo(expected[0], 6);
      expect(pose.position[1]).toBeCloseTo(expected[1], 6);
      // Looking toward the table centre.
      const f = forward(angle);
      expect((pose.target[0] - pose.position[0]) * f.x + (pose.target[1] - pose.position[1]) * f.y).toBeGreaterThan(0);
    }
  });

  it('the seat follows the viewer\'s territory sideways (shared edges)', () => {
    const pose = egoPose(P, TABLES['2hg'], 0, defaultEgoNav(P), -550);
    expect(pose.position[0]).toBeCloseTo(-550, 6);
    expect(halfDepth(TABLES['2hg'], 0)).toBe(550);
  });

  it('a seat-0 viewer sees their side at the bottom of the screen and the far side at the top', () => {
    const pose = egoPose(P, TABLES['1v1'], 0, defaultEgoNav(P));
    const near = screenOf(pose, 0, { x: 0, y: -300 });
    const far = screenOf(pose, 0, { x: 0, y: 300 });
    expect(near.y).toBeGreaterThan(far.y);
    const left = screenOf(pose, 0, { x: -300, y: 0 });
    const right = screenOf(pose, 0, { x: 300, y: 0 });
    expect(left.x).toBeLessThan(right.x);
    // Own cards are larger than the opponents' (perspective).
    const nearCard = Math.abs(screenOf(pose, 0, { x: 0, y: -256 }).y - screenOf(pose, 0, { x: 0, y: -344 }).y);
    const farCard = Math.abs(screenOf(pose, 0, { x: 0, y: 344 }).y - screenOf(pose, 0, { x: 0, y: 256 }).y);
    expect(nearCard).toBeGreaterThan(1.5 * farCard);
  });
});

describe('ego limits', () => {
  it('clamps pitch to 25°..60°, lean to ±400 and dolly to 0..700 above the minimum height', () => {
    expect(clampEgoNav(P, { lean: 9999, dolly: 9999, pitchDeg: 89 })).toEqual({ lean: 400, dolly: maxDollyAt(P, 60), pitchDeg: 60 });
    expect(clampEgoNav(P, { lean: -9999, dolly: -50, pitchDeg: 0 })).toEqual({ lean: -400, dolly: 0, pitchDeg: 25 });
    expect(clampEgoNav(P, { lean: NaN, dolly: NaN, pitchDeg: NaN })).toEqual(defaultEgoNav(P));
    // At 35° the dolly limit is the rig's 700; at 60° the minimum height binds first.
    expect(maxDollyAt(P, 35)).toBe(700);
    expect(maxDollyAt(P, 60)).toBeCloseTo((620 - 120) / Math.sin(Math.PI / 3), 9);
  });

  it('never below the table edge, never behind the seat, for any navigation (property)', () => {
    fc.assert(
      fc.property(
        fc.double({ min: -5000, max: 5000, noNaN: true }),
        fc.double({ min: -5000, max: 5000, noNaN: true }),
        fc.double({ min: -180, max: 180, noNaN: true }),
        fc.constantFrom(0, 90, 180, 270),
        fc.constantFrom(...Object.values(TABLES)),
        (lean, dolly, pitchDeg, angle, table) => {
          const pose = egoPose(P, table, angle, { lean, dolly, pitchDeg });
          expect(pose.position[2]).toBeGreaterThanOrEqual(P.minHeight - 1e-9);
          expect(aheadOfSeat(pose, angle, table)).toBeGreaterThanOrEqual(-1e-9);
          expect(pose.pitchDeg).toBeGreaterThanOrEqual(25);
          expect(pose.pitchDeg).toBeLessThanOrEqual(60);
          // The camera looks at the table from above it: its view direction points down.
          expect(basis(angle, pose.pitchDeg).d[2]).toBeLessThan(0);
        },
      ),
      { numRuns: 500 },
    );
  });

  type Gesture =
    | { kind: 'pan'; dx: number; dy: number }
    | { kind: 'zoom'; x: number; y: number; f: number }
    | { kind: 'pitch'; deg: number }
    | { kind: 'fling'; vx: number; vy: number }
    | { kind: 'seat'; x: number; y: number }
    | { kind: 'card'; x: number; y: number }
    | { kind: 'fit' };
  const gesture: fc.Arbitrary<Gesture> = fc.oneof(
    fc.record({ kind: fc.constant('pan' as const), dx: fc.double({ min: -3000, max: 3000, noNaN: true }), dy: fc.double({ min: -3000, max: 3000, noNaN: true }) }),
    fc.record({ kind: fc.constant('zoom' as const), x: fc.double({ min: 0, max: VP.w, noNaN: true }), y: fc.double({ min: 0, max: VP.h, noNaN: true }), f: fc.double({ min: 0.05, max: 20, noNaN: true }) }),
    fc.record({ kind: fc.constant('pitch' as const), deg: fc.double({ min: -120, max: 120, noNaN: true }) }),
    fc.record({ kind: fc.constant('fling' as const), vx: fc.double({ min: -20, max: 20, noNaN: true }), vy: fc.double({ min: -20, max: 20, noNaN: true }) }),
    fc.record({ kind: fc.constant('seat' as const), x: fc.double({ min: -900, max: 900, noNaN: true }), y: fc.double({ min: -900, max: 900, noNaN: true }) }),
    fc.record({ kind: fc.constant('card' as const), x: fc.double({ min: -1100, max: 1100, noNaN: true }), y: fc.double({ min: -900, max: 900, noNaN: true }) }),
    fc.constant({ kind: 'fit' as const }),
  );

  function apply(rig: TableRig, g: Gesture, now: number): void {
    if (g.kind === 'pan') rig.panBy(g.dx, g.dy);
    else if (g.kind === 'zoom') rig.zoomAt(g.x, g.y, g.f);
    else if (g.kind === 'pitch') rig.pitchBy(g.deg);
    else if (g.kind === 'fling') rig.fling(g.vx, g.vy);
    else if (g.kind === 'seat') rig.goToRect({ x: g.x, y: g.y, w: 1100, d: 440, rot: 0 }, now, 400);
    else if (g.kind === 'card') rig.focus({ x: g.x, y: g.y }, 'close', now, 400);
    else rig.fit(now, 400);
  }

  it('no sequence of gestures takes the camera below the table edge or behind the seat (property)', () => {
    fc.assert(
      fc.property(fc.array(gesture, { minLength: 1, maxLength: 25 }), fc.constantFrom(0, 90, 180, 270), fc.constantFrom(...Object.values(TABLES)), (gs, angle, table) => {
        const rig = makeRig({ rig: 'ego', angle, table });
        let now = 0;
        for (const g of gs) {
          apply(rig, g, now);
          // Let eases and inertia run, checking every frame.
          for (let i = 0; i < 30; i++) {
            now += 16;
            rig.step(now, 16);
            const pose = rig.pose();
            expect(pose.position[2]).toBeGreaterThanOrEqual(P.minHeight - 1e-6);
            expect(aheadOfSeat(pose, angle, table)).toBeGreaterThanOrEqual(-1e-6);
            expect(pose.pitchDeg).toBeGreaterThanOrEqual(25 - 1e-9);
            expect(pose.pitchDeg).toBeLessThanOrEqual(60 + 1e-9);
            // The lean reaches the table's far side edge from the seat (DECISIONS [M4-P1]), never further.
            expect(Math.abs(rig.nav.lean)).toBeLessThanOrEqual(Math.max(P.leanMm, halfWidth(table, angle)) + 1e-9);
          }
        }
      }),
      { numRuns: 150 },
    );
  });

  it('pitch is the ego rig\'s alone, within 25°..60°', () => {
    const rig = makeRig({ rig: 'ego' });
    rig.pitchBy(10);
    expect(rig.pose().pitchDeg).toBeCloseTo(45, 9);
    rig.pitchBy(1000);
    expect(rig.pose().pitchDeg).toBe(60);
    rig.pitchBy(-1000);
    expect(rig.pose().pitchDeg).toBe(25);
    const bird = makeRig();
    const before = bird.pose();
    bird.pitchBy(20);
    expect(bird.pose()).toEqual(before);
  });

  it('a steep pitch with the dolly at its limit lifts the camera back to the minimum height', () => {
    const rig = makeRig({ rig: 'ego' });
    rig.zoomAt(720, 450, 50);
    expect(rig.nav.dolly).toBeGreaterThan(0);
    rig.pitchBy(100);
    expect(rig.pose().position[2]).toBeGreaterThanOrEqual(P.minHeight - 1e-9);
  });
});

describe('ego lean limit', () => {
  it('reaches the table\'s far side edge from the seat, on every table and seat angle', () => {
    expect(egoLimitsFor(P, TABLES['1v1'], 0).leanMm).toBe(700);
    expect(egoLimitsFor(P, TABLES['1v1'], 90).leanMm).toBe(550);
    expect(egoLimitsFor(P, TABLES.ffa3, 0, 0).leanMm).toBe(1000);
    expect(egoLimitsFor(P, TABLES.ffa3, 180, 500).leanMm).toBe(1500);
    expect(egoLimitsFor(P, TABLES['2hg'], 0, -550).leanMm).toBe(1650);
    // A theme's wider lean is kept; everything else is the theme's.
    expect(egoLimitsFor({ ...P, leanMm: 2000 }, TABLES['1v1'], 0)).toEqual({ ...P, leanMm: 2000 });
  });

  it('the rig uses it, and a new seat offset widens it', () => {
    const rig = makeRig({ rig: 'ego', table: TABLES['2hg'], lateral: 550 });
    expect(rig.ego.leanMm).toBe(1650);
    expect(rig.egoParams.leanMm).toBe(400);
    rig.panBy(1e6, 0);
    expect(rig.nav.lean).toBe(-1650);
  });
});

describe('ego navigation gestures', () => {
  it('pan leans sideways and dollies toward the table, both clamped', () => {
    const rig = makeRig({ rig: 'ego' });
    const x0 = rig.pose().position[0];
    rig.panBy(-100, 0);
    // Dragging the table left moves the camera right.
    expect(rig.pose().position[0]).toBeGreaterThan(x0);
    rig.panBy(-1e6, 0);
    // Leaning stops over the table's side edge: half the 1v1 table's 1400 mm width.
    expect(rig.nav.lean).toBe(700);
    const d0 = rig.nav.dolly;
    rig.panBy(0, 100);
    expect(rig.nav.dolly).toBeGreaterThan(d0);
    rig.panBy(0, -1e6);
    expect(rig.nav.dolly).toBe(0);
  });

  it('wheel zoom dollies toward the cursor and keeps its table point under it', () => {
    const rig = makeRig({ rig: 'ego' });
    const s = { x: 900, y: 520 };
    const a = rig.screenToTable(s.x, s.y);
    const d0 = Math.hypot(...(sub([a.x, a.y, 0], rig.pose().position) as [number, number, number]));
    rig.zoomAt(s.x, s.y, 1.3);
    const d1 = Math.hypot(...(sub([a.x, a.y, 0], rig.pose().position) as [number, number, number]));
    expect(d1).toBeLessThan(d0);
    expect(px(rig.tableToScreen(a), s)).toBeLessThan(2);
    // Zooming out never goes behind the seat.
    rig.zoomAt(s.x, s.y, 0.01);
    expect(rig.nav.dolly).toBe(0);
  });

  it('fit (0) shows the viewer\'s near and far table edges', () => {
    const rig = makeRig({ rig: 'ego' });
    rig.panBy(300, 200);
    rig.pitchBy(20);
    rig.fit(0, 0);
    for (const y of [-550, 550]) {
      const s = rig.tableToScreen({ x: 0, y });
      expect(s.y).toBeGreaterThanOrEqual(0);
      expect(s.y).toBeLessThanOrEqual(VP.h);
    }
    expect(rig.nav).toMatchObject({ lean: 0, dolly: 0 });
  });

  it('go to a seat (1–4, avatar tap) centres that territory; zoom to a card brings it close', () => {
    const rig = makeRig({ rig: 'ego' });
    const far = { x: 0, y: 330, w: 1400, d: 440, rot: 180 };
    rig.goToRect(far, 0, 0);
    const s = rig.tableToScreen(far);
    expect(px(s, { x: VP.w / 2, y: VP.h / 2 })).toBeLessThan(2);
    const own = { x: 0, y: -330, w: 1400, d: 440, rot: 0 };
    rig.goToRect(own, 0, 0);
    // The own territory is near the seat: the pitch limit may keep its centre a little above the screen centre.
    expect(rig.tableToScreen(own).y).toBeGreaterThan(VP.h * 0.3);
    const before = Math.hypot(...(sub(rig.pose().target, rig.pose().position) as [number, number, number]));
    rig.focus({ x: 200, y: 100 }, 'close', 0, 0);
    const after = Math.hypot(...(sub(rig.pose().target, rig.pose().position) as [number, number, number]));
    expect(after).toBeLessThan(before);
    expect(px(rig.tableToScreen({ x: 200, y: 100 }), { x: VP.w / 2, y: VP.h / 2 })).toBeLessThan(2);
  });

  it('moves ease over the blend time and cut with reduced motion', () => {
    const rig = makeRig({ rig: 'ego' });
    rig.goToRect({ x: 0, y: 330, w: 1400, d: 440, rot: 180 }, 0, 400);
    expect(rig.moving).toBe(true);
    const start = rig.pose();
    rig.step(200, 200);
    expect(rig.pose()).not.toEqual(start);
    rig.step(400, 200);
    expect(rig.moving).toBe(false);
    const cut = makeRig({ rig: 'ego' });
    cut.goToRect({ x: 0, y: 330, w: 1400, d: 440, rot: 180 }, 0, 0);
    expect(cut.moving).toBe(false);
    expect(cut.pose()).toEqual(rig.pose());
  });

  it('pan inertia decays and stops in the ego rig too', () => {
    const rig = makeRig({ rig: 'ego' });
    rig.fling(1, 0);
    expect(rig.moving).toBe(true);
    let now = 0;
    for (let i = 0; i < 500 && rig.moving; i++) rig.step((now += 16), 16);
    expect(rig.moving).toBe(false);
    expect(rig.nav.lean).toBeLessThan(0);
  });

  it('table points project and unproject consistently', () => {
    const rig = makeRig({ rig: 'ego', angle: 90, table: TABLES.ffa4 });
    for (const p of [{ x: 0, y: 0 }, { x: -500, y: 200 }, { x: 300, y: -400 }]) {
      const s = rig.tableToScreen(p);
      const q = rig.screenToTable(s.x, s.y);
      expect(q.x).toBeCloseTo(p.x, 6);
      expect(q.y).toBeCloseTo(p.y, 6);
    }
    // Above the horizon there is no table: the point is far away, where nothing is.
    const sky = rig.screenToTableOrNull(VP.w / 2, -5000);
    expect(sky).toBeNull();
    const far = rig.screenToTable(VP.w / 2, -5000);
    expect(Math.hypot(far.x, far.y)).toBeGreaterThan(1e5);
    // A point behind the camera is off screen.
    const pose = rig.pose();
    const behind = { x: pose.position[0] - 500, y: pose.position[1] };
    expect(rig.depthOf(behind)).toBeLessThan(0);
    expect(rig.shows(behind)).toBe(false);
    expect(dot([1, 0, 0], [1, 0, 0])).toBe(1);
  });
});

describe('per-point scale (texture tiers by on-screen height)', () => {
  it('straight down every table point shows at the view centre\'s scale; in ego near points show larger than far ones', () => {
    const bird = makeRig();
    for (const p of [{ x: 0, y: 0 }, { x: -600, y: 500 }, { x: 650, y: -500 }]) expect(bird.pxPerMmAt(p)).toBeCloseTo(bird.pxPerMm(), 9);
    const ego = makeRig({ rig: 'ego' });
    const centre = ego.pose().target;
    expect(ego.pxPerMmAt({ x: centre[0], y: centre[1] })).toBeCloseTo(ego.pxPerMm(), 9);
    const near = ego.pxPerMmAt({ x: 0, y: -200 });
    const far = ego.pxPerMmAt({ x: 0, y: 420 });
    expect(near).toBeGreaterThan(ego.pxPerMm());
    expect(far).toBeLessThan(ego.pxPerMm());
    // A card's size on screen scales with 1 / depth.
    expect(near / far).toBeCloseTo(ego.depthOf({ x: 0, y: 420 }) / ego.depthOf({ x: 0, y: -200 }), 9);
    // Behind the camera: no size.
    expect(ego.pxPerMmAt({ x: 0, y: -2000 })).toBe(0);
  });
});
