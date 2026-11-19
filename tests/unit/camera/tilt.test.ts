// PLAN M7-P3 acceptance, "unit tests of the interpolation (monotonic, continuous, bounded)": the one continuous tilt
// (PLAN Milestone 7, Owner decisions after the first design round, One continuous tilt) from first person (t = 0:
// seated, looking across the table; DESIGN "Specification: geometry, layout and motion", Camera rigs: 45° field of view,
// 35° below horizontal) to bird's-eye (t = 1: straight down, 6°), interpolating pitch, height, distance, field of view
// and look-at smoothly ("no jump, no pop, no clipping into the table"), with eased spring motion and presets that snap
// softly.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { CAMERA } from '../../../src/core/geometry';
import { easeBlend } from '../../../src/scene/camera/blend';
import {
  TILT_SNAP_RADIUS,
  halfForBack,
  halfForHeight,
  snapTilt,
  springSettled,
  springStep,
  tiltBack,
  tiltDist,
  tiltFov,
  tiltHeight,
  tiltPitch,
  tiltPose,
  tiltTanHalf,
  unitTilt,
  type TiltLens,
} from '../../../src/scene/camera/tilt';
import { TILT_PRESETS } from '../../../src/scene/types';

const LENS: TiltLens = { pitch0: CAMERA.ego.pitchDeg, fov0: CAMERA.ego.fovDeg, pitch1: 90, fov1: CAMERA.birdseye.fovDeg };
// Dusk's slightly tilted bird's-eye (10° from straight down) and a theme lens of its own.
const LENSES: TiltLens[] = [LENS, { ...LENS, pitch1: 80 }, { pitch0: 30, fov0: 50, pitch1: 88, fov1: 8 }];
const unit = fc.double({ min: 0, max: 1, noNaN: true });
/** The quantities that make up the camera at a tilt, for one zoom (visible half-height at the look-at). */
const at = (l: TiltLens, t: number, half = 600) => {
  const p = tiltPose(l, t, { x: 0, y: -200, half }, 0);
  return { pitch: tiltPitch(l, t), fov: tiltFov(l, t), dist: tiltDist(l, t, half), height: tiltHeight(l, t, half), z: p.position[2], back: tiltBack(l, t, half), pose: p };
};

describe('the ends of the tilt are the design\'s two views', () => {
  it('t = 0 is first person: 35° below horizontal with a 45° field of view; t = 1 is bird\'s-eye: straight down, 6°', () => {
    expect(tiltPitch(LENS, 0)).toBe(35);
    expect(tiltFov(LENS, 0)).toBe(45);
    expect(tiltPitch(LENS, 1)).toBe(90);
    expect(tiltFov(LENS, 1)).toBe(6);
    // The middle preset is a real middle view: neither end's lens.
    const mid = TILT_PRESETS.find((p) => p.id === 'midTilt')!.tilt;
    expect(tiltPitch(LENS, mid)).toBeGreaterThan(50);
    expect(tiltPitch(LENS, mid)).toBeLessThan(75);
  });

  it('the look-at stays the view\'s centre at every tilt (the pose targets it)', () => {
    fc.assert(
      fc.property(unit, fc.double({ min: -600, max: 600, noNaN: true }), fc.double({ min: -500, max: 500, noNaN: true }), fc.constantFrom(0, 90, 180, 270), (t, x, y, angle) => {
        const p = tiltPose(LENS, t, { x, y, half: 500 }, angle);
        expect(p.target[0]).toBeCloseTo(x, 6);
        expect(p.target[1]).toBeCloseTo(y, 6);
        expect(p.target[2]).toBe(0);
      }),
    );
  });
});

describe('monotonic', () => {
  it('pitch rises, field of view narrows, distance and height grow, from first person to bird\'s-eye (property)', () => {
    fc.assert(
      fc.property(fc.constantFrom(...LENSES), unit, unit, fc.double({ min: 40, max: 3000, noNaN: true }), (l, a, b, half) => {
        const [t0, t1] = a <= b ? [a, b] : [b, a];
        const p = at(l, t0, half);
        const q = at(l, t1, half);
        expect(q.pitch).toBeGreaterThanOrEqual(p.pitch);
        expect(q.fov).toBeLessThanOrEqual(p.fov + 1e-12);
        expect(q.dist).toBeGreaterThanOrEqual(p.dist - 1e-9);
        expect(q.height).toBeGreaterThanOrEqual(p.height - 1e-9);
        if (t1 - t0 > 1e-6) {
          expect(q.pitch).toBeGreaterThan(p.pitch);
          expect(q.fov).toBeLessThan(p.fov);
          expect(q.height).toBeGreaterThan(p.height);
        }
      }),
      { numRuns: 500 },
    );
  });

  it('the perspective fades evenly: tan(half the field of view) is linear in the tilt', () => {
    for (let i = 0; i <= 20; i++) {
      const t = i / 20;
      expect(tiltTanHalf(LENS, t)).toBeCloseTo(Math.tan((22.5 * Math.PI) / 180) * (1 - t) + Math.tan((3 * Math.PI) / 180) * t, 12);
    }
  });
});

