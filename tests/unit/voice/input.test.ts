/**
 * PLAN M3-P3: the talk key's wiring between the HUD and the voice controller (DESIGN "Chat and voice", Live voice: "The
 * talk key is released on window blur and ignored while a text field has focus"; Talk modes: the talk key may be a mouse
 * button; Notes by voice; "Input and interaction design": keys never fire while a text field has focus).
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { attachTalkInput, focusKind, runTalkAction } from '../../../src/ui/voice/input';
import { createVoiceWith } from '../../../src/voice/mic';
import { FakeHost, installMediaStream, settle, table } from './fakes';

beforeEach(() => installMediaStream());

/** A duck-typed element: tag, input type, and whether it sits in a note field. */
const el = (tagName: string, opts: { type?: string; note?: boolean } = {}) => ({
  tagName,
  type: opts.type,
  closest: (sel: string) => (opts.note && sel === '[data-note-field]' ? {} : null),
});

describe('focus kinds', () => {
  it('a chat or search field ignores the talk key; a note field takes it for dictation; buttons are neither', () => {
    expect(focusKind(el('INPUT'))).toEqual({ text: true, note: false });
    expect(focusKind(el('TEXTAREA'))).toEqual({ text: true, note: false });
    expect(focusKind(el('INPUT', { note: true }))).toEqual({ text: false, note: true });
    expect(focusKind(el('INPUT', { type: 'checkbox' }))).toEqual({ text: false, note: false });
    expect(focusKind(el('BUTTON'))).toEqual({ text: false, note: false });
    expect(focusKind(null)).toEqual({ text: false, note: false });
  });
});

/** A window stand-in: events are dispatched with the fields the listeners read. */
function fakeWindow() {
  const doc = Object.assign(new EventTarget(), { activeElement: null as unknown, visibilityState: 'visible' });
  const win = Object.assign(new EventTarget(), { document: doc });
  const fire = (target: EventTarget, type: string, fields: Record<string, unknown> = {}) => {
    const e = new Event(type, { cancelable: true });
    for (const [k, v] of Object.entries(fields)) Object.defineProperty(e, k, { value: v });
    target.dispatchEvent(e);
    return e;
  };
  return { win, doc, fire };
}

async function setup() {
  const fake = new FakeHost({ state: table('2hg', 't1'), seat: 's0' });
  const voice = createVoiceWith(fake.host(), { meter: null, presence: fake.presenceSeam() });
  await settle();
  await voice.join();
  const w = fakeWindow();
  const stop = attachTalkInput(voice, w.win as unknown as Window);
  return { fake, voice, stop, ...w };
}

describe('attachTalkInput', () => {
  it('window blur closes a held talk key', async () => {
    const { fake, voice, win, fire } = await setup();
    runTalkAction(voice, 'talk', 'start');
    expect(fake.enabledTo('t1')).toBe(true);
    fire(win, 'blur', { target: win });
    expect(fake.enabledTo('t1')).toBe(false);
    fire(win, 'focus', { target: win });
    expect(fake.enabledTo('t1')).toBe(false);
  });

  it('a hidden page (switching tabs) counts as blur', async () => {
    const { fake, voice, doc, fire } = await setup();
    runTalkAction(voice, 'talk', 'start');
    doc.visibilityState = 'hidden';
    fire(doc, 'visibilitychange');
    expect(fake.enabledTo('t1')).toBe(false);
  });

  it('focus moving into a text field releases the key and keeps it ignored there; leaving the field restores it', async () => {
    const { fake, voice, win, fire } = await setup();
    runTalkAction(voice, 'teamTalk', 'start');
    expect(fake.enabledTo('t1')).toBe(true);
    fire(win, 'focusin', { target: el('INPUT') });
    expect(fake.enabledTo('t1')).toBe(false);
    runTalkAction(voice, 'talk', 'start');
    expect(voice.state().audio).toBe('off');
    fire(win, 'focusout', { target: el('INPUT'), relatedTarget: null });
    runTalkAction(voice, 'talk', 'start');
    expect(voice.state().audio).toBe('all');
  });

  it('a focused note field routes the held key to dictation into it', async () => {
    const { voice, win, fire } = await setup();
    fire(win, 'focusin', { target: el('INPUT', { note: true }) });
    runTalkAction(voice, 'talk', 'start');
    expect(voice.state()).toMatchObject({ audio: 'off', dictation: 'field' });
  });

  it('a press re-reads the focused element: a field removed without a focusout leaves no stale flag', async () => {
    const { voice, win, doc, fire } = await setup();
    // A text field took focus, then was removed from the page without a focusout.
    fire(win, 'focusin', { target: el('INPUT') });
    doc.activeElement = null;
    runTalkAction(voice, 'talk', 'start', doc as unknown as Document);
    expect(voice.state().audio).toBe('all');
    runTalkAction(voice, 'talk', 'end', doc as unknown as Document);
    // A note field that went away the same way: the key is push-to-talk again, not note dictation.
    fire(win, 'focusin', { target: el('INPUT', { note: true }) });
    runTalkAction(voice, 'talk', 'start', doc as unknown as Document);
    expect(voice.state()).toMatchObject({ audio: 'all', dictation: 'off' });
    runTalkAction(voice, 'talk', 'end', doc as unknown as Document);
    // The focused element itself still counts: a chat field that has focus ignores the key.
    doc.activeElement = el('INPUT');
    runTalkAction(voice, 'talk', 'start', doc as unknown as Document);
    expect(voice.state().audio).toBe('off');
  });

  it('the talk mouse button re-reads the focused element too', async () => {
    const { voice, win, doc, fire } = await setup();
    await voice.setTalk({ mouseButton: 3 });
    fire(win, 'focusin', { target: el('INPUT') });
    doc.activeElement = null;
    fire(win, 'mousedown', { button: 3, shiftKey: false });
    expect(voice.state().audio).toBe('all');
  });

  it('the configured mouse button talks while held (Shift for team talk); other buttons do nothing', async () => {
    const { fake, voice, win, fire } = await setup();
    fire(win, 'mousedown', { button: 3, shiftKey: false });
    expect(voice.state().audio).toBe('off');
    await voice.setTalk({ mouseButton: 3 });
    fire(win, 'mousedown', { button: 0, shiftKey: false });
    expect(voice.state().audio).toBe('off');
    const down = fire(win, 'mousedown', { button: 3, shiftKey: true });
    expect(down.defaultPrevented).toBe(true);
    expect([fake.enabledTo('t1'), fake.enabledTo('t2')]).toEqual([true, false]);
    fire(win, 'mouseup', { button: 3 });
    expect(voice.state().audio).toBe('off');
  });

  it('the mute action toggles; only its start counts', async () => {
    const { voice } = await setup();
    runTalkAction(voice, 'mute', 'start');
    runTalkAction(voice, 'mute', 'end');
    expect(voice.indicator()).toBe('muted');
  });

  it('stopping it releases a held mouse button and stops listening', async () => {
    const { voice, win, fire, stop } = await setup();
    await voice.setTalk({ mouseButton: 4 });
    fire(win, 'mousedown', { button: 4, shiftKey: false });
    expect(voice.state().audio).toBe('all');
    stop();
    expect(voice.state().audio).toBe('off');
    fire(win, 'mousedown', { button: 4, shiftKey: false });
    expect(voice.state().audio).toBe('off');
  });
});
