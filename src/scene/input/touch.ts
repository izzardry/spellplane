/**
 * Touch gesture recognition (DESIGN "Input and interaction design", Touch: "Tap selects; drag moves; double-tap taps
 * the card; long-press opens a radial menu …; long-press then drag draws a line; two-finger gestures always drive the
 * camera"; "Camera and navigation", Navigation gestures, Touch column: one-finger drag on empty table pans, two-finger
 * pinch zooms centred between the fingers, two-finger vertical drag pitches (ego only), double-tap with two fingers fits
 * the whole table, double-tap zooms to a card or pile; PLAN Milestone 5, owner decisions: iPad Safari).
 * Contracts: M5-C. Implementer: M5-P1 (this file, the scene's pointer wiring, ui/touch/*).
 *
 * The recogniser is pure: it gets pointer samples with their own timestamps and reports gestures through a callback,
 * so Vitest drives it with plain numbers. It knows nothing of cards: a gesture carries screen points and the scene
 * resolves what is under them (a one-finger `drag` that starts on a card moves it, one that starts on empty table pans).
 * Only `pointerType === 'touch'` samples go to it; mouse and pen keep the M0–M4 handling.
 */
import type { ScreenPoint } from '../types';

/** Gesture timing and distance thresholds in ms and CSS px (DESIGN "Input and interaction design", Touch; values chosen by M5-C, tunable by M5-P1). */
export const TOUCH = {
  /** A finger lifted within this time and within `slopPx` of where it went down is a tap. */
  tapMaxMs: 300,
  /** Movement below this is still a press, not a drag. */
  slopPx: 10,
  /** A second tap within this time of the first … */
  doubleTapMs: 300,
  /** … and within this distance of it is a double-tap. */
  doubleTapPx: 30,
  /** A finger held still this long is a long-press (opens the radial menu). */
  longPressMs: 500,
  /** Two fingers count as a pitch when both move vertically within this angle of vertical, in the same direction … */
  pitchMaxAngleDeg: 30,
  /** … and the distance between them changes by less than this (otherwise it is a pinch). */
  pinchSlopPx: 24,
} as const;

/** Tunable thresholds (DESIGN "Input and interaction design", Touch). */
export type TouchThresholds = { -readonly [K in keyof typeof TOUCH]: number };

/** One pointer sample of a touch (PointerEvent with pointerType 'touch'): id, CSS px relative to the canvas, timestamp in ms. */
export interface TouchSample {
  id: number;
  x: number;
  y: number;
  t: number;
}

/** Phase of a continuous gesture. 'cancel' ends it without effect (a third finger, pointercancel, the page losing focus). */
export type GesturePhase = 'start' | 'move' | 'end' | 'cancel';

/**
 * A recognised gesture (DESIGN "Input and interaction design", Touch; "Camera and navigation", Navigation gestures).
 * - `tap`: a quick release. A second quick tap near the first within `doubleTapMs` is reported as `doubleTap` INSTEAD of
 *   a second `tap` (the first tap already selected).
 * - `longPress`: a finger held still for `longPressMs`; fires while the finger is still down (opens the radial menu).
 * - `drag`: one finger moved past the slop before the long-press fired (move a card, or pan on empty table).
 * - `longPressDrag`: the finger moved after `longPress` fired (draw a line; the radial menu closes).
 * - `twoFinger`: two fingers down; `mode` 'pitch' when they move vertically together, else 'panZoom'. The mode is chosen
 *   once per gesture, when the fingers first leave the slop. Deltas are since the previous event of the gesture.
 * - `twoFingerDoubleTap`: two two-finger taps (fit the whole table).
 */
export type TouchGesture =
  | { kind: 'tap'; at: ScreenPoint; t: number }
  | { kind: 'doubleTap'; at: ScreenPoint; t: number }
  | { kind: 'longPress'; at: ScreenPoint; t: number }
  | { kind: 'drag'; phase: GesturePhase; start: ScreenPoint; at: ScreenPoint; t: number }
  | { kind: 'longPressDrag'; phase: GesturePhase; start: ScreenPoint; at: ScreenPoint; t: number }
  | {
      kind: 'twoFinger';
      phase: GesturePhase;
      mode: 'panZoom' | 'pitch';
      /** Midpoint between the fingers now. */
      centre: ScreenPoint;
      /** Movement of the midpoint since the previous event, CSS px. */
      pan: { dx: number; dy: number };
      /** Ratio of the finger distance to the previous event's (1 = no pinch). */
      scale: number;
      t: number;
    }
  | { kind: 'twoFingerDoubleTap'; at: ScreenPoint; t: number };

