/**
 * PLAN Milestone 5, owner decisions, Talk key: "Ctrl, either key, instead of V. It never types into a note field.
 * The mic and dictation open only after Ctrl has been held alone for about 200 ms. A key or click during that time
 * makes it a shortcut (Ctrl+Z, Ctrl+Enter, Ctrl+T, Ctrl+click), and no audio or caption is sent. The talk mouse button
 * stays, and the key stays remappable. The cheat sheet, hints and labels say Ctrl." DESIGN "Chat and voice": the talk
 * key is released on window blur and ignored while a text field has focus; Shift plus the talk key is team talk; a
 * note field takes the held key for dictation.
 *
 * The real voice controller (voice/mic.ts) on a fake host, wired to a fake window with an injected clock and timers as
 * the HUD wires it (ui/Hud.svelte): attachTalkInput for focus and the mouse button, and attachModifierTalkActions running
 * the talk actions through runTalkAction (the HUD's hooks.voice).
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { MTG_KEYMAP, chordToString } from '../../../src/games/mtg/keymap';
import { CTRL_KEY_CHORD, isModifierChord, type KeyChord } from '../../../src/games/types';
import { applyOverrides, cheatSheet, findBinding, keyLabel, KeyEngine, matchesChord } from '../../../src/ui/keymap';
import { attachModifierTalkActions, attachTalkInput, runTalkAction, type TalkInputOptions } from '../../../src/ui/voice/input';
import { indicatorLabel } from '../../../src/ui/voice/labels';
import { createVoiceWith } from '../../../src/voice/mic';
import { DEFAULT_TALK } from '../../../src/store/types';
import type { HoldAloneState, TalkState } from '../../../src/voice/types';
import { FakeHost, installMediaStream, settle, table } from './fakes';

beforeEach(() => installMediaStream());

const el = (tagName: string, opts: { type?: string; note?: boolean } = {}) => ({
  tagName,
  type: opts.type,
  closest: (sel: string) => (opts.note && sel === '[data-note-field]' ? {} : null),
});

/** A window stand-in with a manual clock: timers run when the clock passes them. */
function fakeWindow() {
  const doc = Object.assign(new EventTarget(), { activeElement: null as unknown, visibilityState: 'visible' });
  const win = Object.assign(new EventTarget(), { document: doc });
  let now = 0;
  let nextId = 1;
  const timers = new Map<number, { at: number; fn: () => void }>();
  const fire = (target: EventTarget, type: string, fields: Record<string, unknown> = {}) => {
    const e = new Event(type, { cancelable: true });
    for (const [k, v] of Object.entries(fields)) Object.defineProperty(e, k, { value: v });
    target.dispatchEvent(e);
    return e;
  };
  const advance = (ms: number) => {
    const end = now + ms;
    for (;;) {
      const due = [...timers.entries()].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      timers.delete(due[0]);
      now = due[1].at;
      due[1].fn();
    }
    now = end;
  };
  const seams: TalkInputOptions = {
    now: () => now,
    setTimer: (fn, ms) => {
      const id = nextId++;
      timers.set(id, { at: now + ms, fn });
      return id;
    },
    clearTimer: (h) => timers.delete(h as number),
  };
  /** Move the clock without running due timers (an event that arrives before a due timer's callback). */
  const skew = (ms: number) => {
    now += ms;
  };
  return { win, doc, fire, advance, skew, seams, pendingTimers: () => timers.size };
}

const ctrlDown = (code = 'ControlLeft', mods: Record<string, unknown> = {}) => ({ key: 'Control', code, ctrlKey: true, ...mods });
const ctrlUp = (code = 'ControlLeft') => ({ key: 'Control', code, ctrlKey: false });

