import { describe, expect, it } from 'vitest';
import { AdaptiveResolution, MIN_PIXEL_RATIO, RUN, UP_AFTER_MS } from '../../src/scene/resolution';
import { parseRenderSwitches } from '../../src/scene/switches';
import { ambientDue } from '../../src/scene/pacing';
import { shapeBounds, shapesKey, type PresenceShape } from '../../src/scene/presence';

/** Feed `n` frames of `cost` ms, one every `cost` ms from `t`; returns the time after them. */
function feed(r: AdaptiveResolution, t: number, n: number, cost: number): number {
  for (let i = 0; i < n; i++) {
    t += cost;
    r.observe(t, cost);
  }
  return t;
}

describe('adaptive resolution (M7-A0)', () => {
  it('stays at the full ratio while frames keep up', () => {
    const r = new AdaptiveResolution();
    r.setBase(2);
    feed(r, 0, 200, 16.7);
    expect(r.motionScale()).toBe(1);
  });

  it('steps down while frames are slow, never below one device pixel per CSS pixel', () => {
    const r = new AdaptiveResolution();
    r.setBase(2);
    const t = feed(r, 0, RUN, 40);
    expect(r.motionScale()).toBeLessThan(1);
    feed(r, t, RUN * 20, 40);
    expect(r.motionScale() * 2).toBe(MIN_PIXEL_RATIO);
    // Pixel ratios stay multiples of 1/8.
    const r2 = new AdaptiveResolution();
    r2.setBase(2);
    feed(r2, 0, RUN, 30);
    expect((r2.motionScale() * 2 * 8) % 1).toBe(0);
  });

  it('never scales a display of one device pixel per CSS pixel', () => {
    const r = new AdaptiveResolution();
    r.setBase(1);
    feed(r, 0, RUN * 10, 60);
    expect(r.motionScale()).toBe(1);
  });

  it('steps back up after a long run at the display rate', () => {
    const r = new AdaptiveResolution();
    r.setBase(2);
    const t = feed(r, 0, RUN, 40);
    const low = r.motionScale();
    feed(r, t, Math.ceil(UP_AFTER_MS / 16.7) + RUN, 16.7);
    expect(r.motionScale()).toBeGreaterThan(low);
  });

  it('waits longer after a step up that did not hold', () => {
    const r = new AdaptiveResolution();
    r.setBase(2);
    let t = feed(r, 0, RUN, 40);
    t = feed(r, t, Math.ceil(UP_AFTER_MS / 16.7) + RUN, 16.7);
    const up = r.motionScale();
    t = feed(r, t, RUN, 40); // the step up was too much
    expect(r.motionScale()).toBeLessThan(up);
    const down = r.motionScale();
    // The same run at the display rate as before is no longer enough for another try.
    feed(r, t, Math.ceil(UP_AFTER_MS / 16.7) + RUN, 16.7);
    expect(r.motionScale()).toBe(down);
  });

  it('keeps the motion pixel ratio across a new base and is off when disabled', () => {
    const r = new AdaptiveResolution();
    r.setBase(2);
    feed(r, 0, RUN * 20, 40);
    r.setBase(1.5);
    expect(r.motionScale() * 1.5).toBeCloseTo(1, 5);
    const off = new AdaptiveResolution(false);
    off.setBase(2);
    feed(off, 0, RUN * 20, 40);
    expect(off.motionScale()).toBe(1);
  });
});

describe('render switches (M7-A0)', () => {
  it('turns remedies off by name and reads a pixel ratio cap', () => {
    expect(parseRenderSwitches([])).toEqual({ adapt: true, still: true, shadowSkip: true, sync: false, antialias: null, pixelRatioCap: null });
    expect(parseRenderSwitches(['noadapt', 'nostill', 'shadowall', 'sync', 'noaa', 'pr=1.5'])).toEqual({ adapt: false, still: false, shadowSkip: false, sync: true, antialias: false, pixelRatioCap: 1.5 });
    expect(parseRenderSwitches(['aa', 'pr=9']).antialias).toBe(true);
    expect(parseRenderSwitches(['pr=9']).pixelRatioCap).toBeNull();
  });
});

describe('ambient pacing', () => {
  it('draws ambient frames at once on a fast renderer and waits on a slow one', () => {
    expect(ambientDue(16, 0)).toBe(true);
    expect(ambientDue(200, 100)).toBe(false);
  });
});

describe('presence layer repaint (M7-A0)', () => {
  const shape = (x: number, y: number, label = 'Ben'): PresenceShape => ({ peer: 'p1', seat: 's1', colour: '#c00', label, cursor: { x, y }, ghosts: [{ id: 'c1', corners: [{ x: x - 30, y: y - 40 }, { x: x + 30, y: y - 40 }, { x: x + 30, y: y + 40 }, { x: x - 30, y: y + 40 }] }] });
  const rect = { left: 0, top: 0, width: 1440, height: 900 };

  it('keys equal shapes equally and moved ones differently', () => {
    expect(shapesKey([shape(100, 100)], rect)).toBe(shapesKey([shape(100.05, 100)], rect));
    expect(shapesKey([shape(100, 100)], rect)).not.toBe(shapesKey([shape(101, 100)], rect));
    expect(shapesKey([shape(100, 100)], rect)).not.toBe(shapesKey([shape(100, 100, 'Cleo')], rect));
    expect(shapesKey([], rect)).not.toBe(shapesKey([], { ...rect, width: 1000 }));
  });

  it('bounds hold the ghost, the arrow and the label', () => {
    const b = shapeBounds(shape(100, 100));
    expect(b.x).toBeLessThanOrEqual(66);
    expect(b.y).toBeLessThanOrEqual(56);
    expect(b.x + b.w).toBeGreaterThanOrEqual(100 + 14 + 220);
    expect(b.y + b.h).toBeGreaterThanOrEqual(144);
    expect(shapeBounds({ peer: 'p', seat: null, colour: '#000', label: '', cursor: null, ghosts: [] }).w).toBe(0);
  });
});
