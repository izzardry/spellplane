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
}

/** Create a recogniser that reports to `onGesture` (DESIGN "Input and interaction design", Touch). Implementer: M5-P1. */
export type CreateTouchRecognizer = (onGesture: (g: TouchGesture) => void, thresholds?: Partial<TouchThresholds>) => TouchRecognizer;

/** Stub until M5-P1 lands (DESIGN "Input and interaction design", Touch). */
export const createTouchRecognizer: CreateTouchRecognizer = () => {
  throw new Error('not implemented: M5-P1');
};
