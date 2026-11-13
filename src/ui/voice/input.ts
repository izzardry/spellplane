/**
 * The talk key's wiring between the HUD and the voice controller (DESIGN "Chat and voice", Live voice: "The talk key is
 * released on window blur and ignored while a text field has focus"; Notes by voice; Talk modes: the talk key may be a
 * mouse button; "Input and interaction design": keys never fire while a text field has focus). Implementer: M3-P3;
 * the Ctrl talk key: M5-P7.
 *
 * A letter talk key (the old V, or a remapped one) comes from the HUD's KeyEngine (keymap actions 'talk', 'teamTalk',
 * 'mute'), which already drops events from text fields and ends holds on blur; this module feeds the same facts to the
 * controller directly, so the gate closes even when a key-up never arrives.
 *
 * The default talk key is Ctrl, either key (PLAN Milestone 5, owner decisions, Talk key). A bare modifier never matches
 * a KeyEngine chord (its own keydown reports the modifier flag), so this module reads it from the window itself under
 * the hold-alone rule (voice/hold.ts): the mic and dictation open only after Ctrl was held alone for
 * TALK_HOLD_ALONE_MS; a key, click or wheel turn first makes it a shortcut (Ctrl+Z, Ctrl+Enter, Ctrl+T, Ctrl+click) and
 * nothing is sent; Ctrl pressed while a mouse button or finger is already down (a Ctrl-drag that skips snapping) is a
 * shortcut too. Shift held when Ctrl goes down makes it team talk. Ctrl types nothing, so it never types into a note
 * field; held alone there it dictates into the field (DESIGN "Notes by voice"), and in a chat or search field it is
 * ignored like any talk key.
 */
import { CTRL_KEY_CHORD, isModifierChord, type KeyChord } from '../../games/types';
import { createHoldAloneGate } from '../../voice/hold';
import { TALK_HOLD_ALONE_MS, type HoldAloneState, type VoiceControls } from '../../voice/types';
import { isTextEntry } from '../keymap';

const CAPTURE: AddEventListenerOptions = { capture: true };

/** Marks a card note or stack note field: the held talk key dictates into it (DESIGN "Chat and voice", Notes by voice). */
export const NOTE_FIELD_ATTR = 'data-note-field';

/** Whether `el` is a note field (or inside one). */
export function isNoteField(el: unknown): boolean {
  const node = el as { closest?: (sel: string) => unknown } | null;
  return !!node && typeof node.closest === 'function' && node.closest(`[${NOTE_FIELD_ATTR}]`) !== null;
}

/** What a focused element means for the talk key: a text field ignores it, a note field takes it for dictation. */
export function focusKind(el: unknown): { text: boolean; note: boolean } {
  if (!isTextEntry(el)) return { text: false, note: false };
  return isNoteField(el) ? { text: false, note: true } : { text: true, note: false };
}

/**
 * A keymap talk action from the HUD's KeyEngine, mapped onto the controller. A press first re-reads what has focus
 * (`doc.activeElement`; skipped without a document): a text or note field removed from the page without a focusout must
 * not leave a stale flag.
 */
export function runTalkAction(
  voice: VoiceControls,
  action: 'talk' | 'teamTalk' | 'mute',
  phase: 'start' | 'end',
  doc: Pick<Document, 'activeElement'> | null = typeof document === 'undefined' ? null : document,
): void {
  if (action === 'mute') {
    if (phase === 'start') voice.toggleMute();
    return;
  }
  if (phase === 'start') {
    if (doc) voice.focus(focusKind(doc.activeElement));
    voice.keyDown(action === 'teamTalk');
  } else voice.keyUp();
}

/** Options of `attachTalkInput` beyond the controller and the window (the HUD's keymap; test seams). */
export interface TalkInputOptions {
  /**
   * The talk binding's chord now (the keymap with the player's remappings), read on every key press; a bare modifier
   * (games/types.ts isModifierChord) is read here under the hold-alone rule, any other chord is left to the KeyEngine.
   * Default: Ctrl (CTRL_KEY_CHORD).
   */
  talkChord?: () => KeyChord | null;
  /** How long the modifier must be held alone (default TALK_HOLD_ALONE_MS). */
  holdMs?: number;
  /** Clock in ms (default performance.now or Date.now). */
  now?: () => number;
  /** Timers (default the window's). */
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
  /** Told whenever the hold-alone state changes ('pending', 'talking', 'shortcut', 'idle'). */
  onHold?: (state: HoldAloneState) => void;
}

/** What a held modifier talk key does once it counts (attachModifierTalk). */
export interface ModifierTalkHandlers {
  /** Held alone for the hold time: talk starts; `team` when Shift was held first. */
  start(team: boolean): void;
  /** Released (or let go by blur, a hidden page, a text field taking focus) after it had started. */
  end(): void;
}