async function setup(opts: { format?: Parameters<typeof table>[0]; talkChord?: () => KeyChord | null; teamTalkChord?: () => KeyChord | null } = {}) {
  const fake = new FakeHost({ state: table(opts.format ?? '2hg', 't1'), seat: 's0' });
  const voice = createVoiceWith(fake.host(), { meter: null, presence: fake.presenceSeam() });
  await settle();
  await voice.join();
  const w = fakeWindow();
  const holds: HoldAloneState[] = [];
  const states: TalkState[] = [];
  voice.subscribe((s) => states.push(s));
  const win = w.win as unknown as Window;
  const offInput = attachTalkInput(voice, win);
  /** The talk actions the modifier key ran, as the HUD's hooks.voice gets them. */
  const runs: string[] = [];
  const offModifier = attachModifierTalkActions(
    win,
    (action, phase) => {
      runs.push(`${action}:${phase}`);
      runTalkAction(voice, action, phase, w.doc as unknown as Document);
    },
    { ...w.seams, ...(opts.talkChord ? { talkChord: opts.talkChord } : {}), ...(opts.teamTalkChord ? { teamTalkChord: opts.teamTalkChord } : {}), onHold: (s) => holds.push(s) },
  );
  const stop = () => {
    offModifier();
    offInput();
  };
  /** Did any audio or caption ever open since the start? */
  const anythingSent = () => states.some((s) => s.audio !== 'off' || s.dictation !== 'off');
  return { fake, voice, stop, holds, states, runs, anythingSent, ...w };
}

describe('the default talk key is Ctrl', () => {
  it('binds talk to the bare Control key and team talk to Shift with it, labelled "Ctrl"', () => {
    const talk = MTG_KEYMAP.find((b) => b.action === 'talk')!;
    const team = MTG_KEYMAP.find((b) => b.action === 'teamTalk')!;
    expect(talk.chord).toEqual(CTRL_KEY_CHORD);
    expect(talk.trigger).toBe('hold');
    expect(isModifierChord(talk.chord)).toBe(true);
    expect(team.chord).toEqual({ key: 'Control', shift: true });
    expect(chordToString(talk.chord)).toBe('Ctrl');
    expect(chordToString(team.chord)).toBe('Shift+Ctrl');
    expect(keyLabel(MTG_KEYMAP, 'talk')).toBe('Ctrl');
    // Ordinary chords keep their labels.
    expect(chordToString({ key: 'z', ctrl: true })).toBe('Ctrl+Z');
    expect(chordToString({ key: 'i', ctrl: true, shift: true })).toBe('Ctrl+Shift+I');
  });

  it('no V binding is left, and nothing else is bound to a bare modifier', () => {
    expect(MTG_KEYMAP.some((b) => b.chord.key === 'v')).toBe(false);
    expect(MTG_KEYMAP.filter((b) => b.chord.key === 'Control').map((b) => b.action)).toEqual(['talk', 'teamTalk']);
  });

  it('the cheat sheet and the idle indicator say Ctrl', () => {
    const talkRows = cheatSheet(MTG_KEYMAP).find((g) => g.group === 'Talk')!.rows;
    expect(talkRows.map((r) => `${r.label}: ${r.chords.map(chordToString).join(', ')}`)).toEqual(
      expect.arrayContaining(['Talk (hold): Ctrl', 'Team talk (hold): Shift+Ctrl']),
    );
    expect(indicatorLabel('idle', DEFAULT_TALK, keyLabel(MTG_KEYMAP, 'talk')!)).toBe('Hold Ctrl to talk');
  });

  it('the KeyEngine never fires talk on Ctrl, so the hold-alone rule is the only way in; Ctrl chords still fire', () => {
    const fired: string[] = [];
    const engine = new KeyEngine(MTG_KEYMAP, { start: (b) => fired.push(b.action), end: () => undefined }, () => false);
    // A browser's Ctrl keydown reports the modifier itself.
    expect(engine.keydown({ key: 'Control', code: 'ControlLeft', ctrlKey: true }, false)).toBe(false);
    expect(engine.keydown({ key: 'Control', code: 'ControlRight', ctrlKey: true, shiftKey: true }, false)).toBe(false);
    expect(matchesChord(CTRL_KEY_CHORD, { key: 'Control', ctrlKey: true })).toBe(false);
    expect(findBinding(MTG_KEYMAP, { key: 'z', code: 'KeyZ', ctrlKey: true }, false)?.action).toBe('undo');
    engine.keydown({ key: 'z', code: 'KeyZ', ctrlKey: true }, false);
    engine.keydown({ key: 'Enter', ctrlKey: true }, false);
    engine.keydown({ key: 't', code: 'KeyT', ctrlKey: true }, false);
    expect(fired).toEqual(['undo', 'nextTurn', 'token']);
  });

  it('an older remapping of talk to V stays valid', () => {
    const km = applyOverrides(MTG_KEYMAP, [{ action: 'talk', context: 'table', chord: { key: 'v' } }]);
    expect(km.find((b) => b.action === 'talk')!.chord).toEqual({ key: 'v' });
    expect(keyLabel(km, 'talk')).toBe('V');
  });
});

