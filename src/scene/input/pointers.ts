/**
 * Touch pointers to gestures (DESIGN "Input and interaction design", Touch; PLAN M5-P1). Feeds the pure recogniser
 * (scene/input/touch.ts) with the `pointerType === 'touch'` pointer events of one element, stamped with
 * `performance.now()` (the clock its `tick` also runs on), and keeps the last gestures for the debug hook's
 * `touch.gestures()`. Mouse and pen events are left to their own handling.
 */
import { createTouchRecognizer, type TouchGesture, type TouchRecognizer, type TouchThresholds } from './touch';

/** How many recognised gestures the debug hook keeps (debug/types.ts TouchDebug: at most 50). */
export const GESTURE_LOG_SIZE = 50;

const log: TouchGesture[] = [];

/** Remember a recognised gesture for the debug hook (the table scene and the hand fan both report here). */
export function recordGesture(g: TouchGesture): void {
  log.push(g);
  if (log.length > GESTURE_LOG_SIZE) log.splice(0, log.length - GESTURE_LOG_SIZE);
}

/** The last recognised gestures, oldest first (debug hook `touch.gestures()`). */
export function recentGestures(): TouchGesture[] {
  return log.slice();
}

/** Whether a pointer event comes from a finger (DESIGN "Input and interaction design", Touch: mouse and pen keep their handling). */
export const isTouch = (e: Pick<PointerEvent, 'pointerType'>): boolean => e.pointerType === 'touch';

/** Pointer events of one element to touch gestures. */
export class TouchPointers {
  readonly recognizer: TouchRecognizer;
  /** When a finger last touched (performance.now()); the compatibility mouse events browsers send after it are ignored. */
  lastTouchAt = -Infinity;

  constructor(onGesture: (g: TouchGesture) => void, thresholds?: Partial<TouchThresholds>) {
    this.recognizer = createTouchRecognizer((g) => {
      recordGesture(g);
      onGesture(g);
    }, thresholds);
  }

  /** Feed a pointer event; true when it was a touch (and is handled here). */
  take(e: PointerEvent): boolean {
    if (!isTouch(e)) return false;
    const now = performance.now();
    this.lastTouchAt = now;
    const s = { id: e.pointerId, x: e.clientX, y: e.clientY, t: now };
    switch (e.type) {
      case 'pointerdown':
        this.recognizer.down(s);
        break;
      case 'pointermove':
        this.recognizer.move(s);
        break;
      case 'pointerup':
        this.recognizer.up(s);
        break;
      case 'pointercancel':
        this.recognizer.cancel(s);
        break;
      default:
        return true;
    }
    this.lastTouchAt = performance.now();
    return true;
  }

  /** Advance the long-press clock (every animation frame). */
  tick(now = performance.now()): void {
    this.recognizer.tick(now);
  }

  /** The drag under way holds something: ignore further fingers (nothing moves the camera while a finger drags a card). */
  capture(): void {
    this.recognizer.capture?.();
  }

  /** A finger is down. */
  active(): boolean {
    return this.recognizer.fingers() > 0;
  }

  /** Whether a touch happened within `ms` (ignore the mouse events and context menu browsers synthesise from it). */
  recent(ms = 800, now = performance.now()): boolean {
    return this.active() || now - this.lastTouchAt < ms;
  }

  reset(): void {
    this.recognizer.reset();
  }
}
