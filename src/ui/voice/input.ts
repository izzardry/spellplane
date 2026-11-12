/**
 * The talk key's wiring between the HUD and the voice controller (DESIGN "Chat and voice", Live voice: "The talk key is
 * released on window blur and ignored while a text field has focus"; Notes by voice; Talk modes: the talk key may be a
 * mouse button; "Input and interaction design": keys never fire while a text field has focus). Implementer: M3-P3.
 *
 * The keys themselves come from the HUD's KeyEngine (keymap actions 'talk', 'teamTalk', 'mute'), which already drops
 * events from text fields and ends holds on blur; this module feeds the same facts to the controller directly, so the
 * gate closes even when a key-up never arrives.
 */
import type { VoiceControls } from '../../voice/types';
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

/**
 * Follow window focus, text and note field focus, page visibility and the talk mouse button for `voice`. Returns the
 * function that stops it.
 */
export function attachTalkInput(voice: VoiceControls, win: Window = window): () => void {
  const doc = win.document;
  const fromFocus = (el: unknown): void => voice.focus(focusKind(el));
  fromFocus(doc.activeElement);

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