describe('Ctrl held alone opens the mic after about 200 ms', () => {
  it('nothing opens while pending; after 200 ms push-to-talk goes to everyone; release closes it', async () => {
    const { fake, voice, win, fire, advance, holds } = await setup();
    fire(win, 'keydown', ctrlDown());
    expect(holds).toEqual(['pending']);
    advance(199);
    expect(voice.state().audio).toBe('off');
    expect([fake.enabledTo('t1'), fake.enabledTo('t2'), fake.enabledTo('t3')]).toEqual([false, false, false]);
    advance(1);
    expect(voice.state()).toMatchObject({ audio: 'all', reason: 'key' });
    expect([fake.enabledTo('t1'), fake.enabledTo('t2'), fake.enabledTo('t3')]).toEqual([true, true, true]);
    fire(win, 'keyup', ctrlUp());
    expect(voice.state().audio).toBe('off');
    expect(holds).toEqual(['pending', 'talking', 'idle']);
  });

  it('either Ctrl key works; releasing one while the other is still held keeps talking', async () => {
    const { voice, win, fire, advance } = await setup();
    fire(win, 'keydown', ctrlDown('ControlRight'));
    advance(250);
    expect(voice.state().audio).toBe('all');
    fire(win, 'keydown', ctrlDown('ControlLeft'));
    fire(win, 'keyup', ctrlUp('ControlRight'));
    expect(voice.state().audio).toBe('all');
    fire(win, 'keyup', ctrlUp('ControlLeft'));
    expect(voice.state().audio).toBe('off');
  });

  it('auto-repeat keydowns of Ctrl do not restart the wait', async () => {
    const { voice, win, fire, advance } = await setup();
    fire(win, 'keydown', ctrlDown());
    advance(150);
    fire(win, 'keydown', ctrlDown('ControlLeft', { repeat: true }));
    advance(60);
    expect(voice.state().audio).toBe('all');
  });

  it('Shift held first makes it team talk: audio to the teammate only, no caption', async () => {
    const { fake, voice, win, fire, advance } = await setup();
    fire(win, 'keydown', { key: 'Shift', code: 'ShiftLeft', shiftKey: true });
    fire(win, 'keydown', ctrlDown('ControlLeft', { shiftKey: true }));
    advance(200);
    expect(voice.state()).toMatchObject({ audio: 'team', dictation: 'off' });
    expect([fake.enabledTo('t1'), fake.enabledTo('t2'), fake.enabledTo('t3')]).toEqual([true, false, false]);
    fire(win, 'keyup', ctrlUp());
    expect(voice.state().audio).toBe('off');
  });
});

