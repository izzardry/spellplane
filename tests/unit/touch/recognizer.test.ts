// PLAN M5-P1 (Touch): the pure gesture recogniser of scene/input/touch.ts against DESIGN "Input and interaction design",
// Touch ("Tap selects; drag moves; double-tap taps the card; long-press opens a radial menu; long-press then drag draws a
// line; two-finger gestures always drive the camera") and "Camera and navigation", Navigation gestures (one-finger drag
// pans, two-finger pinch zooms centred between the fingers, two-finger vertical drag pitches, double-tap with two
// fingers fits). Time is the samples' own timestamps; nothing here reads a clock.
import { describe, expect, it } from 'vitest';
import { createTouchRecognizer, TOUCH, type TouchGesture, type TouchRecognizer } from '../../../src/scene/input/touch';

function setup(th?: Parameters<typeof createTouchRecognizer>[1]): { r: TouchRecognizer; got: TouchGesture[]; kinds: () => string[] } {
  const got: TouchGesture[] = [];
  const r = createTouchRecognizer((g) => got.push(g), th);
  const kinds = () => got.map((g) => ('phase' in g ? `${g.kind}:${g.phase}` : g.kind));
  return { r, got, kinds };
}

/** A quick tap of finger `id` at (x, y) starting at time t. */
function tap(r: TouchRecognizer, x: number, y: number, t: number, id = 1): void {
  r.down({ id, x, y, t });
  r.up({ id, x, y, t: t + 60 });
}

/** Move finger `id` from (x0, y0) by (dx, dy) in `n` samples, `dt` apart, starting after t. Returns the end time. */
function slide(r: TouchRecognizer, id: number, x0: number, y0: number, dx: number, dy: number, t: number, n = 5, dt = 16): number {
  for (let i = 1; i <= n; i++) r.move({ id, x: x0 + (dx * i) / n, y: y0 + (dy * i) / n, t: t + i * dt });
  return t + n * dt;
}

/** Two fingers moving together, interleaved per sample like pointer events: a from (ax, ay), b from (bx, by). */
function slideTwo(r: TouchRecognizer, a: [number, number, number, number], b: [number, number, number, number], t: number, n = 8): number {
  for (let i = 1; i <= n; i++) {
    r.move({ id: 1, x: a[0] + (a[2] * i) / n, y: a[1] + (a[3] * i) / n, t: t + i * 16 });
    r.move({ id: 2, x: b[0] + (b[2] * i) / n, y: b[1] + (b[3] * i) / n, t: t + i * 16 + 1 });
  }
  return t + n * 16 + 1;
}

const twoFinger = (got: TouchGesture[]) => got.filter((g): g is Extract<TouchGesture, { kind: 'twoFinger' }> => g.kind === 'twoFinger');