/** The tag of a gesture (DESIGN "Input and interaction design", Touch). */
export type TouchGestureKind = TouchGesture['kind'];

/** A touch gesture recogniser (DESIGN "Input and interaction design", Touch). Feed it every touch pointer sample in order. */
export interface TouchRecognizer {
  down(s: TouchSample): void;
  move(s: TouchSample): void;
  up(s: TouchSample): void;
  /** pointercancel, or the finger left the canvas: ends the current gesture with phase 'cancel'. */
  cancel(s: TouchSample): void;
  /** Advance the clock without a sample; the long-press fires from here when the finger stays still. */
  tick(now: number): void;
  /** Fingers down now. */
  fingers(): number;
  /** Forget every finger and pending tap (theme switch, scene disposal). */
  reset(): void;
  /**
   * The one-finger `drag` or `longPressDrag` under way holds something (a card, a stack marker, a line being drawn):
   * further fingers are ignored until that finger lifts, so nothing moves the camera while a finger drags a card (DESIGN
   * "Camera and navigation", Follow options: "nothing ever moves the camera while the player is dragging"). Without it a
   * second finger cancels the one-finger gesture and starts a `twoFinger` one (a pan becomes a pinch). Added by M5-P1.
   */
  capture?(): void;
}

/** Create a recogniser that reports to `onGesture` (DESIGN "Input and interaction design", Touch). Implementer: M5-P1. */
export type CreateTouchRecognizer = (onGesture: (g: TouchGesture) => void, thresholds?: Partial<TouchThresholds>) => TouchRecognizer;

interface Finger {
  id: number;
  x0: number;
  y0: number;
  x: number;
  y: number;
  t0: number;
}

type Mode =
  /** No finger down. */
  | 'idle'
  /** One finger down, within the slop, before the long-press. */
  | 'press'
  /** One finger held past the long-press, within the slop (the radial menu shows). */
  | 'held'
  | 'drag'
  | 'longPressDrag'
  /** Two fingers down; `two.started` once they left the slop. */
  | 'two'
  /** Waiting for every finger to lift after a gesture ended or was cancelled. */
  | 'done';

const dist = (ax: number, ay: number, bx: number, by: number) => Math.hypot(ax - bx, ay - by);

/**
 * The touch gesture recogniser (DESIGN "Input and interaction design", Touch; "Camera and navigation", Navigation
 * gestures). Pure: it keeps fingers and timestamps it is given, never reads a clock. One finger: tap, double-tap
 * (instead of the second tap), long-press (while still down; from `tick` or the next sample), drag (past the slop
 * before the long-press) and long-press-drag (past the slop after it). Two fingers: pan and zoom, or pitch when both
 * move vertically together without pinching, chosen once per gesture; two quick two-finger taps fit the table. A third
 * finger cancels a two-finger gesture; a second finger cancels a one-finger drag unless it was captured.
 */
