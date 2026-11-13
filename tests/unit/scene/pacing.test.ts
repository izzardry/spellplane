// scene/pacing.ts: ambient motion draws every animation frame while frames are cheap, and backs off on a renderer too
// slow for it (software GL), so the page keeps time for input and messages between frames.
import { describe, expect, it } from 'vitest';
import { AMBIENT_BACKOFF, AMBIENT_SLOW_FRAME_MS, UPLOAD_SCALE_MAX, ambientDue, uploadScale } from '../../../src/scene/pacing';

describe('ambientDue', () => {
  it('draws every animation frame while a frame costs no more than the slow mark', () => {
    expect(ambientDue(0, 0)).toBe(true);
    expect(ambientDue(16.7, 16.7)).toBe(true);
    expect(ambientDue(AMBIENT_SLOW_FRAME_MS, 1)).toBe(true);
    expect(ambientDue(Number.NaN, 0)).toBe(true);
  });

  it('on a slow renderer waits AMBIENT_BACKOFF frame costs after the last drawn frame', () => {
    expect(AMBIENT_BACKOFF).toBeGreaterThanOrEqual(2);
    const cost = 1400;
    expect(ambientDue(cost, cost)).toBe(false);
    expect(ambientDue(cost, AMBIENT_BACKOFF * cost - 1)).toBe(false);
    expect(ambientDue(cost, AMBIENT_BACKOFF * cost)).toBe(true);
    expect(ambientDue(cost, Infinity)).toBe(true);
  });
});

describe('uploadScale', () => {
  it('keeps one upload budget a frame at 60 fps or faster and grows with a slower frame, up to the cap', () => {
    expect(uploadScale(0)).toBe(1);
    expect(uploadScale(8)).toBe(1);
    expect(uploadScale(1000 / 60)).toBe(1);
    expect(uploadScale(50)).toBeCloseTo(3, 9);
    expect(uploadScale(1400)).toBe(UPLOAD_SCALE_MAX);
    expect(uploadScale(Number.NaN)).toBe(1);
  });
});
