/**
 * Held table presses for "Talk while I hold or drag" (DESIGN "Chat and voice", Talk modes; PLAN Milestone 6, owner
 * decisions, Hold-to-talk: "any press of a mouse button or a finger on the table held longer than 200 ms (card drags,
 * line drags, box selection, camera drags, holding to clip) opens the mic as push-to-talk until release; quick clicks
 * and taps never do"). Contract: SceneEvents.pressHold, HOLD_PRESS_TALK_MS (scene/types.ts). Implementer: M6-P2.
 *
 * One press is the time from the first mouse button or finger going down on the table until the last one is up: a
 * second finger (a pinch) or a second button joins the press under way. Once the press has lasted HOLD_PRESS_TALK_MS
 * it reports 'start' once, with what the press is doing then (`kind`); 'end' follows when the press ends: the last
 * pointer released or cancelled, the window losing focus, the page hidden, or a pointer whose release never arrived
 * (its next move reports no button down). Time alone decides, so a press held still (holding to clip) talks like a
 * drag. Presses on the HUD over the table are not table presses: only the scene's own surface counts.
 */
import { HOLD_PRESS_TALK_MS, type TablePressKind } from './types';

/** What the tracker reports to (SceneEvents.pressHold). */
export type PressHoldListener = (phase: 'start' | 'end', kind: TablePressKind) => void;

export interface PressHoldOptions {
  /** What the press under way is doing, read when it starts talking (the scene's gesture). */
  kind(): TablePressKind;
  onChange: PressHoldListener;
  /** The press time, default HOLD_PRESS_TALK_MS. */
  holdMs?: number;
  /** Timers (default the window's); tests inject fake ones. */
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

/** A held-press tracker on a surface (the scene's canvas). */
export interface PressHold {
  /** The press under way has started talking ('start' reported, 'end' not yet). */
  held(): boolean;
  /** The kind reported with the current 'start', or null. */
  kind(): TablePressKind | null;
  /** End a held press now (reporting 'end') and stop listening. */
  dispose(): void;
}

const CAPTURE: AddEventListenerOptions = { capture: true };

/** The pure part: pointers down, the timer and the reported phase (tested without a DOM). */
export class PressHoldTracker {
  private readonly down = new Set<number>();
  private timer: unknown = null;
  private reported: TablePressKind | null = null;
  private readonly holdMs: number;
  private readonly setTimer: (fn: () => void, ms: number) => unknown;
  private readonly clearTimer: (handle: unknown) => void;

  constructor(private readonly opts: PressHoldOptions) {
    const ms = opts.holdMs ?? HOLD_PRESS_TALK_MS;
    this.holdMs = Number.isFinite(ms) && ms >= 0 ? ms : HOLD_PRESS_TALK_MS;
    this.setTimer = opts.setTimer ?? ((fn, t) => setTimeout(fn, t));
    this.clearTimer = opts.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
  }

  /** A mouse button or finger went down on the table. */
  press(pointerId: number): void {
    const first = this.down.size === 0;
    this.down.add(pointerId);
    if (first && this.reported === null) this.timer = this.setTimer(() => this.fire(), this.holdMs);
  }

  /** A pointer went up or was cancelled (anywhere: it may have been captured or have left the table). */
  release(pointerId: number): void {
    if (!this.down.delete(pointerId)) return;
    if (this.down.size === 0) this.end();
  }

  /** Every pointer counts as released: the window lost focus, the page was hidden. */
  releaseAll(): void {
    if (this.down.size === 0 && this.reported === null && this.timer === null) return;
    this.down.clear();
    this.end();
  }

  held(): boolean {
    return this.reported !== null;
  }

  kind(): TablePressKind | null {
    return this.reported;
  }

  /** Pointers counted as down now. */
  pointers(): number {
    return this.down.size;
  }

  private fire(): void {
    this.timer = null;
    if (this.down.size === 0 || this.reported !== null) return;
    let kind: TablePressKind = 'other';
    try {
      kind = this.opts.kind();
    } catch {
      // A kind the scene cannot tell is still a held press.
    }
    this.reported = kind;
    this.opts.onChange('start', kind);
  }

  private end(): void {
    if (this.timer !== null) this.clearTimer(this.timer);
    this.timer = null;
    const was = this.reported;
    this.reported = null;
    if (was !== null) this.opts.onChange('end', was);
  }
}

/**
 * Follow presses on `surface` (the scene's canvas): a press starts there and ends wherever its pointer is released (the
 * window), so a drag that leaves the table or a captured pointer still ends it. Returns the tracker's handle.
 */
export function attachPressHold(surface: HTMLElement, opts: PressHoldOptions, win: Window = window): PressHold {
  const tracker = new PressHoldTracker(opts);
  const doc = win.document;
  const onDown = (e: PointerEvent): void => tracker.press(e.pointerId ?? 0);
  const onUp = (e: PointerEvent): void => tracker.release(e.pointerId ?? 0);
  // A move with no button down: that pointer is up, whether or not its pointerup arrived.
  const onMove = (e: PointerEvent): void => {
    if (e.buttons === 0 && e.pointerType !== 'touch') tracker.release(e.pointerId ?? 0);
  };
  const onBlur = (e: Event): void => {
    if (e.target === win) tracker.releaseAll();
  };
  const onVisibility = (): void => {
    if (doc.visibilityState === 'hidden') tracker.releaseAll();
  };
  surface.addEventListener('pointerdown', onDown, CAPTURE);
  win.addEventListener('pointerup', onUp, CAPTURE);
  win.addEventListener('pointercancel', onUp, CAPTURE);
  win.addEventListener('pointermove', onMove, CAPTURE);
  win.addEventListener('blur', onBlur);
  doc.addEventListener('visibilitychange', onVisibility);
  return {
    held: () => tracker.held(),
    kind: () => tracker.kind(),
    dispose: () => {
      surface.removeEventListener('pointerdown', onDown, CAPTURE);
      win.removeEventListener('pointerup', onUp, CAPTURE);
      win.removeEventListener('pointercancel', onUp, CAPTURE);
      win.removeEventListener('pointermove', onMove, CAPTURE);
      win.removeEventListener('blur', onBlur);
      doc.removeEventListener('visibilitychange', onVisibility);
      tracker.releaseAll();
    },
  };
}