describe('one finger', () => {
  it('a quick release within the slop is a tap at the release point', () => {
    const { r, got } = setup();
    r.down({ id: 1, x: 100, y: 100, t: 0 });
    r.move({ id: 1, x: 104, y: 103, t: 40 });
    r.up({ id: 1, x: 104, y: 103, t: 120 });
    expect(got).toEqual([{ kind: 'tap', at: { x: 104, y: 103 }, t: 120 }]);
    expect(r.fingers()).toBe(0);
  });

  it('a press held longer than a tap but released before the long-press is nothing', () => {
    const { r, got } = setup();
    r.down({ id: 1, x: 100, y: 100, t: 0 });
    r.tick(TOUCH.longPressMs - 50);
    r.up({ id: 1, x: 100, y: 100, t: TOUCH.longPressMs - 40 });
    expect(got).toEqual([]);
  });

  it('a second quick tap near the first is a double-tap instead of a second tap', () => {
    const { r, kinds, got } = setup();
    tap(r, 100, 100, 0);
    tap(r, 110, 108, 200);
    expect(kinds()).toEqual(['tap', 'doubleTap']);
    expect(got[1]).toMatchObject({ kind: 'doubleTap', at: { x: 110, y: 108 } });
  });

  it('two taps too far apart in space or time are two taps; a third quick tap after a double-tap is a tap', () => {
    const far = setup();
    tap(far.r, 100, 100, 0);
    tap(far.r, 100 + TOUCH.doubleTapPx + 5, 100, 150);
    expect(far.kinds()).toEqual(['tap', 'tap']);

    const late = setup();
    tap(late.r, 100, 100, 0);
    tap(late.r, 100, 100, 60 + TOUCH.doubleTapMs + 20);
    expect(late.kinds()).toEqual(['tap', 'tap']);

    const triple = setup();
    tap(triple.r, 100, 100, 0);
    tap(triple.r, 100, 100, 150);
    tap(triple.r, 100, 100, 300);
    expect(triple.kinds()).toEqual(['tap', 'doubleTap', 'tap']);
  });

  it('a finger held still fires the long-press while it is down, once, and its release adds nothing', () => {
    const { r, got, kinds } = setup();
    r.down({ id: 1, x: 200, y: 300, t: 1000 });
    r.tick(1000 + TOUCH.longPressMs - 1);
    expect(got).toEqual([]);
    // Jitter within the slop does not stop it.
    r.move({ id: 1, x: 203, y: 304, t: 1100 });
    r.tick(1000 + TOUCH.longPressMs);
    r.tick(1000 + TOUCH.longPressMs + 200);
    expect(got).toEqual([{ kind: 'longPress', at: { x: 200, y: 300 }, t: 1000 + TOUCH.longPressMs }]);
    r.up({ id: 1, x: 203, y: 304, t: 1900 });
    expect(kinds()).toEqual(['longPress']);
  });

  it('a long-press the clock never reported still counts at the next sample', () => {
    const released = setup();
    released.r.down({ id: 1, x: 10, y: 10, t: 0 });
    released.r.up({ id: 1, x: 10, y: 10, t: TOUCH.longPressMs + 100 });
    expect(released.kinds()).toEqual(['longPress']);

    const dragged = setup();
    dragged.r.down({ id: 1, x: 10, y: 10, t: 0 });
    dragged.r.move({ id: 1, x: 60, y: 10, t: TOUCH.longPressMs + 100 });
    expect(dragged.kinds()).toEqual(['longPress', 'longPressDrag:start']);
  });

  it('moving past the slop before the long-press is a drag from the press point, ending where the finger lifts', () => {
    const { r, got, kinds } = setup();
    r.down({ id: 1, x: 100, y: 100, t: 0 });
    r.move({ id: 1, x: 100 + TOUCH.slopPx - 1, y: 100, t: 10 });
    expect(got).toEqual([]);
    const t = slide(r, 1, 100, 100, 80, -40, 10);
    r.tick(t + TOUCH.longPressMs);
    r.up({ id: 1, x: 180, y: 60, t: t + 20 });
    expect(kinds()).toEqual(['drag:start', 'drag:move', 'drag:move', 'drag:move', 'drag:move', 'drag:end']);
    for (const g of got) expect(g).toMatchObject({ start: { x: 100, y: 100 } });
    expect(got.at(-1)).toMatchObject({ at: { x: 180, y: 60 } });
  });

  it('moving after the long-press is a long-press-drag (a line), never a plain drag', () => {
    const { r, kinds, got } = setup();
    r.down({ id: 1, x: 100, y: 100, t: 0 });
    r.tick(TOUCH.longPressMs);
    const t = slide(r, 1, 100, 100, 0, 120, TOUCH.longPressMs);
    r.up({ id: 1, x: 100, y: 220, t: t + 10 });
    expect(kinds()).toEqual(['longPress', 'longPressDrag:start', 'longPressDrag:move', 'longPressDrag:move', 'longPressDrag:move', 'longPressDrag:move', 'longPressDrag:end']);
    expect(got.at(-1)).toMatchObject({ start: { x: 100, y: 100 }, at: { x: 100, y: 220 } });
  });

  it('a tap after a drag, a long-press or a cancel is never the second half of a double-tap', () => {
    const { r, kinds } = setup();
    tap(r, 100, 100, 0);
    r.down({ id: 1, x: 100, y: 100, t: 100 });
    r.cancel({ id: 1, x: 100, y: 100, t: 120 });
    tap(r, 100, 100, 150);
    expect(kinds()).toEqual(['tap', 'tap']);
  });

  it('a pointercancel ends a drag with phase cancel', () => {
    const { r, kinds } = setup();
    r.down({ id: 1, x: 0, y: 0, t: 0 });
    slide(r, 1, 0, 0, 50, 0, 0, 2);
    r.cancel({ id: 1, x: 50, y: 0, t: 100 });
    expect(kinds()).toEqual(['drag:start', 'drag:move', 'drag:cancel']);
    expect(r.fingers()).toBe(0);
  });
});

