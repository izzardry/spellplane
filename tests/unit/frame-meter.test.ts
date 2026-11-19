import { describe, expect, it } from 'vitest';
import { FrameMeter, frameTimes, quantile, HIDDEN_GAP_MS } from '../../src/util/frame-meter';
import { meterLines } from '../../src/ui/perf/meter';

describe('frame meter statistics (M7-A0)', () => {
  it('takes nearest-rank quantiles', () => {
    expect(quantile([], 0.5)).toBe(0);
    expect(quantile([1, 2, 3, 4], 0.5)).toBe(2);
    expect(quantile([1, 2, 3, 4], 0.95)).toBe(4);
    expect(quantile([5], 0.95)).toBe(5);
  });

  it('times a drawn frame from its callback to the next one', () => {
    // Callbacks every 16 ms except one 50 ms gap after a drawn frame; every callback drew.
    const t = [0, 16, 32, 82, 98];
    const s = frameTimes(t, [true, true, true, true, true], 98);
    expect(s.frames).toBe(4);
    expect(s.fps).toBeCloseTo(4 / 0.098, 5);
    expect(s.p50).toBe(16);
    expect(s.p95).toBe(50);
    expect(s.max).toBe(50);
  });

  it('counts a stall between callbacks that drew nothing in max, not in the frame times', () => {
    const t = [0, 16, 32, 132, 148];
    const s = frameTimes(t, [true, false, false, false, true], 148);
    expect(s.frames).toBe(1);
    expect(s.p50).toBe(16);
    expect(s.max).toBe(100);
  });

  it('leaves out gaps of a hidden tab', () => {
    const s = frameTimes([0, 16, 16 + HIDDEN_GAP_MS + 1, 32 + HIDDEN_GAP_MS + 1], [true, true, true, true], 1000);
    expect(s.max).toBe(16);
  });

  it('reports over the last window and says when the loop is idle', () => {
    const m = new FrameMeter();
    for (let i = 0; i <= 120; i++) m.tick(i * 1000 / 60, true);
    const busy = m.snapshot(2000);
    expect(busy.idle).toBe(false);
    expect(busy.fps).toBeCloseTo(60, 0);
    expect(busy.p50).toBeCloseTo(16.67, 1);
    // A second of callbacks that draw nothing: idle, fps falls, the display rate stays.
    for (let i = 121; i <= 180; i++) m.tick(i * 1000 / 60, false);
    const idle = m.snapshot(3000);
    expect(idle.idle).toBe(true);
    expect(idle.callbacks).toBeCloseTo(60, 0);
    expect(idle.fps).toBeLessThan(31);
  });

  it('measures a phase between begin and end', () => {
    const m = new FrameMeter();
    m.tick(0, true);
    m.begin(10);
    for (let i = 1; i <= 31; i++) m.tick(10 + i * 33, true);
    const r = m.end(10 + 31 * 33);
    expect(r.frames).toBe(30);
    expect(r.p50).toBe(33);
    expect(r.fps).toBeCloseTo(30 / 1.023, 1);
  });

  it('writes the render size, theme and quality into the overlay', () => {
    const m = new FrameMeter();
    m.setRender(() => ({ width: 2880, height: 1800, pixelRatio: 2, devicePixelRatio: 2, renderScale: 1, theme: 'dusk', quality: 'high', post: ['render', 'bloom'], shadows: true, sync: false }));
    for (let i = 0; i <= 60; i++) m.tick(i * 20, true, i % 2 ? 4 : 6);
    const lines = meterLines(m.snapshot(1200));
    expect(lines[0]).toBe('50 fps · 20.0 / 20.0 ms');
    expect(lines[1]).toBe('max 20 ms · draw 4.0 / 6.0');
    expect(lines[2]).toBe('2880×1800 @2.00 dpr 2.00');
    expect(lines[3]).toBe('dusk · high · post · shadows');
  });
});
