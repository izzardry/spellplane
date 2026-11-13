// PLAN M4-P1 acceptance: "During a blend the world point under the cursor moves less than 2 px"; "the ego camera never
// passes below the table edge". DESIGN "Camera and navigation", Switching: "The point under the cursor stays under the
// cursor"; Ego perspective: "the camera never goes below the table edge or behind the seat". M4-P1 review round: the
// switch in both directions from views reached by the viewer's own gestures (pan, zoom at the cursor, pitch), on every
// table format and seat, at several viewport sizes, with and without the HUD's fit insets and the tilted bird's-eye
// (Dusk), with the cursor anywhere over the table.
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { EGO_PITCH_HARD, egoSeat } from '../../../src/scene/camera/ego';
import { projectPoint } from '../../../src/scene/camera/pose';
import { TableRig } from '../../../src/scene/camera/rig';
import { forward } from '../../../src/scene/math';
import type { CameraPose, CameraRig, ScreenPoint, TablePoint } from '../../../src/scene/types';
import { SEATS, onTable } from './helpers';

const VIEWPORTS = [
  { w: 1440, h: 900 },
  { w: 1280, h: 720 },
  { w: 1920, h: 1080 },
  { w: 900, h: 1200 },
  { w: 2560, h: 1080 },
] as const;
/** The HUD's fit insets at 900 px with the log open (ui/hand.ts fitInsets): the bird's-eye frames the table clear of them. */
const HUD_INSETS = { top: 74, right: 316, bottom: 206, left: 190 };

type Seat = (typeof SEATS)[number];
type Vp = (typeof VIEWPORTS)[number];

function rigAt(seat: Seat, vp: Vp, rig: CameraRig, tiltDeg: number, insets: boolean): TableRig {
  const r = new TableRig({ table: seat.table, viewport: { ...vp }, angle: seat.angle, inertiaMs: 325, rig, tiltDeg, lateral: seat.lateral });
  if (insets) {
    r.setInsets(HUD_INSETS);
    r.bird.view = r.bird.fitView();
  }
  return r;
}

const screenOf = (pose: CameraPose, angle: number, vp: Vp, a: TablePoint): ScreenPoint => {
  const s = projectPoint(pose, angle, vp, [a.x, a.y, 0]);
  return { x: s.x, y: s.y };
};
const dist = (a: ScreenPoint, b: ScreenPoint) => (Number.isFinite(a.x) && Number.isFinite(a.y) ? Math.hypot(a.x - b.x, a.y - b.y) : Infinity);

/** How far the camera stands in front of the viewer's seat along their forward axis (negative: behind it). */
function aheadOfSeat(r: TableRig, pose: CameraPose): number {
  const seat = egoSeat(r.ego, r.table, r.angle, r.lateral);
  const f = forward(r.angle);
  return (pose.position[0] - seat[0]) * f.x + (pose.position[1] - seat[1]) * f.y;
}

/** Switch rigs at `s` and sample the whole 400 ms blend every 2 ms: the cursor point's worst drift, in px. */
function switchDrift(r: TableRig, to: CameraRig, s: ScreenPoint, a: TablePoint, vp: Vp): number {
  let worst = 0;
  r.setRig(to, 0, 400, s);
  for (let t = 0; t <= 404; t += 2) {
    r.step(t, 2);
    worst = Math.max(worst, dist(screenOf(r.pose(), r.angle, vp, a), s));
  }
  expect(r.blendState()).toBeNull();
  return worst;
}

type Gesture = { kind: 'pan'; dx: number; dy: number } | { kind: 'zoom'; x: number; y: number; f: number } | { kind: 'pitch'; deg: number };
// Uniform over 0..1 (fast-check's doubles favour tiny values and the ends: the screen's corners, mostly the surround).
const unit = fc.noBias(fc.integer({ min: 0, max: 100_000 })).map((v) => v / 100_000);
const between = (min: number, max: number) => unit.map((u) => min + (max - min) * u);
const gesture: fc.Arbitrary<Gesture> = fc.oneof(
  fc.record({ kind: fc.constant('pan' as const), dx: between(-1500, 1500), dy: between(-800, 800) }),
  fc.record({ kind: fc.constant('zoom' as const), x: unit, y: unit, f: between(-0.7, 1.8).map(Math.exp) }),
  fc.record({ kind: fc.constant('pitch' as const), deg: between(-40, 40) }),
);
function apply(r: TableRig, g: Gesture): void {
  if (g.kind === 'pan') r.panBy(g.dx, g.dy);
  else if (g.kind === 'zoom') r.zoomAt(g.x * r.viewport.w, g.y * r.viewport.h, g.f);
  else r.pitchBy(g.deg);
}
const setup = fc.record({
  seat: fc.constantFrom(...SEATS),
  vp: fc.constantFrom(...VIEWPORTS),
  tilt: fc.constantFrom(0, 10),
  insets: fc.boolean(),
  gestures: fc.array(gesture, { maxLength: 6 }),
  cursor: fc.record({ x: unit, y: unit }),
});