describe('continuous', () => {
  it('a small change of tilt moves the camera a little: no jump, no pop (Lipschitz bound, property)', () => {
    fc.assert(
      fc.property(fc.constantFrom(...LENSES), unit, fc.double({ min: 40, max: 2000, noNaN: true }), (l, t, half) => {
        const dt = 1e-4;
        const t2 = Math.min(1, t + dt);
        const p = at(l, t, half);
        const q = at(l, t2, half);
        const moved = Math.hypot(...p.pose.position.map((v, i) => v - q.pose.position[i]!));
        // The camera's whole travel from one end to the other bounds how far it moves per unit of tilt.
        const travel = at(l, 1, half).dist + at(l, 0, half).dist;
        expect(moved).toBeLessThanOrEqual(travel * 40 * (t2 - t) + 1e-9);
        expect(Math.abs(q.pitch - p.pitch)).toBeLessThanOrEqual(90 * (t2 - t) + 1e-12);
        expect(Math.abs(q.fov - p.fov)).toBeLessThanOrEqual(60 * (t2 - t) + 1e-9);
      }),
      { numRuns: 400 },
    );
  });

  it('sampled finely, consecutive poses differ by less than a hundredth of the whole move', () => {
    for (const l of LENSES) {
      const n = 1000;
      let worst = 0;
      const total = Math.abs(at(l, 1).z - at(l, 0).z);
      for (let i = 0; i < n; i++) {
        const p = at(l, i / n);
        const q = at(l, (i + 1) / n);
        worst = Math.max(worst, Math.hypot(...p.pose.position.map((v, k) => v - q.pose.position[k]!)));
      }
      expect(worst).toBeLessThan(total / 100);
    }
  });
});

describe('bounded', () => {
  it('pitch, field of view and distance stay between their ends; the camera is always above the table, never past straight down (property)', () => {
    fc.assert(
      fc.property(fc.constantFrom(...LENSES), fc.double({ min: -5, max: 5, noNaN: true }), fc.double({ min: 40, max: 3000, noNaN: true }), (l, t, half) => {
        const p = at(l, t, half);
        expect(p.pitch).toBeGreaterThanOrEqual(l.pitch0);
        expect(p.pitch).toBeLessThanOrEqual(l.pitch1);
        expect(p.pitch).toBeLessThanOrEqual(90);
        expect(p.fov).toBeGreaterThanOrEqual(l.fov1 - 1e-9);
        expect(p.fov).toBeLessThanOrEqual(l.fov0 + 1e-9);
        expect(p.dist).toBeGreaterThanOrEqual(at(l, 0, half).dist - 1e-9);
        expect(p.dist).toBeLessThanOrEqual(at(l, 1, half).dist + 1e-9);
        expect(p.z).toBeGreaterThan(0);
        expect(p.z).toBeCloseTo(p.height, 6);
        // Looking down at the table: the view direction points below the horizon.
        expect(p.pose.position[2]).toBeGreaterThan(p.pose.target[2]);
      }),
      { numRuns: 500 },
    );
  });

  it('a tilt outside [0, 1] or not a number is clamped (a non-number is bird\'s-eye)', () => {
    expect(unitTilt(-0.3)).toBe(0);
    expect(unitTilt(1.7)).toBe(1);
    expect(unitTilt(Number.NaN)).toBe(1);
    expect(unitTilt(Number.POSITIVE_INFINITY)).toBe(1);
    expect(tiltPitch(LENS, -2)).toBe(35);
    expect(tiltPitch(LENS, 3)).toBe(90);
  });

  it('the seat and height limits give a zoom that keeps the camera behind the seat line and above the minimum height (property)', () => {
    fc.assert(
      fc.property(fc.constantFrom(...LENSES), unit, fc.double({ min: 50, max: 3000, noNaN: true }), fc.double({ min: 50, max: 600, noNaN: true }), (l, t, room, minHeight) => {
        const hb = halfForBack(l, t, room);
        if (Number.isFinite(hb)) expect(tiltBack(l, t, hb)).toBeCloseTo(room, 6);
        const hh = halfForHeight(l, t, minHeight);
        expect(tiltHeight(l, t, hh)).toBeCloseTo(minHeight, 6);
      }),
      { numRuns: 300 },
    );
    // Straight down the camera stands over its look-at: no seat limit.
    expect(halfForBack(LENS, 1, 100)).toBe(Infinity);
  });
});

