// PLAN Milestone 7, M7-P4 Card feel: the maths of the almost haptic handling (Owner decisions after the first design
// round: "they lift on pickup, sway with movement, are pulled into snap slots as they near them, settle with a small
// bounce, and every common move has a short animation … Reduced motion is respected"; DESIGN "Specification: geometry,
// layout and motion", Motion: the critically damped spring 320/36/1, lift 12). Pure functions with time passed in.
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  ANIMATION_MS,
  CardMotion,
  LiftMotion,
  SwayMotion,
  TAP_OVERSHOOT,
  arcCurve,
  easeOutBack,
  feelWithin,
  liftScale,
  liftShadow,
  magnetOn,
  magnetPose,
  magnetPull,
  popCurve,
  riffleOffset,
  settleCurve,
  springStep,
  swayTarget,
  waveDelays,
} from '../../../src/scene/motion';
import { DEFAULT_CARD_FEEL, cardFeel, resolveMotion } from '../../../src/scene/types';
import { paper } from '../../../src/themes/paper/index';

const FEEL = DEFAULT_CARD_FEEL;
const M = paper.motion;

describe('the follow spring', () => {
  it('is critically damped (DESIGN 320/36/1): a held card catches up with the pointer without overshooting it', () => {
    let a = { x: 0, v: 0 };
    let max = 0;
    for (let i = 0; i < 120; i++) {
      a = springStep(a, 100, 1 / 60, FEEL.follow.stiffness, FEEL.follow.damping, FEEL.follow.mass);
      max = Math.max(max, a.x);
    }
    expect(max).toBeLessThanOrEqual(100 + 1e-6);
    expect(a.x).toBeCloseTo(100, 3);
  });
});

describe('the magnet', () => {
  const R = FEEL.magnet.radiusMm;
  const K = FEEL.magnet.strength;

  it('pulls nothing at and beyond its radius, the full strength on the slot, more the nearer the card is', () => {
    expect(magnetPull(R, R, K)).toBe(0);
    expect(magnetPull(R + 5, R, K)).toBe(0);
    expect(magnetPull(0, R, K)).toBeCloseTo(K, 9);
    expect(magnetPull(R / 2, R, K)).toBeGreaterThan(0);
    expect(magnetPull(R / 4, R, K)).toBeGreaterThan(magnetPull(R / 2, R, K));
    // Off: no radius or no strength.
    expect(magnetPull(1, 0, K)).toBe(0);
    expect(magnetPull(1, R, 0)).toBe(0);
    expect(magnetPull(Number.NaN, R, K)).toBe(0);
  });

  it('never moves the card against the pointer and never jumps: the drawn distance grows with the free distance, from 0 to the radius', () => {
    fc.assert(
      fc.property(fc.double({ min: 0, max: 60, noNaN: true }), fc.double({ min: 0, max: 60, noNaN: true }), fc.double({ min: 0.05, max: 1, noNaN: true }), (d1, d2, k) => {
        const lo = Math.min(d1, d2);
        const hi = Math.max(d1, d2);
        const drawn = (d: number) => d * (1 - magnetPull(d, R, k));
        expect(drawn(hi)).toBeGreaterThanOrEqual(drawn(lo) - 1e-9);
      }),
    );
    // Continuous at the edge of the radius.
    expect(Math.abs((R - 1e-6) * (1 - magnetPull(R - 1e-6, R, K)) - R)).toBeLessThan(1e-4);
  });

  it('pulls the pose toward the slot along the line between them, turning the shorter way', () => {
    const free = { x: 10, y: 0, rot: 350 };
    const slot = { x: 0, y: 0, rot: 10 };
    expect(magnetPose(free, slot, 0)).toEqual(free);
    expect(magnetPose(free, slot, 1)).toEqual({ x: 0, y: 0, rot: 10 });
    const half = magnetPose(free, slot, 0.5);
    expect(half.x).toBeCloseTo(5, 9);
    expect(half.rot).toBeCloseTo(0, 9);
    // A pull out of range is clamped.
    expect(magnetPose(free, slot, 3)).toEqual({ x: 0, y: 0, rot: 10 });
  });

  it('is on only within reach of a slot, and then lands the drawn pose between the free spot and the slot', () => {
    const slot = { x: 0, y: 0, rot: 0 };
    expect(magnetOn({ x: 100, y: 0, rot: 0 }, slot, FEEL.magnet)).toBeNull();
    expect(magnetOn({ x: 5, y: 0, rot: 0 }, null, FEEL.magnet)).toBeNull();
    const m = magnetOn({ x: 8, y: 0, rot: 0 }, slot, FEEL.magnet)!;
    expect(m.pull).toBeGreaterThan(0);
    expect(m.pose.x).toBeGreaterThan(0);
    expect(m.pose.x).toBeLessThan(8);
  });
});

