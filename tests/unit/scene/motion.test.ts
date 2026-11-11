// Card motion, DESIGN "Specification: geometry, layout and motion" (Motion).
import { describe, expect, it } from 'vitest';
import { DEFAULT_MOTION } from '../../../src/core/geometry';
import { CardMotion, springStep } from '../../../src/scene/motion';
import { paper } from '../../../src/themes/paper';

const M = DEFAULT_MOTION;

function run(m: CardMotion, from: number, to: number, dt = 16): number {
  let t = from;
  while (t < to) {
    t = Math.min(to, t + dt);
    m.step(t, dt, M);
  }
  return t;
}

describe('motion constants', () => {
  it('Paper uses the design\'s motion: spring 320/36/1, tap 120, flip 220, remote 180, inertia 325', () => {
    expect(paper.motion.spring).toEqual({ stiffness: 320, damping: 36, mass: 1 });
    expect(paper.motion).toMatchObject({ tapMs: 120, flipMs: 220, remoteMoveMs: 180, panInertiaMs: 325 });
  });
  it('the spring is (near) critically damped: c ~ 2 sqrt(k m)', () => {
    const { stiffness: k, damping: c, mass: m } = M.spring;
    expect(c / (2 * Math.sqrt(k * m))).toBeGreaterThan(0.99);
    expect(c / (2 * Math.sqrt(k * m))).toBeLessThan(1.02);
  });
});

describe('spring', () => {
  it('settles on the target without overshoot', () => {
    let a = { x: 0, v: 0 };
    let max = 0;
    for (let i = 0; i < 120; i++) {
      a = springStep(a, 100, 1 / 60, 320, 36, 1);
      max = Math.max(max, a.x);
    }
    expect(a.x).toBeCloseTo(100, 3);
    expect(max).toBeLessThanOrEqual(100 + 1e-6);
  });
  it('a dropped card 80 mm away is within 0.5 mm of its target after 500 ms and then rests exactly there', () => {
    const m = new CardMotion({ x: 0, y: 0, rot: 0 });
    m.moveTo({ x: 80, y: -40, rot: 0 }, 'spring', 0, M, false);
    run(m, 0, 500);
    expect(Math.abs(m.pose.x - 80)).toBeLessThan(0.5);
    run(m, 500, 2000);
    expect(m.pose).toEqual({ x: 80, y: -40, rot: 0 });
    expect(m.moving).toBe(false);
  });
});

describe('tap', () => {
  it('turns 90 degrees clockwise in 120 ms', () => {
    const m = new CardMotion({ x: 0, y: 0, rot: 0 });
    m.moveTo({ x: 0, y: 0, rot: 90 }, 'tap', 1000, M, false);
    m.step(1060, 60, M);
    expect(m.pose.rot).toBeGreaterThan(0);
    expect(m.pose.rot).toBeLessThan(90);
    m.step(1120, 60, M);
    expect(m.pose.rot).toBe(90);
    expect(m.moving).toBe(false);
  });
  it('untapping turns back the short way (never through 180)', () => {
    const m = new CardMotion({ x: 0, y: 0, rot: 90 });
    m.moveTo({ x: 0, y: 0, rot: 0 }, 'tap', 0, M, false);
    m.step(60, 60, M);
    expect(m.pose.rot).toBeGreaterThan(0);
    expect(m.pose.rot).toBeLessThan(90);
    m.step(120, 60, M);
    expect(m.pose.rot).toBe(0);
  });
  it('a tapped card of the far seat rests at 270', () => {
    const m = new CardMotion({ x: 0, y: 0, rot: 180 });
    m.moveTo({ x: 0, y: 0, rot: 270 }, 'tap', 0, M, false);
    m.step(120, 120, M);
    expect(m.pose.rot).toBe(270);
  });
});

describe('flip', () => {
  it('takes 220 ms and swaps the texture half-way, when the card is edge-on', () => {
    const m = new CardMotion({ x: 0, y: 0, rot: 0 });
    m.startFlip(0, M, false);
    expect(m.flipSwapped).toBe(false);
    expect(m.flipScale(0)).toBeCloseTo(1, 9);
    m.step(100, 100, M);
    expect(m.flipSwapped).toBe(false);
    expect(m.flipScale(110)).toBeCloseTo(0, 9);
    m.step(110, 10, M);
    expect(m.flipSwapped).toBe(true);
    m.step(220, 110, M);
    expect(m.moving).toBe(false);
    expect(m.flipScale(220)).toBe(1);
  });
});

describe('remote moves', () => {
  it('ease out over 180 ms', () => {
    const m = new CardMotion({ x: 0, y: 0, rot: 0 });
    m.moveTo({ x: 100, y: 0, rot: 0 }, 'remote', 0, M, false);
    m.step(90, 90, M);
    expect(m.pose.x).toBeGreaterThan(50); // ease-out: past half-way at half time
    expect(m.pose.x).toBeLessThan(100);
    m.step(180, 90, M);
    expect(m.pose.x).toBe(100);
    expect(m.moving).toBe(false);
  });
});

describe('reduced motion', () => {
  it('turns every animation into a cut', () => {
    const m = new CardMotion({ x: 0, y: 0, rot: 0 });
    for (const kind of ['spring', 'remote', 'tap'] as const) {
      m.moveTo({ x: 50, y: 20, rot: 90 }, kind, 0, M, true);
      expect(m.pose).toEqual({ x: 50, y: 20, rot: 90 });
      expect(m.moving).toBe(false);
      m.moveTo({ x: 0, y: 0, rot: 0 }, 'cut', 0, M, true);
    }
    m.startFlip(0, M, true);
    expect(m.flipSwapped).toBe(true);
    expect(m.moving).toBe(false);
  });
});