describe('eased spring motion', () => {
  const run = (from: number, to: number, v0 = 0, dt = 16) => {
    let x = from;
    let v = v0;
    const xs = [x];
    let ms = 0;
    while (!springSettled(x, v, to) && ms < 5000) {
      ({ x, v } = springStep(x, v, to, dt));
      xs.push(x);
      ms += dt;
    }
    return { xs, ms };
  };

  it('settles in about the spec\'s 400 ms blend time, never overshooting the target (critically damped)', () => {
    for (const [a, b] of [
      [1, 0],
      [0, 1],
      [0, 0.5],
      [0.75, 0.25],
    ] as const) {
      const { xs, ms } = run(a, b);
      expect(ms).toBeGreaterThan(250);
      expect(ms).toBeLessThan(900);
      for (let i = 1; i < xs.length; i++) {
        // Monotonic toward the target and never beyond it.
        expect(Math.sign(b - a) * (xs[i]! - xs[i - 1]!)).toBeGreaterThanOrEqual(-1e-12);
        expect(Math.sign(b - a) * (b - xs[i]!)).toBeGreaterThanOrEqual(-1e-9);
      }
      // Eased: it starts slowly (no jump in the first frame) and arrives gently.
      expect(Math.abs(xs[1]! - a)).toBeLessThan(0.05 * Math.abs(b - a));
      expect(Math.abs(xs.at(-1)! - xs.at(-2)!)).toBeLessThan(0.002);
    }
  });

  it('is exact whatever the frame length: two half steps are one whole step (a slow frame never throws it off)', () => {
    fc.assert(
      fc.property(unit, unit, fc.double({ min: -0.01, max: 0.01, noNaN: true }), fc.double({ min: 1, max: 200, noNaN: true }), (x, to, v, dt) => {
        const one = springStep(x, v, to, dt);
        const half = springStep(x, v, to, dt / 2);
        const two = springStep(half.x, half.v, to, dt / 2);
        expect(two.x).toBeCloseTo(one.x, 9);
        expect(two.v).toBeCloseTo(one.v, 9);
      }),
    );
  });

  it('a new target mid-move keeps the speed: the path has no kink in its value', () => {
    let s = { x: 1, v: 0 };
    for (let i = 0; i < 8; i++) s = springStep(s.x, s.v, 0, 16);
    const before = s.x;
    // Turn back: the very next step moves less than a frame's worth at full speed.
    const next = springStep(s.x, s.v, 1, 16);
    expect(Math.abs(next.x - before)).toBeLessThan(Math.abs(s.v) * 16 + 1e-9);
  });

  it('the blend\'s ease (look moves: fit, seat keys, zoom to a card) eases in and out', () => {
    expect(easeBlend(0)).toBe(0);
    expect(easeBlend(1)).toBe(1);
    expect(easeBlend(0.5)).toBeCloseTo(0.5, 12);
    expect(easeBlend(0.1)).toBeLessThan(0.1);
    expect(easeBlend(0.9)).toBeGreaterThan(0.9);
  });
});

describe('presets snap softly', () => {
  it('a tilt released near a preset goes to it; elsewhere it stays', () => {
    const presets = TILT_PRESETS.map((p) => p.tilt);
    expect(presets).toEqual([0, 0.5, 1]);
    expect(snapTilt(0.04, presets, TILT_SNAP_RADIUS)).toBe(0);
    expect(snapTilt(0.93, presets, TILT_SNAP_RADIUS)).toBe(1);
    expect(snapTilt(0.45, presets, TILT_SNAP_RADIUS)).toBe(0.5);
    expect(snapTilt(0.25, presets, TILT_SNAP_RADIUS)).toBe(0.25);
    expect(snapTilt(0.75, presets, TILT_SNAP_RADIUS)).toBe(0.75);
    expect(snapTilt(-1, presets, TILT_SNAP_RADIUS)).toBe(0);
  });
});