describe('the sway', () => {
  const sway = FEEL.sway;

  it('leans a card hanging from the pointer away from its motion: right is clockwise, left counter-clockwise, at rest none', () => {
    // Grabbed at its centre by seat 0's viewer: the card hangs toward the viewer.
    expect(swayTarget(300, 0, 0, 0, 0, sway)).toBeGreaterThan(0);
    expect(swayTarget(-300, 0, 0, 0, 0, sway)).toBeLessThan(0);
    expect(swayTarget(0, 0, 0, 0, 0, sway)).toBe(0);
    // The viewer across the table sees the same lean (a 180° view turns the frame, not the handedness).
    expect(swayTarget(-300, 0, 0, 0, 180, sway)).toBeGreaterThan(0);
  });

  it('grows with speed up to the limit and is none when the feel has no sway (reduced motion)', () => {
    const slow = Math.abs(swayTarget(100, 0, 0, 0, 0, sway));
    const fast = Math.abs(swayTarget(400, 0, 0, 0, 0, sway));
    expect(fast).toBeGreaterThan(slow);
    expect(Math.abs(swayTarget(1e6, 3e5, 10, -20, 0, sway))).toBeCloseTo(sway.maxDeg, 9);
    const reduced = cardFeel(paper, resolveMotion('reduced', false));
    expect(swayTarget(400, 0, 0, 0, 0, reduced.sway)).toBe(0);
    expect(cardFeel(paper, resolveMotion('subtle', false)).sway.maxDeg).toBeCloseTo(sway.maxDeg / 2, 9);
  });

  it('relaxes back to flat when the card stops or is let go, and a cut drops it at once', () => {
    const s = new SwayMotion();
    s.set(6);
    for (let i = 0; i < 120; i++) s.step(16, sway.relaxMs);
    expect(s.value).toBe(6);
    s.set(0);
    let prev = s.value;
    for (let i = 0; i < 200 && s.moving; i++) {
      s.step(16, sway.relaxMs);
      expect(s.value).toBeLessThanOrEqual(prev);
      prev = s.value;
    }
    expect(s.value).toBe(0);
    expect(s.moving).toBe(false);
    s.set(5);
    s.step(16, sway.relaxMs);
    s.cut();
    expect(s.value).toBe(0);
    expect(s.moving).toBe(false);
  });
});