describe('chords stay shortcuts', () => {
  it.each([
    ['Ctrl+Z', { key: 'z', code: 'KeyZ', ctrlKey: true }],
    ['Ctrl+Enter', { key: 'Enter', code: 'Enter', ctrlKey: true }],
    ['Ctrl+T', { key: 't', code: 'KeyT', ctrlKey: true }],
    ['Ctrl+Shift+I', { key: 'Shift', code: 'ShiftLeft', ctrlKey: true, shiftKey: true }],
  ])('%s within the hold time sends no audio and no caption, however long Ctrl stays down', async (_name, key) => {
    const { voice, win, fire, advance, anythingSent, holds, pendingTimers } = await setup();
    await voice.setTalk({ dictation: true });
    fire(win, 'keydown', ctrlDown());
    advance(120);
    fire(win, 'keydown', key);
    expect(holds.at(-1)).toBe('shortcut');
    expect(pendingTimers()).toBe(0);
    advance(5000);
    expect(anythingSent()).toBe(false);
    fire(win, 'keyup', ctrlUp());
    expect(anythingSent()).toBe(false);
    // The next lone hold talks again.
    fire(win, 'keydown', ctrlDown());
    advance(200);
    expect(voice.state().audio).toBe('all');
  });

  it('Ctrl+click and Ctrl+wheel within the hold time are shortcuts', async () => {
    for (const ev of ['pointerdown', 'wheel'] as const) {
      const { win, fire, advance, anythingSent } = await setup();
      fire(win, 'keydown', ctrlDown());
      advance(100);
      fire(win, ev, { pointerId: 1, button: 0 });
      fire(win, 'pointerup', { pointerId: 1 });
      advance(1000);
      expect(anythingSent()).toBe(false);
    }
  });

  it('Ctrl pressed while a mouse button is already down (a Ctrl-drag that skips snapping) never talks', async () => {
    const { win, fire, advance, anythingSent } = await setup();
    fire(win, 'pointerdown', { pointerId: 1, button: 0 });
    fire(win, 'keydown', ctrlDown());
    advance(2000);
    expect(anythingSent()).toBe(false);
    fire(win, 'pointerup', { pointerId: 1 });
    fire(win, 'keyup', ctrlUp());
    // Released and pressed again with no button down, it talks.
    fire(win, 'keydown', ctrlDown());
    advance(200);
    expect(anythingSent()).toBe(true);
  });

  it('Ctrl with Alt or Meta held is a chord at once', async () => {
    const { win, fire, advance, anythingSent } = await setup();
    fire(win, 'keydown', ctrlDown('ControlLeft', { metaKey: true }));
    advance(1000);
    fire(win, 'keyup', ctrlUp());
    fire(win, 'keydown', ctrlDown('ControlLeft', { altKey: true }));
    advance(1000);
    expect(anythingSent()).toBe(false);
  });

  it('a key after the mic opened does not close it; the release does', async () => {
    const { voice, win, fire, advance } = await setup();
    fire(win, 'keydown', ctrlDown());
    advance(300);
    fire(win, 'keydown', { key: 'z', code: 'KeyZ', ctrlKey: true });
    expect(voice.state().audio).toBe('all');
    fire(win, 'keyup', ctrlUp());
    expect(voice.state().audio).toBe('off');
  });
});

describe('stale pointers and late timers', () => {
  it('a press whose pointerup never arrived (a native select popup) stops counting once the pointer moves with no button', async () => {
    const { win, fire, advance, voice, holds } = await setup();
    fire(win, 'pointerdown', { pointerId: 1, button: 0, buttons: 1 });
    // No pointerup: the popup took it. The mouse moves on with no button down.
    fire(win, 'pointermove', { pointerId: 1, buttons: 0 });
    fire(win, 'keydown', ctrlDown());
    expect(holds.at(-1)).toBe('pending');
    advance(200);
    expect(voice.state().audio).toBe('all');
    fire(win, 'keyup', ctrlUp());
  });

  it('a move with a button still down keeps the Ctrl-drag a shortcut', async () => {
    const { win, fire, advance, anythingSent } = await setup();
    fire(win, 'pointerdown', { pointerId: 1, button: 0, buttons: 1 });
    fire(win, 'pointermove', { pointerId: 1, buttons: 1 });
    fire(win, 'keydown', ctrlDown());
    advance(1000);
    expect(anythingSent()).toBe(false);
  });

  it('a key that arrives after the hold time but before the timer ran starts talk once', async () => {
    const { win, fire, advance, skew, runs, voice, pendingTimers } = await setup();
    fire(win, 'keydown', ctrlDown());
    skew(250);
    fire(win, 'keydown', { key: 'z', code: 'KeyZ', ctrlKey: true });
    expect(voice.state().audio).toBe('all');
    expect(pendingTimers()).toBe(0);
    advance(500);
    expect(runs).toEqual(['talk:start']);
    fire(win, 'keyup', ctrlUp());
    expect(runs).toEqual(['talk:start', 'talk:end']);
  });
});