describe('two fingers', () => {
  it('a pinch zooms around the midpoint: scale ratios multiply to the change in finger distance', () => {
    const { r, got } = setup();
    r.down({ id: 1, x: 480, y: 400, t: 0 });
    r.down({ id: 2, x: 520, y: 400, t: 5 });
    slideTwo(r, [480, 400, -80, 0], [520, 400, 80, 0], 10);
    r.up({ id: 1, x: 400, y: 400, t: 300 });
    r.up({ id: 2, x: 600, y: 400, t: 301 });
    const tf = twoFinger(got);
    expect(got.every((g) => g.kind === 'twoFinger')).toBe(true);
    expect(tf[0]!.phase).toBe('start');
    expect(tf.at(-1)!.phase).toBe('end');
    expect(tf.every((g) => g.mode === 'panZoom')).toBe(true);
    const scale = tf.reduce((s, g) => s * g.scale, 1);
    expect(scale).toBeCloseTo(200 / 40, 5);
    // Pointer events report one finger at a time: once both fingers reported, the centre is between them again.
    for (const g of tf.filter((_, i) => i % 2 === 1)) expect(g.centre.x).toBeCloseTo(500, 5);
    expect(tf.at(-1)!.centre).toEqual({ x: 500, y: 400 });
    expect(Math.abs(tf.reduce((s, g) => s + g.pan.dx, 0))).toBeLessThan(6);
    expect(tf.reduce((s, g) => s + Math.abs(g.pan.dy), 0)).toBeLessThan(1e-6);
  });

  it('two fingers moving together pan by the midpoint movement at scale 1', () => {
    const { r, got } = setup();
    r.down({ id: 1, x: 400, y: 400, t: 0 });
    r.down({ id: 2, x: 500, y: 400, t: 5 });
    slideTwo(r, [400, 400, 150, 20], [500, 400, 150, 20], 10);
    r.up({ id: 1, x: 550, y: 420, t: 300 });
    r.up({ id: 2, x: 650, y: 420, t: 301 });
    const tf = twoFinger(got);
    expect(tf.every((g) => g.mode === 'panZoom')).toBe(true);
    // The deltas add up to the midpoint's whole movement once the gesture started.
    const dx = tf.reduce((s, g) => s + g.pan.dx, 0);
    const dy = tf.reduce((s, g) => s + g.pan.dy, 0);
    const start = tf[0]!;
    expect(dx + (start.centre.x - start.pan.dx - 450)).toBeCloseTo(150, 5);
    expect(dy + (start.centre.y - start.pan.dy - 400)).toBeCloseTo(20, 5);
    expect(tf.reduce((s, g) => s * g.scale, 1)).toBeCloseTo(1, 5);
    expect(tf.at(-1)!.centre).toEqual({ x: 600, y: 420 });
  });

  it('two fingers moving vertically together without pinching pitch; the mode stays for the whole gesture', () => {
    const { r, got } = setup();
    r.down({ id: 1, x: 400, y: 400, t: 0 });
    r.down({ id: 2, x: 500, y: 405, t: 5 });
    let t = slideTwo(r, [400, 400, 6, -120], [500, 405, 4, -118], 10);
    // Later the fingers spread and drift sideways: still a pitch (chosen once per gesture).
    t = slideTwo(r, [406, 280, -60, 0], [504, 287, 60, 0], t);
    r.up({ id: 1, x: 346, y: 280, t: t + 5 });
    r.up({ id: 2, x: 564, y: 287, t: t + 6 });
    const tf = twoFinger(got);
    expect(tf.length).toBeGreaterThan(4);
    expect(tf.every((g) => g.mode === 'pitch')).toBe(true);
    expect(tf.reduce((s, g) => s + g.pan.dy, 0)).toBeLessThan(-80);
  });

  it('vertical moves in opposite directions, a vertical spread, or a sideways drag are pan and zoom, not pitch', () => {
    const cases: [number[], number[]][] = [
      [
        [400, 400, 0, -60],
        [500, 400, 0, 60],
      ],
      [
        [450, 380, 0, -40],
        [450, 420, 0, 40],
      ],
      [
        [400, 400, 120, 10],
        [500, 400, 120, 10],
      ],
    ];
    for (const [a, b] of cases) {
      const { r, got } = setup();
      r.down({ id: 1, x: a[0]!, y: a[1]!, t: 0 });
      r.down({ id: 2, x: b[0]!, y: b[1]!, t: 1 });
      slideTwo(r, a as [number, number, number, number], b as [number, number, number, number], 5);
      expect(twoFinger(got).length).toBeGreaterThan(0);
      expect(twoFinger(got).every((g) => g.mode === 'panZoom')).toBe(true);
    }
  });

  it('a vertical two-finger drag reported one finger at a time is still a pitch (the first finger moves first)', () => {
    const { r, got } = setup();
    r.down({ id: 1, x: 400, y: 400, t: 0 });
    r.down({ id: 2, x: 500, y: 400, t: 1 });
    // Finger 1 alone moves 12 px before finger 2 reports anything.
    r.move({ id: 1, x: 400, y: 388, t: 10 });
    r.move({ id: 2, x: 500, y: 388, t: 11 });
    slideTwo(r, [400, 388, 0, -100], [500, 388, 0, -100], 20);
    expect(twoFinger(got)[0]!.mode).toBe('pitch');
  });

  it('a second finger cancels a one-finger drag (a pan) and starts a two-finger gesture', () => {
    const { r, kinds } = setup();
    r.down({ id: 1, x: 300, y: 300, t: 0 });
    slide(r, 1, 300, 300, 40, 0, 0, 2);
    r.down({ id: 2, x: 500, y: 300, t: 50 });
    slideTwo(r, [340, 300, -40, 0], [500, 300, 40, 0], 60);
    r.up({ id: 1, x: 300, y: 300, t: 300 });
    r.up({ id: 2, x: 540, y: 300, t: 301 });
    expect(kinds().slice(0, 3)).toEqual(['drag:start', 'drag:move', 'drag:cancel']);
    expect(kinds()[3]).toBe('twoFinger:start');
    expect(kinds().at(-1)).toBe('twoFinger:end');
  });

  it('a captured drag (a card held) ignores further fingers: no camera gesture, the drag goes on and ends with its finger', () => {
    const { r, kinds, got } = setup();
    r.down({ id: 1, x: 300, y: 300, t: 0 });
    slide(r, 1, 300, 300, 40, 0, 0, 2);
    r.capture?.();
    r.down({ id: 2, x: 500, y: 300, t: 50 });
    r.move({ id: 2, x: 600, y: 350, t: 60 });
    r.move({ id: 1, x: 360, y: 320, t: 70 });
    r.up({ id: 2, x: 600, y: 350, t: 80 });
    r.move({ id: 1, x: 380, y: 330, t: 90 });
    r.up({ id: 1, x: 380, y: 330, t: 100 });
    expect(kinds()).toEqual(['drag:start', 'drag:move', 'drag:move', 'drag:move', 'drag:end']);
    expect(got.at(-1)).toMatchObject({ at: { x: 380, y: 330 } });
    expect(r.fingers()).toBe(0);
    // Back to normal afterwards.
    tap(r, 10, 10, 1000);
    expect(kinds().at(-1)).toBe('tap');
  });

  it('a captured drag whose extra finger is still down when it ends waits for that finger, which makes no tap', () => {
    const { r, kinds } = setup();
    r.down({ id: 1, x: 300, y: 300, t: 0 });
    slide(r, 1, 300, 300, 40, 0, 0, 2);
    r.capture?.();
    r.down({ id: 2, x: 500, y: 300, t: 50 });
    r.up({ id: 1, x: 340, y: 300, t: 60 });
    r.up({ id: 2, x: 500, y: 300, t: 70 });
    expect(kinds()).toEqual(['drag:start', 'drag:move', 'drag:end']);
  });

  it('capture only holds a drag: a press within the slop still becomes a two-finger gesture', () => {
    const { r, kinds } = setup();
    r.down({ id: 1, x: 300, y: 300, t: 0 });
    r.capture?.();
    r.down({ id: 2, x: 400, y: 300, t: 10 });
    slideTwo(r, [300, 300, -50, 0], [400, 300, 50, 0], 20);
    expect(kinds()[0]).toBe('twoFinger:start');
  });

  it('a third finger cancels the two-finger gesture; nothing more until every finger lifts', () => {
    const { r, kinds } = setup();
    r.down({ id: 1, x: 300, y: 300, t: 0 });
    r.down({ id: 2, x: 400, y: 300, t: 1 });
    slideTwo(r, [300, 300, -40, 0], [400, 300, 40, 0], 5);
    r.down({ id: 3, x: 350, y: 500, t: 200 });
    r.move({ id: 1, x: 200, y: 300, t: 210 });
    r.move({ id: 3, x: 360, y: 600, t: 215 });
    r.up({ id: 3, x: 360, y: 600, t: 220 });
    r.up({ id: 2, x: 440, y: 300, t: 230 });
    r.up({ id: 1, x: 200, y: 300, t: 240 });
    expect(kinds().at(-1)).toBe('twoFinger:cancel');
    expect(kinds().filter((k) => k === 'twoFinger:cancel')).toHaveLength(1);
    expect(r.fingers()).toBe(0);
    tap(r, 10, 10, 1000);
    expect(kinds().at(-1)).toBe('tap');
  });

  it('two quick two-finger taps are a two-finger double-tap; one alone, or slow ones, are nothing; never a one-finger tap', () => {
    const two = (r: TouchRecognizer, t: number, hold = 80) => {
      r.down({ id: 1, x: 400, y: 400, t });
      r.down({ id: 2, x: 500, y: 400, t: t + 10 });
      r.up({ id: 1, x: 400, y: 400, t: t + hold });
      r.up({ id: 2, x: 500, y: 400, t: t + hold + 10 });
    };
    const ok = setup();
    two(ok.r, 0);
    expect(ok.got).toEqual([]);
    two(ok.r, 200);
    expect(ok.kinds()).toEqual(['twoFingerDoubleTap']);
    expect(ok.got[0]).toMatchObject({ at: { x: 450, y: 400 } });

    const late = setup();
    two(late.r, 0);
    two(late.r, 100 + TOUCH.doubleTapMs + 50);
    expect(late.got).toEqual([]);

    const slow = setup();
    two(slow.r, 0, TOUCH.tapMaxMs + 50);
    two(slow.r, TOUCH.tapMaxMs + 100);
    expect(slow.got).toEqual([]);
  });

  it('a two-finger tap whose last finger slid away is not a tap', () => {
    const { r, got } = setup();
    for (const t of [0, 150]) {
      r.down({ id: 1, x: 400, y: 400, t });
      r.down({ id: 2, x: 500, y: 400, t: t + 5 });
      r.up({ id: 1, x: 400, y: 400, t: t + 40 });
      r.move({ id: 2, x: 560, y: 400, t: t + 50 });
      r.up({ id: 2, x: 560, y: 400, t: t + 60 });
    }
    expect(got).toEqual([]);
  });

  it('a second finger during a long-press turns it into a camera gesture, never a line', () => {
    const { r, kinds } = setup();
    r.down({ id: 1, x: 300, y: 300, t: 0 });
    r.tick(TOUCH.longPressMs + 10);
    r.down({ id: 2, x: 400, y: 300, t: TOUCH.longPressMs + 20 });
    slideTwo(r, [300, 300, -30, 0], [400, 300, 30, 0], TOUCH.longPressMs + 30);
    expect(kinds()[0]).toBe('longPress');
    expect(kinds().slice(1).every((k) => k.startsWith('twoFinger'))).toBe(true);
  });
});

describe('housekeeping', () => {
  it('reset forgets fingers and a pending tap', () => {
    const { r, kinds } = setup();
    tap(r, 100, 100, 0);
    r.down({ id: 5, x: 0, y: 0, t: 50 });
    r.reset();
    expect(r.fingers()).toBe(0);
    tap(r, 100, 100, 100);
    expect(kinds()).toEqual(['tap', 'tap']);
    // Samples for fingers it no longer knows are ignored.
    r.move({ id: 5, x: 300, y: 300, t: 300 });
    r.up({ id: 5, x: 300, y: 300, t: 310 });
    expect(kinds()).toEqual(['tap', 'tap']);
  });

  it('thresholds are tunable', () => {
    const { r, kinds } = setup({ longPressMs: 200, slopPx: 30 });
    r.down({ id: 1, x: 0, y: 0, t: 0 });
    r.move({ id: 1, x: 25, y: 0, t: 50 });
    r.tick(210);
    expect(kinds()).toEqual(['longPress']);
  });
});