describe('the lift', () => {
  it('rises to the held height on pickup and ends exactly there', () => {
    const l = new LiftMotion();
    l.rise(0, 12, FEEL.liftMs, false);
    l.step(FEEL.liftMs / 2);
    expect(l.value).toBeGreaterThan(0);
    expect(l.value).toBeLessThan(12);
    l.step(FEEL.liftMs + 1);
    expect(l.value).toBe(12);
    expect(l.moving).toBe(false);
  });

  it('settles with one small bounce: down to the table, a hop of the bounce fraction, never below, exactly 0 at the end', () => {
    const l = new LiftMotion();
    l.cut(12);
    l.settle(0, FEEL.settle.ms, FEEL.settle.bounce, false);
    const samples: number[] = [];
    for (let t = 0; t <= FEEL.settle.ms + 16; t += 4) {
      l.step(t);
      samples.push(l.value);
    }
    expect(Math.min(...samples)).toBeGreaterThanOrEqual(0);
    const touch = samples.findIndex((v) => v < 0.01);
    expect(touch).toBeGreaterThan(0);
    const hop = Math.max(...samples.slice(touch));
    expect(hop).toBeGreaterThan(0.5 * FEEL.settle.bounce * 12);
    expect(hop).toBeLessThanOrEqual(FEEL.settle.bounce * 12 + 1e-9);
    expect(samples.at(-1)).toBe(0);
    expect(l.moving).toBe(false);
  });

  it('is interruptible: a new pickup mid-settle starts from the height drawn, without a jump', () => {
    const l = new LiftMotion();
    l.cut(12);
    l.settle(0, 260, 0.15, false);
    l.step(60);
    const mid = l.value;
    l.rise(60, 12, 120, false);
    l.step(61);
    expect(Math.abs(l.value - mid)).toBeLessThan(1);
  });

  it('hops along a toss and lands where it is going; reduced motion cuts every curve', () => {
    const l = new LiftMotion();
    l.arc(0, 10, 200, false);
    l.step(100);
    expect(l.value).toBeCloseTo(10, 6);
    l.step(200);
    expect(l.value).toBe(0);
    const r = new LiftMotion();
    r.rise(0, 12, 120, true);
    expect(r.value).toBe(12);
    expect(r.moving).toBe(false);
    r.settle(0, 260, 0.15, true);
    expect(r.value).toBe(0);
    r.land(0, 12, 260, 0.15, true);
    expect(r.value).toBe(0);
    r.arc(0, 10, 200, true);
    expect(r.value).toBe(0);
    expect(r.moving).toBe(false);
  });

  it('a soft landing comes down from above with the same small bounce', () => {
    const l = new LiftMotion();
    l.land(0, 12, 260, 0.15, false);
    expect(l.at(0)).toBeCloseTo(12, 6);
    l.step(260);
    expect(l.value).toBe(0);
  });

  it('a lifted card is drawn uniformly larger with a shadow that slides out, spreads, softens and fades as it rises', () => {
    expect(liftScale(0, 12)).toBe(1);
    expect(liftScale(12, 12)).toBeGreaterThan(1);
    expect(liftScale(12, 12)).toBeLessThan(1.1);
    expect(liftScale(6, 12)).toBeLessThan(liftScale(12, 12));
    expect(liftShadow(0, 12)).toBeNull();
    const low = liftShadow(3, 12)!;
    const high = liftShadow(12, 12)!;
    expect(Math.hypot(high.dx, high.dy)).toBeGreaterThan(Math.hypot(low.dx, low.dy));
    expect(high.blur).toBeGreaterThan(low.blur);
    expect(high.grow).toBeGreaterThan(low.grow);
    expect(high.opacity).toBeLessThanOrEqual(0.32);
  });
});