describe('rig switch from anywhere the viewer can navigate (M4-P1 review)', () => {
  it('bird\'s-eye panned and zoomed by the viewer to ego: the cursor\'s table point moves less than 2 px (property)', () => {
    let checked = 0;
    fc.assert(
      fc.property(setup, ({ seat, vp, tilt, insets, gestures, cursor }) => {
        const r = rigAt(seat, vp, 'birdseye', tilt, insets);
        for (const g of gestures) apply(r, g);
        const s = { x: cursor.x * vp.w, y: cursor.y * vp.h };
        const a = r.screenToTableOrNull(s.x, s.y);
        if (!a || !onTable(seat.table, a)) return;
        checked++;
        const drift = switchDrift(r, 'ego', s, a, vp);
        expect(drift, `${seat.format} seat ${seat.seat} ${vp.w}x${vp.h} nav ${JSON.stringify(r.nav)}`).toBeLessThan(2);
        expect(r.rig()).toBe('ego');
      }),
      { numRuns: 1500, seed: 4101 },
    );
    expect(checked).toBeGreaterThan(500);
  });

  it('ego leaned, dollied and pitched by the viewer to bird\'s-eye: the cursor\'s table point moves less than 2 px (property)', () => {
    let checked = 0;
    fc.assert(
      fc.property(setup, ({ seat, vp, tilt, insets, gestures, cursor }) => {
        const r = rigAt(seat, vp, 'ego', tilt, insets);
        for (const g of gestures) apply(r, g);
        const s = { x: cursor.x * vp.w, y: cursor.y * vp.h };
        const a = r.screenToTableOrNull(s.x, s.y);
        if (!a || !onTable(seat.table, a)) return;
        checked++;
        expect(switchDrift(r, 'birdseye', s, a, vp), `${seat.format} seat ${seat.seat} ${vp.w}x${vp.h} nav ${JSON.stringify(r.nav)}`).toBeLessThan(2);
      }),
      { numRuns: 1500, seed: 4102 },
    );
    // Much of an ego view shows the surround or the sky: about one cursor in ten is over the table.
    expect(checked).toBeGreaterThan(100);
  });

  it('back and forth with fresh cursors (P, look elsewhere, P): every switch holds its cursor point (property)', () => {
    fc.assert(
      fc.property(setup, fc.array(fc.record({ x: unit, y: unit }), { minLength: 2, maxLength: 4 }), ({ seat, vp, tilt, insets, gestures }, cursors) => {
        const r = rigAt(seat, vp, 'birdseye', tilt, insets);
        for (const g of gestures) apply(r, g);
        for (const c of cursors) {
          const s = { x: c.x * vp.w, y: c.y * vp.h };
          const a = r.screenToTableOrNull(s.x, s.y);
          const to: CameraRig = r.rig() === 'ego' ? 'birdseye' : 'ego';
          if (!a || !onTable(seat.table, a)) {
            r.setRig(to, 0, 0, s);
            continue;
          }
          expect(switchDrift(r, to, s, a, vp), `${seat.format} seat ${seat.seat} ${vp.w}x${vp.h} to ${to}`).toBeLessThan(2);
        }
      }),
      { numRuns: 400, seed: 4103 },
    );
  });

  it('a switch to ego never puts the camera below the table edge or behind the seat, and looks down at the table (property)', () => {
    fc.assert(
      fc.property(setup, ({ seat, vp, tilt, insets, gestures, cursor }) => {
        const r = rigAt(seat, vp, 'birdseye', tilt, insets);
        for (const g of gestures) apply(r, g);
        const s = { x: cursor.x * vp.w, y: cursor.y * vp.h };
        r.setRig('ego', 0, 400, s);
        for (let t = 0; t <= 404; t += 4) {
          r.step(t, 4);
          expect(r.pose().position[2]).toBeGreaterThanOrEqual(r.ego.minHeight - 1e-6);
        }
        const pose = r.pose();
        expect(aheadOfSeat(r, pose)).toBeGreaterThanOrEqual(-1e-6);
        expect(pose.pitchDeg).toBeGreaterThanOrEqual(EGO_PITCH_HARD.min - 1e-9);
        expect(pose.pitchDeg).toBeLessThanOrEqual(EGO_PITCH_HARD.max + 1e-9);
      }),
      { numRuns: 600, seed: 4104 },
    );
  });

  // The ego rig can show a table point at a screen point only from some seats of the camera: from the seat, the
  // viewer's own near cards never show at the top of the screen within the 25°..60° pitch, nor the far side at the
  // bottom. A switch that needs such a view lands beyond the limits; the next gestures keep it or bring it back
  // toward them, never further out, and never jump.
  it('an ego view landed beyond the limits: gestures never push it further out and never jump (property)', () => {
    const P = (r: TableRig) => r.ego;
    /** How far a navigation lies outside the rig's limits, per value. */
    const outside = (r: TableRig) => {
      const p = P(r);
      const n = r.nav;
      return {
        lean: Math.max(0, Math.abs(n.lean) - p.leanMm),
        dolly: Math.max(0, n.dolly - p.maxDollyMm),
        pitch: Math.max(0, p.minPitchDeg - n.pitchDeg, n.pitchDeg - p.maxPitchDeg),
      };
    };
    let landedOutside = 0;
    fc.assert(
      fc.property(setup, fc.array(gesture, { minLength: 1, maxLength: 8 }), ({ seat, vp, tilt, insets, gestures, cursor }, after) => {
        const r = rigAt(seat, vp, 'birdseye', tilt, insets);
        for (const g of gestures) apply(r, g);
        const s = { x: cursor.x * vp.w, y: cursor.y * vp.h };
        r.setRig('ego', 0, 0, s);
        let out = outside(r);
        if (out.lean + out.dolly + out.pitch === 0) return;
        landedOutside++;
        for (const g of after) {
          // A small gesture moves the view a little (no jump to the limits).
          const before = r.pose();
          const centre = { x: vp.w / 2, y: vp.h / 2 };
          const a = r.screenToTableOrNull(centre.x, centre.y);
          r.panBy(1, 1);
          if (a) expect(dist(screenOf(r.pose(), r.angle, vp, a), screenOf(before, r.angle, vp, a))).toBeLessThan(3);
          apply(r, g);
          const next = outside(r);
          expect(next.lean).toBeLessThanOrEqual(out.lean + 1e-6);
          expect(next.dolly).toBeLessThanOrEqual(out.dolly + 1e-6);
          expect(next.pitch).toBeLessThanOrEqual(out.pitch + 1e-6);
          out = next;
        }
        // Fit (0) brings the view back within the limits.
        r.fit(0, 0);
        expect(outside(r)).toEqual({ lean: 0, dolly: 0, pitch: 0 });
      }),
      { numRuns: 800, seed: 4105 },
    );
    expect(landedOutside).toBeGreaterThan(20);
  });

  // A bird's-eye centre a switch left beyond the table edge: the wheel still zooms about the cursor. Re-clamping the
  // centre there pivoted the zoom on the frozen centre instead, and one wheel tick moved the cursor's point by up to
  // about 100 px (at a table edge, the bird's-eye's own clamp moves it by under 20).
  it('bird\'s-eye centre beyond the table edge after a switch: a wheel zoom either way keeps the cursor\'s point (property)', () => {
    let checked = 0;
    fc.assert(
      fc.property(setup, fc.record({ x: unit, y: unit }), fc.constantFrom(1 / 1.16, 1.16), ({ seat, vp, tilt, insets, gestures, cursor }, wheel, f) => {
        const r = rigAt(seat, vp, 'birdseye', tilt, insets);
        r.zoomAt(vp.w / 2, vp.h / 2, 3);
        r.setRig('ego', 0, 0, null);
        for (const g of gestures) apply(r, g);
        r.panBy(cursor.x > 0.5 ? 2000 : -2000, 0);
        const s = { x: cursor.x * vp.w, y: cursor.y * vp.h };
        const a = r.screenToTableOrNull(s.x, s.y);
        if (!a || !onTable(seat.table, a)) return;
        r.setRig('birdseye', 0, 0, s);
        const v = r.bird.view;
        if (onTable(seat.table, { x: v.cx, y: v.cy })) return;
        const w = { x: wheel.x * vp.w, y: wheel.y * vp.h };
        const b = r.screenToTableOrNull(w.x, w.y);
        if (!b || !onTable(seat.table, b)) return;
        checked++;
        r.zoomAt(w.x, w.y, f);
        expect(dist(screenOf(r.pose(), r.angle, vp, b), w), `${seat.format} seat ${seat.seat} zoom ${f}`).toBeLessThan(0.01);
      }),
      { numRuns: 1500, seed: 4106 },
    );
    expect(checked).toBeGreaterThan(50);
  });
});
