// m7-adjustments.md, M7-P4 change 3 (now M7-P5): "A group of moves staggers: the opening seven draw 40 ms apart, the
// whole group done within 600 ms". And change 4: a disposed scene runs nothing (util/feel.ts totals).
import { describe, expect, it, vi } from 'vitest';
import { CardMotion, GROUP_MAX_MS, GROUP_STEP_MS, groupDelay, easeInOutCubic } from '../../../src/scene/motion';
import { DEFAULT_CARD_FEEL } from '../../../src/scene/types';
import { DEFAULT_MOTION } from '../../../src/core/geometry';
import { forgetMotion, motionTotals, reportMotion } from '../../../src/util/feel';

describe('group stagger', () => {
  it('the first card starts at once, the next ones 40 ms apart', () => {
    expect(GROUP_STEP_MS).toBe(40);
    const d = DEFAULT_CARD_FEEL.durations.draw;
    expect([0, 1, 2, 3].map((i) => groupDelay(i, d))).toEqual([0, 40, 80, 120]);
  });

  it('an opening hand of seven is done within 600 ms, for every duration a look may use', () => {
    for (const dur of [120, 200, DEFAULT_CARD_FEEL.durations.draw, 350, 480]) {
      const ends = Array.from({ length: 7 }, (_, i) => groupDelay(i, dur) + dur);
      expect(Math.max(...ends)).toBeLessThanOrEqual(GROUP_MAX_MS);
      // Still in order: no card starts before the one before it.
      for (let i = 1; i < 7; i++) expect(groupDelay(i, dur)).toBeGreaterThanOrEqual(groupDelay(i - 1, dur));
    }
  });

  it('a large group never ends after 600 ms; reduced motion (no duration) has no delay', () => {
    for (let i = 0; i < 60; i++) expect(groupDelay(i, 320) + 320).toBeLessThanOrEqual(GROUP_MAX_MS);
    expect(groupDelay(5, 0)).toBe(0);
  });

  it('with fake timers, seven staggered card tweens have all arrived 600 ms after the state came', () => {
    vi.useFakeTimers();
    try {
      const t0 = 1000;
      const dur = DEFAULT_CARD_FEEL.durations.draw;
      const cards = Array.from({ length: 7 }, () => new CardMotion({ x: 0, y: 0, rot: 0 }));
      cards.forEach((m, i) => m.tweenTo({ x: 100, y: 50, rot: 0 }, t0, dur, easeInOutCubic, false, groupDelay(i, dur)));
      const motion = DEFAULT_MOTION;
      // Mid-way the last card has not left yet while the first is on its way.
      cards.forEach((m) => m.step(t0 + 100, 16, motion));
      expect(cards[0]!.pose.x).toBeGreaterThan(0);
      expect(cards[6]!.pose.x).toBe(0);
      vi.advanceTimersByTime(600);
      cards.forEach((m) => m.step(t0 + GROUP_MAX_MS, 16, motion));
      for (const m of cards) {
        expect(m.pose).toEqual({ x: 100, y: 50, rot: 0 });
        expect(m.moving).toBe(false);
      }
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('page-wide motion totals', () => {
  it('sum what live scenes report and forget a disposed scene', () => {
    const a = {};
    const b = {};
    reportMotion(a, 2, 1);
    reportMotion(b, 1, 0);
    expect(motionTotals()).toEqual({ scenes: 2, animations: 3, holds: 1 });
    forgetMotion(a);
    forgetMotion(b);
    expect(motionTotals()).toEqual({ scenes: 0, animations: 0, holds: 0 });
  });
});