describe('the curves', () => {
  it('settle, arc and pop start and end at rest', () => {
    expect(settleCurve(0, 0.15)).toBe(1);
    expect(settleCurve(1, 0.15)).toBe(0);
    expect(settleCurve(0.8, 0)).toBe(0);
    expect(arcCurve(0)).toBe(0);
    expect(arcCurve(0.5)).toBeCloseTo(1, 9);
    expect(arcCurve(1)).toBeCloseTo(0, 9);
    expect(popCurve(0)).toBe(0);
    expect(popCurve(0.3)).toBeCloseTo(1, 9);
    expect(popCurve(1)).toBe(0);
  });

  it('a tap turns with a small overshoot: past the quarter turn by a few degrees, then exactly onto it', () => {
    const motion = new CardMotion({ x: 0, y: 0, rot: 0 });
    motion.tweenTo({ x: 0, y: 0, rot: 90 }, 0, 180, (t) => easeOutBack(t, TAP_OVERSHOOT), false);
    let max = 0;
    for (let t = 0; t <= 200; t += 4) {
      motion.step(t, 4, M);
      max = Math.max(max, motion.r.x);
    }
    expect(max).toBeGreaterThan(91);
    expect(max).toBeLessThan(96);
    expect(motion.pose.rot).toBe(90);
    expect(motion.moving).toBe(false);
    // An untap turns back the shorter way (90 → 0, never through 270).
    motion.tweenTo({ x: 0, y: 0, rot: 0 }, 300, 180, (t) => easeOutBack(t, TAP_OVERSHOOT), false);
    let min = 90;
    for (let t = 300; t <= 500; t += 4) {
      motion.step(t, 4, M);
      min = Math.min(min, motion.r.x);
    }
    expect(min).toBeLessThan(0);
    expect(min).toBeGreaterThan(-6);
    expect(motion.pose.rot).toBe(0);
  });

  it('a timed move waits its delay, is a cut under reduced motion, and starts from where the card is drawn', () => {
    const m = new CardMotion({ x: 0, y: 0, rot: 0 });
    m.tweenTo({ x: 100, y: 0, rot: 0 }, 0, 200, (t) => t, false, 50);
    m.step(40, 16, M);
    expect(m.pose.x).toBe(0);
    m.step(150, 16, M);
    expect(m.pose.x).toBeCloseTo(50, 6);
    // Interrupted half-way: the next move starts at 50.
    m.tweenTo({ x: 0, y: 0, rot: 0 }, 150, 100, (t) => t, false);
    m.step(150, 0, M);
    expect(m.pose.x).toBeCloseTo(50, 6);
    m.tweenTo({ x: 20, y: 5, rot: 90 }, 160, 200, (t) => t, true);
    expect(m.pose).toEqual({ x: 20, y: 5, rot: 90 });
    expect(m.moving).toBe(false);
  });
});

describe('the riffle and the wave', () => {
  it('a riffle parts the pile into two halves on opposite sides and closes it again', () => {
    const n = 10;
    expect(riffleOffset(0, n, 0)).toEqual({ dx: 0, dz: 0 });
    expect(riffleOffset(9, n, 1)).toEqual({ dx: 0, dz: 0 });
    const mid = Array.from({ length: n }, (_, i) => riffleOffset(i, n, 0.5));
    expect(mid.slice(0, 5).every((o) => o.dx < 0)).toBe(true);
    expect(mid.slice(5).every((o) => o.dx > 0)).toBe(true);
    expect(Math.max(...mid.map((o) => Math.abs(o.dx)))).toBeLessThanOrEqual(0.55 + 1e-9);
    // A single card does not riffle.
    expect(riffleOffset(0, 1, 0.5)).toEqual({ dx: 0, dz: 0 });
  });

  it('untap all runs as a wave from the viewer’s left, each card a little later, the whole wave short', () => {
    const d = waveDelays([200, -100, 50]);
    expect(d[1]).toBe(0);
    expect(d[2]).toBeGreaterThan(d[1]!);
    expect(d[0]).toBeGreaterThan(d[2]!);
    const many = waveDelays(Array.from({ length: 40 }, (_, i) => i));
    expect(Math.max(...many)).toBeLessThanOrEqual(240 + 1e-9);
    expect(waveDelays([5])).toEqual([0]);
  });
});

describe('durations and the motion setting', () => {
  it('every card animation is short at full motion (120–350 ms), half under subtle, none under reduced motion', () => {
    const full = feelWithin(cardFeel(paper, resolveMotion('full', false)), 1);
    for (const v of Object.values(full.durations)) {
      expect(v).toBeGreaterThanOrEqual(ANIMATION_MS.min);
      expect(v).toBeLessThanOrEqual(ANIMATION_MS.max);
    }
    const subtle = feelWithin(cardFeel(paper, resolveMotion('subtle', false)), 0.5);
    for (const [k, v] of Object.entries(subtle.durations)) expect(v).toBeLessThanOrEqual((full.durations as Record<string, number>)[k]!);
    const reduced = feelWithin(cardFeel(paper, resolveMotion('system', true)), 0);
    expect(Object.values(reduced.durations).every((v) => v === 0)).toBe(true);
    expect(reduced.settle.bounce).toBe(0);
    expect(reduced.sway.maxDeg).toBe(0);
    // The lift height is never scaled (a held card still rises, as a cut).
    expect(reduced.liftMm).toBe(FEEL.liftMm);
  });
});