/**
 * The modifier talk key (Ctrl by default) under the hold-alone rule (voice/hold.ts; PLAN Milestone 5, owner decisions,
 * Talk key; M5-P7): `start` once the modifier was held alone for the hold time, `end` on its release; a key, pointer
 * press or wheel turn first makes it a shortcut that never starts. Window blur, a hidden page and a chat or search field
 * taking focus let it go. Returns the function that stops it (ending a started talk).
 */
export function attachModifierTalk(win: Window, handlers: ModifierTalkHandlers, opts: TalkInputOptions = {}): () => void {
  const doc = win.document;
  const holdMs = opts.holdMs ?? TALK_HOLD_ALONE_MS;
  const gate = createHoldAloneGate(holdMs);
  const now = opts.now ?? (() => (typeof performance !== 'undefined' ? performance.now() : Date.now()));
  const setTimer = opts.setTimer ?? ((fn: () => void, ms: number) => win.setTimeout(fn, ms));
  const clearTimer = opts.clearTimer ?? ((h: unknown) => win.clearTimeout(h as number));
  const talkChord = opts.talkChord ?? (() => CTRL_KEY_CHORD);
  /** The physical keys of the talk modifier held now (ControlLeft, ControlRight): released when the last goes up. */
  const heldKeys = new Set<string>();
  /** The modifier being held as the talk key ('Control'), or null. */
  let heldMod: string | null = null;
  /** Pointers (mouse buttons, fingers, pens) down now: Ctrl pressed during a drag modifies that drag. */
  const pointers = new Set<number>();
  let timer: unknown = null;
  let reported: HoldAloneState = 'idle';
  const report = (): void => {
    const st = gate.state();
    if (st === reported) return;
    reported = st;
    opts.onHold?.(st);
  };
  const stopTimer = (): void => {
    if (timer !== null) clearTimer(timer);
    timer = null;
  };
  /** The modifier the talk binding names, or null when the talk key is not a bare modifier (a letter key). */
  const modifier = (): string | null => {
    const c = talkChord();
    return c && isModifierChord(c) ? c.key : null;
  };
  /** Leave the hold: a talking key ends; a pending or shortcut one just stops. */
  const release = (): void => {
    stopTimer();
    const was = gate.state();
    gate.up(now());
    heldKeys.clear();
    heldMod = null;
    if (was === 'talking') handlers.end();
    report();
  };
  const onTick = (): void => {
    timer = null;
    if (gate.tick(now()) === 'talking') handlers.start(gate.team());
    report();
  };
  /** Another key, a click or a wheel turn while the modifier is held. */
  const other = (): void => {
    if (gate.state() !== 'pending') return;
    const st = gate.other(now());
    if (st === 'talking') onTick();
    else stopTimer();
    report();
  };
  const onKeyDown = (e: KeyboardEvent): void => {
    const mod = heldMod ?? modifier();
    if (mod !== null && e.key === mod) {
      heldKeys.add(e.code || e.key);
      if (heldMod !== null || e.repeat) return;
      heldMod = mod;
      gate.down(now(), mod !== 'Shift' && !!e.shiftKey);
      // Held together with Alt or Meta, or pressed while a pointer is down (a Ctrl-drag), it is a chord at once.
      if ((e.altKey && mod !== 'Alt') || e.metaKey || pointers.size > 0) gate.other(now());
      else timer = setTimer(onTick, holdMs);
      report();
      return;
    }
    // Any other key while it waits, Shift included (Ctrl+Shift+I; team talk is Shift held first), makes it a shortcut.
    if (heldMod !== null) other();
  };
  const onKeyUp = (e: KeyboardEvent): void => {
    if (heldMod === null || e.key !== heldMod) return;
    heldKeys.delete(e.code || e.key);
    // One Ctrl released while the other is still down keeps the hold; a key-up without a code (synthetic) ends it.
    if (heldKeys.size > 0 && e.code) return;
    release();
  };
  const onPointerDown = (e: PointerEvent): void => {
    pointers.add(e.pointerId ?? 0);
    other();
  };
  const onPointerUp = (e: PointerEvent): void => {
    pointers.delete(e.pointerId ?? 0);
  };
  const onWheel = (): void => other();
  const onBlur = (e: Event): void => {
    if (e.target !== win) return;
    pointers.clear();
    release();
  };
  // A chat or search field took focus: the held modifier is let go without talking (the note field keeps it).
  const onFocusIn = (e: FocusEvent): void => {
    if (focusKind(e.target).text) release();
  };
  const onVisibility = (): void => {
    if (doc.visibilityState !== 'hidden') return;
    pointers.clear();
    release();
  };
  win.addEventListener('keydown', onKeyDown, CAPTURE);
  win.addEventListener('keyup', onKeyUp, CAPTURE);
  win.addEventListener('pointerdown', onPointerDown, CAPTURE);
  win.addEventListener('pointerup', onPointerUp, CAPTURE);
  win.addEventListener('pointercancel', onPointerUp, CAPTURE);
  win.addEventListener('wheel', onWheel, CAPTURE);
  win.addEventListener('blur', onBlur);
  win.addEventListener('focusin', onFocusIn);
  doc.addEventListener('visibilitychange', onVisibility);
  return () => {
    win.removeEventListener('keydown', onKeyDown, CAPTURE);
    win.removeEventListener('keyup', onKeyUp, CAPTURE);
    win.removeEventListener('pointerdown', onPointerDown, CAPTURE);
    win.removeEventListener('pointerup', onPointerUp, CAPTURE);
    win.removeEventListener('pointercancel', onPointerUp, CAPTURE);
    win.removeEventListener('wheel', onWheel, CAPTURE);
    win.removeEventListener('blur', onBlur);
    win.removeEventListener('focusin', onFocusIn);
    doc.removeEventListener('visibilitychange', onVisibility);
    release();
  };
}