describe('the team talk binding', () => {
  it('Shift then Ctrl runs teamTalk start and end, as the HUD shows "Team talk"', async () => {
    const { win, fire, advance, runs } = await setup();
    fire(win, 'keydown', { key: 'Shift', code: 'ShiftLeft', shiftKey: true });
    fire(win, 'keydown', ctrlDown('ControlLeft', { shiftKey: true }));
    advance(200);
    fire(win, 'keyup', ctrlUp());
    expect(runs).toEqual(['teamTalk:start', 'teamTalk:end']);
  });

  it('talk remapped to a letter: Shift+Ctrl still team talks, Ctrl alone stays a plain modifier', async () => {
    const { voice, win, fire, advance, runs } = await setup({ talkChord: () => ({ key: 'v' }) });
    fire(win, 'keydown', ctrlDown());
    advance(500);
    fire(win, 'keyup', ctrlUp());
    expect(runs).toEqual([]);
    fire(win, 'keydown', { key: 'Shift', code: 'ShiftLeft', shiftKey: true });
    fire(win, 'keydown', ctrlDown('ControlLeft', { shiftKey: true }));
    advance(200);
    expect(voice.state().audio).toBe('team');
    fire(win, 'keyup', ctrlUp());
    expect(runs).toEqual(['teamTalk:start', 'teamTalk:end']);
  });

  it('team talk remapped to a letter: Shift+Ctrl is a chord (a shortcut), Ctrl alone still talks to everyone', async () => {
    const { voice, win, fire, advance, runs, anythingSent } = await setup({ teamTalkChord: () => ({ key: 'b' }) });
    fire(win, 'keydown', { key: 'Shift', code: 'ShiftLeft', shiftKey: true });
    fire(win, 'keydown', ctrlDown('ControlLeft', { shiftKey: true }));
    advance(1000);
    fire(win, 'keyup', ctrlUp());
    expect(anythingSent()).toBe(false);
    fire(win, 'keydown', ctrlDown());
    advance(200);
    expect(voice.state().audio).toBe('all');
    fire(win, 'keyup', ctrlUp());
    expect(runs).toEqual(['talk:start', 'talk:end']);
  });

  it('team talk remapped to Shift+Alt: Shift then Alt team talks, Shift then Ctrl is a chord', async () => {
    const { voice, win, fire, advance, runs } = await setup({ teamTalkChord: () => ({ key: 'Alt', shift: true }) });
    fire(win, 'keydown', { key: 'Shift', code: 'ShiftLeft', shiftKey: true });
    fire(win, 'keydown', ctrlDown('ControlLeft', { shiftKey: true }));
    advance(500);
    fire(win, 'keyup', ctrlUp());
    expect(runs).toEqual([]);
    fire(win, 'keydown', { key: 'Alt', code: 'AltLeft', altKey: true, shiftKey: true });
    advance(200);
    expect(voice.state().audio).toBe('team');
    fire(win, 'keyup', { key: 'Alt', code: 'AltLeft' });
    expect(runs).toEqual(['teamTalk:start', 'teamTalk:end']);
  });
});

