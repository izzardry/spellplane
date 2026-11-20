/**
 * PLAN M7-P2: life totals you click or scrub (PLAN Milestone 7, Owner decisions: "life totals you click or scrub";
 * scene/types.ts LIFE_SCRUB: one point per 12 px, a press within 6 px and 250 ms is a click).
 */
import { describe, expect, it } from 'vitest';
import { LIFE_SCRUB } from '../../../src/scene/types';
import { LifeScrub, scrubSteps } from '../../../src/ui/hud/scrub';

describe('life scrub', () => {
  it('counts one point per step of drag, up or right gaining, down or left losing', () => {
    const px = LIFE_SCRUB.pxPerPoint;
    expect(scrubSteps(0, -px * 3)).toBe(3);
    expect(scrubSteps(0, px * 2)).toBe(-2);
    expect(scrubSteps(px * 4, 0)).toBe(4);
    expect(scrubSteps(-px * 4 - 3, 2)).toBe(-4);
    expect(scrubSteps(0, -(px - 1))).toBe(0);
  });

  it('a short press without movement is a click (type a value)', () => {
    const s = new LifeScrub();
    s.down(100, 100, 0);
    expect(s.move(102, 101)).toBe(0);
    expect(s.up(102, 101, 120)).toEqual({ kind: 'click' });
  });

  it('a long still press is neither a click nor a change', () => {
    const s = new LifeScrub();
    s.down(100, 100, 0);
    expect(s.up(100, 100, 900)).toEqual({ kind: 'none' });
  });

  it('a drag scrubs: the steps follow the pointer and one change is reported on release', () => {
    const s = new LifeScrub();
    s.down(100, 100, 0);
    expect(s.move(100, 90)).toBe(0);
    expect(s.scrubbing).toBe(true);
    expect(s.move(100, 40)).toBe(5);
    expect(s.move(100, 76)).toBe(2);
    expect(s.up(100, 64, 400)).toEqual({ kind: 'scrub', steps: 3 });
  });

  it('a drag that comes back to where it started changes nothing and is not a click', () => {
    const s = new LifeScrub();
    s.down(100, 100, 0);
    s.move(100, 60);
    expect(s.up(101, 99, 100)).toEqual({ kind: 'none' });
  });

  it('cancel drops the scrub', () => {
    const s = new LifeScrub();
    s.down(0, 0, 0);
    s.move(0, -100);
    s.cancel();
    expect(s.active).toBe(false);
    expect(s.up(0, -100, 10)).toEqual({ kind: 'none' });
  });
});