/**
 * Follow window focus, text and note field focus, page visibility, the talk mouse button and (unless `modifier` is
 * false: the HUD wires it through its own talk actions) a modifier talk key (Ctrl by default) for `voice`. Returns the
 * function that stops it.
 */
export function attachTalkInput(voice: VoiceControls, win: Window = window, opts: TalkInputOptions & { modifier?: boolean } = {}): () => void {
  const doc = win.document;
  const fromFocus = (el: unknown): void => voice.focus(focusKind(el));
  fromFocus(doc.activeElement);

  // The modifier talk key under the hold-alone rule (M5-P7): what has focus decides between a caption, a note field
  // and nothing (a chat field), as for any talk key.
  const offModifier =
    opts.modifier === false
      ? null
      : attachModifierTalk(
          win,
          {
            start: (team) => {
              fromFocus(doc.activeElement);
              voice.keyDown(team);
            },
            end: () => voice.keyUp(),
          },
          opts,
        );

  const onBlur = (e: Event): void => {
    if (e.target === win) voice.focus({ window: false });
  };
  const onFocus = (e: Event): void => {
    if (e.target === win) voice.focus({ window: true });
  };
  const onFocusIn = (e: FocusEvent): void => fromFocus(e.target);
  // Focus leaving for nothing (relatedTarget null) or for another element: what gets it next decides.
  const onFocusOut = (e: FocusEvent): void => fromFocus(e.relatedTarget);
  const onVisibility = (): void => {
    if (doc.visibilityState === 'hidden') voice.focus({ window: false });
  };
  let buttonHeld = false;
  const onMouseDown = (e: MouseEvent): void => {
    const b = voice.talk().mouseButton;
    if (b === null || e.button !== b) return;
    e.preventDefault();
    buttonHeld = true;
    fromFocus(doc.activeElement);
    voice.keyDown(e.shiftKey);
  };
  const onMouseUp = (e: MouseEvent): void => {
    const b = voice.talk().mouseButton;
    if (b === null || e.button !== b) return;
    // The back and forward buttons would otherwise navigate.
    e.preventDefault();
    if (!buttonHeld) return;
    buttonHeld = false;
    voice.keyUp();
  };
  const onAux = (e: MouseEvent): void => {
    const b = voice.talk().mouseButton;
    if (b !== null && e.button === b) e.preventDefault();
  };

  win.addEventListener('blur', onBlur);
  win.addEventListener('focus', onFocus);
  win.addEventListener('focusin', onFocusIn);
  win.addEventListener('focusout', onFocusOut);
  win.addEventListener('mousedown', onMouseDown, CAPTURE);
  win.addEventListener('mouseup', onMouseUp, CAPTURE);
  win.addEventListener('auxclick', onAux, CAPTURE);
  doc.addEventListener('visibilitychange', onVisibility);
  return () => {
    offModifier?.();
    win.removeEventListener('blur', onBlur);
    win.removeEventListener('focus', onFocus);
    win.removeEventListener('focusin', onFocusIn);
    win.removeEventListener('focusout', onFocusOut);
    win.removeEventListener('mousedown', onMouseDown, CAPTURE);
    win.removeEventListener('mouseup', onMouseUp, CAPTURE);
    win.removeEventListener('auxclick', onAux, CAPTURE);
    doc.removeEventListener('visibilitychange', onVisibility);
    if (buttonHeld) voice.keyUp();
  };
}
