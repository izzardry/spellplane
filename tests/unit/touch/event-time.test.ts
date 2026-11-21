// Gate M8 finding R3: touch samples carry the pointer event's own time, so a double-tap is told by the time between the
// fingers and not by when a slow frame let the events through; a stamp that cannot be on the performance.now() clock is
// not trusted.
import { describe, expect, it } from 'vitest';
import { touchTime } from '../../../src/scene/input/pointers';
import { createTouchRecognizer, TOUCH, type TouchGesture } from '../../../src/scene/input/touch';

describe('touch event time', () => {
  it('uses the event stamp when it is on the clock and recent, else now', () => {
    expect(touchTime({ timeStamp: 900 }, 1000)).toBe(900);
    expect(touchTime({ timeStamp: 1000 }, 1000)).toBe(1000);
    // From the future, from another clock (epoch milliseconds), missing, or stale: now.
    expect(touchTime({ timeStamp: 1200 }, 1000)).toBe(1000);
    expect(touchTime({ timeStamp: 1_763_700_000_000 }, 1000)).toBe(1000);
    expect(touchTime({ timeStamp: 0 }, 1000)).toBe(1000);
    expect(touchTime({ timeStamp: Number.NaN }, 1000)).toBe(1000);
    expect(touchTime({ timeStamp: 1000 }, 2500)).toBe(2500);
  });

  it('a double-tap whose events a slow frame delivered late is still a double-tap', () => {
    const got: TouchGesture[] = [];
    const r = createTouchRecognizer((g) => got.push(g));
    // The fingers: down 0, up 30, down 90, up 120 (ms). A 600 ms frame held the events back: all arrive at 700.
    const at = 700;
    for (const [kind, t] of [['down', 0], ['up', 30], ['down', 90], ['up', 120]] as const) r[kind]({ id: 1, x: 100, y: 100, t: touchTime({ timeStamp: t + 1 }, at) });
    expect(got.map((g) => g.kind)).toEqual(['tap', 'doubleTap']);
    // Stamped on arrival instead, the same fingers read as a long press.
    const late: TouchGesture[] = [];
    const r2 = createTouchRecognizer((g) => late.push(g));
    r2.down({ id: 1, x: 100, y: 100, t: 0 });
    r2.up({ id: 1, x: 100, y: 100, t: TOUCH.longPressMs + 100 });
    expect(late.map((g) => g.kind)).toEqual(['longPress']);
  });
});