describe('focus and blur', () => {
  it('window blur while pending or talking closes everything; nothing opens after', async () => {
    const { voice, win, fire, advance, anythingSent } = await setup();
    fire(win, 'keydown', ctrlDown());
    advance(100);
    fire(win, 'blur', { target: win });
    advance(500);
    expect(anythingSent()).toBe(false);
    fire(win, 'focus', { target: win });
    fire(win, 'keydown', ctrlDown());
    advance(200);
    expect(voice.state().audio).toBe('all');
    fire(win, 'blur', { target: win });
    expect(voice.state().audio).toBe('off');
    // The key-up that never arrived does not matter; the next press starts over.
    fire(win, 'focus', { target: win });
    fire(win, 'keydown', ctrlDown());
    advance(200);
    expect(voice.state().audio).toBe('all');
  });

  it('a hidden page counts as blur', async () => {
    const { voice, win, doc, fire, advance } = await setup();
    fire(win, 'keydown', ctrlDown());
    advance(200);
    doc.visibilityState = 'hidden';
    fire(doc, 'visibilitychange');
    expect(voice.state().audio).toBe('off');
  });

  it('in a chat or search field Ctrl held alone opens nothing', async () => {
    const { win, doc, fire, advance, anythingSent } = await setup();
    doc.activeElement = el('INPUT');
    fire(win, 'focusin', { target: doc.activeElement });
    fire(win, 'keydown', ctrlDown());
    advance(1000);
    fire(win, 'keyup', ctrlUp());
    expect(anythingSent()).toBe(false);
  });

  it('a chat field taking focus while Ctrl is held lets it go without talking', async () => {
    const { voice, win, doc, fire, advance } = await setup();
    fire(win, 'keydown', ctrlDown());
    advance(250);
    expect(voice.state().audio).toBe('all');
    doc.activeElement = el('INPUT');
    fire(win, 'focusin', { target: doc.activeElement });
    expect(voice.state().audio).toBe('off');
  });

  it('in a note field Ctrl held alone dictates into the field (and types nothing: Ctrl is not a character)', async () => {
    const { voice, win, doc, fire, advance } = await setup();
    await voice.setTalk({ dictation: true });
    doc.activeElement = el('INPUT', { note: true });
    fire(win, 'focusin', { target: doc.activeElement });
    const down = fire(win, 'keydown', ctrlDown());
    // The talk key is a modifier: its keydown produces no character to type into the field.
    expect((down as unknown as { key: string }).key.length).toBeGreaterThan(1);
    advance(100);
    expect(voice.state().dictation).toBe('off');
    advance(100);
    expect(voice.state()).toMatchObject({ dictation: 'field', audio: 'off' });
    fire(win, 'keyup', ctrlUp());
    expect(voice.state().dictation).toBe('off');
  });
});

describe('other talk inputs', () => {
  it('the talk mouse button still talks at once', async () => {
    const { voice, win, fire } = await setup();
    await voice.setTalk({ mouseButton: 3 });
    fire(win, 'mousedown', { button: 3, shiftKey: false });
    expect(voice.state().audio).toBe('all');
    fire(win, 'mouseup', { button: 3 });
    expect(voice.state().audio).toBe('off');
  });

  it('a talk key remapped to a letter leaves Ctrl alone (the KeyEngine handles the letter)', async () => {
    const { win, fire, advance, anythingSent } = await setup({ talkChord: () => ({ key: 'v' }) });
    fire(win, 'keydown', ctrlDown());
    advance(1000);
    expect(anythingSent()).toBe(false);
  });

  it('a talk key remapped to another bare modifier (Alt) gets the same hold-alone rule', async () => {
    const { voice, win, fire, advance } = await setup({ talkChord: () => ({ key: 'Alt' }) });
    fire(win, 'keydown', ctrlDown());
    advance(500);
    expect(voice.state().audio).toBe('off');
    fire(win, 'keyup', ctrlUp());
    fire(win, 'keydown', { key: 'Alt', code: 'AltLeft', altKey: true });
    advance(200);
    expect(voice.state().audio).toBe('all');
    fire(win, 'keyup', { key: 'Alt', code: 'AltLeft' });
    expect(voice.state().audio).toBe('off');
  });

  it('stopping it closes a held Ctrl and stops listening', async () => {
    const { voice, win, fire, advance, stop, pendingTimers } = await setup();
    fire(win, 'keydown', ctrlDown());
    advance(200);
    expect(voice.state().audio).toBe('all');
    stop();
    expect(voice.state().audio).toBe('off');
    fire(win, 'keydown', ctrlDown());
    advance(500);
    expect(voice.state().audio).toBe('off');
    expect(pendingTimers()).toBe(0);
  });
});