export const createTouchRecognizer: CreateTouchRecognizer = (onGesture, thresholds) => {
  const th: TouchThresholds = { ...TOUCH, ...thresholds };
  const fingers = new Map<number, Finger>();
  let mode: Mode = 'idle';
  /** The finger of a one-finger gesture. */
  let primary: number | null = null;
  let captured = false;
  /** The last single tap, for a double-tap. */
  let lastTap: { x: number; y: number; t: number } | null = null;
  /** The last two-finger tap, for a two-finger double-tap. */
  let lastTwoTap: { x: number; y: number; t: number } | null = null;
  let two: {
    a: number;
    b: number;
    t0: number;
    started: boolean;
    gestureMode: 'panZoom' | 'pitch';
    /** Centre and finger distance at the previous event. */
    cx: number;
    cy: number;
    d: number;
    /** One finger already lifted (a two-finger tap waits for the other). */
    lifting: boolean;
    /** The 'start' event went out. */
    announced: boolean;
  } | null = null;

  const emit = (g: TouchGesture) => onGesture(g);
  const at = (f: Finger): ScreenPoint => ({ x: f.x, y: f.y });
  const startOf = (f: Finger): ScreenPoint => ({ x: f.x0, y: f.y0 });

  function endOne(phase: 'end' | 'cancel', f: Finger, t: number): void {
    if (mode === 'drag' || mode === 'longPressDrag') emit({ kind: mode, phase, start: startOf(f), at: at(f), t });
  }

  function fireLongPress(f: Finger, t: number): void {
    mode = 'held';
    lastTap = null;
    emit({ kind: 'longPress', at: startOf(f), t });
  }

  function beginTwo(t: number): void {
    const [fa, fb] = [...fingers.values()] as [Finger, Finger];
    // The two-finger gesture starts from where the fingers are now (a one-finger press may have moved within the slop).
    for (const f of [fa, fb]) {
      f.x0 = f.x;
      f.y0 = f.y;
    }
    two = { a: fa.id, b: fb.id, t0: t, started: false, gestureMode: 'panZoom', cx: (fa.x + fb.x) / 2, cy: (fa.y + fb.y) / 2, d: dist(fa.x, fa.y, fb.x, fb.y), lifting: false, announced: false };
    mode = 'two';
    primary = null;
    lastTap = null;
  }

  /** The pitch test (DESIGN: two-finger vertical drag): both fingers within `pitchMaxAngleDeg` of vertical, same direction, distance kept. */
  function chooseMode(fa: Finger, fb: Finger): 'panZoom' | 'pitch' {
    const da = { x: fa.x - fa.x0, y: fa.y - fa.y0 };
    const db = { x: fb.x - fb.x0, y: fb.y - fb.y0 };
    const tan = Math.tan((th.pitchMaxAngleDeg * Math.PI) / 180);
    const vertical = (v: { x: number; y: number }) => Math.abs(v.y) > 0 && Math.abs(v.x) <= Math.abs(v.y) * tan;
    const sameWay = Math.sign(da.y) === Math.sign(db.y) && da.y !== 0;
    const d0 = dist(fa.x0, fa.y0, fb.x0, fb.y0);
    const d1 = dist(fa.x, fa.y, fb.x, fb.y);
    return vertical(da) && vertical(db) && sameWay && Math.abs(d1 - d0) < th.pinchSlopPx ? 'pitch' : 'panZoom';
  }

  function twoMoved(t: number): void {
    const g = two!;
    const fa = fingers.get(g.a);
    const fb = fingers.get(g.b);
    if (!fa || !fb) return;
    if (!g.started) {
      const ma = dist(fa.x, fa.y, fa.x0, fa.y0);
      const mb = dist(fb.x, fb.y, fb.x0, fb.y0);
      if (Math.max(ma, mb) <= th.slopPx) return;
      // Pointer events report each finger on its own: the mode waits until both fingers moved (or one moved far while
      // the other stays, which is a pinch), so a vertical two-finger drag is not taken for a pinch by its first sample.
      if (Math.min(ma, mb) < th.slopPx / 2 && Math.max(ma, mb) < th.slopPx * 3) return;
      g.started = true;
      g.gestureMode = chooseMode(fa, fb);
    }
    const cx = (fa.x + fb.x) / 2;
    const cy = (fa.y + fb.y) / 2;
    const d = dist(fa.x, fa.y, fb.x, fb.y);
    const scale = g.d > 0 && d > 0 ? d / g.d : 1;
    const phase: GesturePhase = g.announced ? 'move' : 'start';
    g.announced = true;
    emit({ kind: 'twoFinger', phase, mode: g.gestureMode, centre: { x: cx, y: cy }, pan: { dx: cx - g.cx, dy: cy - g.cy }, scale, t });
    g.cx = cx;
    g.cy = cy;
    g.d = d;
  }

  function endTwo(phase: 'end' | 'cancel', t: number): void {
    const g = two;
    if (!g || !g.started) return;
    const fa = fingers.get(g.a);
    const fb = fingers.get(g.b);
    const cx = fa && fb ? (fa.x + fb.x) / 2 : g.cx;
    const cy = fa && fb ? (fa.y + fb.y) / 2 : g.cy;
    emit({ kind: 'twoFinger', phase, mode: g.gestureMode, centre: { x: cx, y: cy }, pan: { dx: 0, dy: 0 }, scale: 1, t });
  }

  function settleIdle(): void {
    if (fingers.size === 0) {
      mode = 'idle';
      primary = null;
      captured = false;
      two = null;
    } else mode = 'done';
  }

  const api: TouchRecognizer = {
    down(s) {
      if (fingers.has(s.id)) return;
      const f: Finger = { id: s.id, x0: s.x, y0: s.y, x: s.x, y: s.y, t0: s.t };
      fingers.set(s.id, f);
      if (fingers.size === 1 && mode === 'idle') {
        mode = 'press';
        primary = s.id;
        captured = false;
        return;
      }
      // A finger added to a captured drag is ignored (it is tracked only to know when every finger is up).
      if (captured) return;
      if (fingers.size === 2 && (mode === 'press' || mode === 'held' || mode === 'drag' || mode === 'longPressDrag')) {
        const p = primary !== null ? fingers.get(primary) : undefined;
        if (p) endOne('cancel', p, s.t);
        beginTwo(s.t);
        return;
      }
      if (mode === 'two') {
        // A third finger: the two-finger gesture ends without effect.
        endTwo('cancel', s.t);
        two = null;
        lastTwoTap = null;
        mode = 'done';
        return;
      }
      // Fingers added while waiting for all to lift change nothing.
    },
    move(s) {
      const f = fingers.get(s.id);
      if (!f) return;
      f.x = s.x;
      f.y = s.y;
      if (mode === 'two') {
        if (s.id === two?.a || s.id === two?.b) twoMoved(s.t);
        return;
      }
      if (s.id !== primary) return;
      const out = dist(f.x, f.y, f.x0, f.y0) > th.slopPx;
      if (mode === 'press') {
        // A long-press the clock has not reported yet still counts (the finger was held before it moved).
        if (s.t - f.t0 >= th.longPressMs) fireLongPress(f, f.t0 + th.longPressMs);
        else if (out) {
          mode = 'drag';
          lastTap = null;
          emit({ kind: 'drag', phase: 'start', start: startOf(f), at: at(f), t: s.t });
          return;
        } else return;
      }
      if (mode === 'held') {
        if (!out) return;
        mode = 'longPressDrag';
        emit({ kind: 'longPressDrag', phase: 'start', start: startOf(f), at: at(f), t: s.t });
        return;
      }
      if (mode === 'drag' || mode === 'longPressDrag') emit({ kind: mode, phase: 'move', start: startOf(f), at: at(f), t: s.t });
    },
    up(s) {
      const f = fingers.get(s.id);
      if (!f) return;
      f.x = s.x;
      f.y = s.y;
      if (mode === 'two' && two && (s.id === two.a || s.id === two.b)) {
        const g = two;
        if (g.started) {
          endTwo('end', s.t);
          fingers.delete(s.id);
          lastTwoTap = null;
          two = null;
          settleIdle();
          return;
        }
        fingers.delete(s.id);
        if (!g.lifting) {
          g.lifting = true;
          return;
        }
        // Both fingers lifted without leaving the slop: a two-finger tap, or the second of a two-finger double-tap.
        two = null;
        settleIdle();
        if (s.t - g.t0 > th.tapMaxMs || dist(f.x, f.y, f.x0, f.y0) > th.slopPx) {
          lastTwoTap = null;
          return;
        }
        const tap = { x: g.cx, y: g.cy, t: s.t };
        if (lastTwoTap && s.t - lastTwoTap.t <= th.doubleTapMs && dist(tap.x, tap.y, lastTwoTap.x, lastTwoTap.y) <= th.doubleTapPx * 2) {
          lastTwoTap = null;
          emit({ kind: 'twoFingerDoubleTap', at: { x: tap.x, y: tap.y }, t: s.t });
        } else lastTwoTap = tap;
        return;
      }
      fingers.delete(s.id);
      if (s.id !== primary) {
        if (fingers.size === 0) settleIdle();
        return;
      }
      if (mode === 'press') {
        const out = dist(f.x, f.y, f.x0, f.y0) > th.slopPx;
        const held = s.t - f.t0;
        if (!out && held >= th.longPressMs) fireLongPress(f, f.t0 + th.longPressMs);
        else if (!out && held <= th.tapMaxMs) {
          if (lastTap && s.t - lastTap.t <= th.doubleTapMs && dist(f.x, f.y, lastTap.x, lastTap.y) <= th.doubleTapPx) {
            lastTap = null;
            emit({ kind: 'doubleTap', at: at(f), t: s.t });
          } else {
            lastTap = { x: f.x, y: f.y, t: s.t };
            emit({ kind: 'tap', at: at(f), t: s.t });
          }
        } else lastTap = null;
      } else endOne('end', f, s.t);
      primary = null;
      captured = false;
      settleIdle();
    },
    cancel(s) {
      const f = fingers.get(s.id);
      if (!f) return;
      if (mode === 'two' && two && (s.id === two.a || s.id === two.b)) {
        endTwo('cancel', s.t);
        two = null;
        lastTwoTap = null;
      } else if (s.id === primary) {
        endOne('cancel', f, s.t);
        primary = null;
        captured = false;
      }
      lastTap = null;
      fingers.delete(s.id);
      settleIdle();
    },
    tick(now) {
      if (mode !== 'press' || primary === null) return;
      const f = fingers.get(primary);
      if (f && now - f.t0 >= th.longPressMs) fireLongPress(f, now);
    },
    fingers: () => fingers.size,
    reset() {
      fingers.clear();
      mode = 'idle';
      primary = null;
      captured = false;
      lastTap = null;
      lastTwoTap = null;
      two = null;
    },
    capture() {
      if (mode === 'drag' || mode === 'longPressDrag') captured = true;
    },
  };
  return api;
};
