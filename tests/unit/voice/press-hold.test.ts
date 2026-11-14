/**
 * PLAN Milestone 6, owner decisions, Hold-to-talk (M6-P2): 'A setting "Talk while I hold or drag" (Voice section, off by
 * default). When on, at a table with voice, any press of a mouse button or a finger on the table held longer than 200 ms
 * (card drags, line drags, box selection, camera drags, holding to clip) opens the mic as push-to-talk until release;
 * quick clicks and taps never do. Dictation captions attach to the dragged card as usual.' Task: shows the normal talk
 * indicator; never while typing in a field; spectators never talk.
 *
 * Three layers: the pure talk-state rule (voice/modes.ts), the controller (voice/mic.ts pressHeld and the setting), and
 * the scene's press tracker (scene/press-hold.ts) with the HUD's forwarder (ui/voice/press.ts).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PressHoldTracker } from '../../../src/scene/press-hold';
import { HOLD_PRESS_TALK_MS, type TablePressKind } from '../../../src/scene/types';
import { DEFAULT_SETTINGS, DEFAULT_TALK, type TalkSettings } from '../../../src/store/types';
import { PressTalk } from '../../../src/ui/voice/press';
import { createVoiceWith, pressTalking, setTalkWhileHolding, talkWhileHolding } from '../../../src/voice/mic';
import { talkIndicator, talkState } from '../../../src/voice/modes';
import type { TalkInputs, VoiceControls } from '../../../src/voice/types';
import { FakeHost, installMediaStream, settle, table } from './fakes';

const base = (patch: Partial<TalkInputs> = {}, settings: Partial<TalkSettings> = {}): TalkInputs => ({
  settings: { ...DEFAULT_TALK, ...settings },
  keyHeld: false,
  teamKey: false,
  ownTurn: false,
  hasTeammate: false,
  textFocus: false,
  noteFocus: false,
  windowFocus: true,
  micReady: true,
  ...patch,
});

describe('the talk-state rule with a held press', () => {
  it('counts a held press as the talk key: audio to everyone and captions, reason key', () => {
    expect(talkState(base({ pressHeld: true }, { voice: true, dictation: true }))).toEqual({ audio: 'all', dictation: 'caption', reason: 'key', muted: false });
    expect(talkState(base({ pressHeld: true }, { voice: true, dictation: false }))).toMatchObject({ audio: 'all', dictation: 'off' });
    // Dictation alone (no live voice): captions only.
    expect(talkState(base({ pressHeld: true }, { voice: false, dictation: true }))).toMatchObject({ audio: 'off', dictation: 'caption', reason: 'key' });
    expect(talkIndicator(talkState(base({ pressHeld: true })), true)).toBe('live');
  });

  it('absent or false means no press', () => {
    expect(talkState(base())).toMatchObject({ audio: 'off', reason: null });
    expect(talkState(base({ pressHeld: false }))).toMatchObject({ audio: 'off', reason: null });
  });

  it('never while a text or note field has focus or the window has none, and never when muted', () => {
    expect(talkState(base({ pressHeld: true, textFocus: true }))).toMatchObject({ audio: 'off', dictation: 'off' });
    // A press never dictates into a note field (it is not the talk key).
    expect(talkState(base({ pressHeld: true, noteFocus: true }, { dictation: true }))).toMatchObject({ audio: 'off', dictation: 'off' });
    expect(talkState(base({ pressHeld: true, windowFocus: false }))).toMatchObject({ audio: 'off' });
    expect(talkState(base({ pressHeld: true }, { muted: true }))).toMatchObject({ audio: 'off', muted: true });
  });

  it('opens no audio before the microphone was acquired', () => {
    expect(talkState(base({ pressHeld: true, micReady: false }, { dictation: false }))).toMatchObject({ audio: 'off', reason: null });
  });

  it('is never team talk; a held team key wins over it, so partner-only words never reach the table', () => {
    expect(talkState(base({ pressHeld: true, hasTeammate: true }))).toMatchObject({ audio: 'all' });
    expect(talkState(base({ pressHeld: true, keyHeld: true, teamKey: true, hasTeammate: true }))).toMatchObject({ audio: 'team', dictation: 'off' });
    expect(talkState(base({ pressHeld: true, keyHeld: true, teamKey: true, hasTeammate: false }))).toMatchObject({ audio: 'off', dictation: 'off' });
  });
});

describe('the controller: "Talk while I hold or drag"', () => {
  beforeEach(() => installMediaStream());
  let open: VoiceControls[] = [];
  afterEach(() => {
    for (const v of open) v.dispose();
    open = [];
  });
  async function voiceOver(fake: FakeHost, listenOnly = false): Promise<VoiceControls> {
    const v = createVoiceWith({ ...fake.host(), ...(listenOnly ? { listenOnly: true } : {}) }, { meter: null, presence: fake.presenceSeam() });
    open.push(v);
    await settle();
    await v.join();
    return v;
  }

  it('is off by default: a held press opens nothing', async () => {
    expect(DEFAULT_SETTINGS.talkWhileHolding).toBe(false);
    const fake = new FakeHost({ state: table('1v1') });
    const v = await voiceOver(fake);
    expect(talkWhileHolding(v)).toBe(false);
    v.pressHeld!(true);
    expect(fake.enabledTo('t1')).toBe(false);
    expect(v.indicator()).toBe('idle');
    expect(pressTalking(v)).toBe(false);
  });

  it('when on, a held press opens the mic to every player until release, with the normal talk indicator', async () => {
    const fake = new FakeHost({ state: table('ffa3'), settings: { talkWhileHolding: true } });
    const v = await voiceOver(fake);
    expect(talkWhileHolding(v)).toBe(true);
    v.pressHeld!(true);
    expect([fake.enabledTo('t1'), fake.enabledTo('t2')]).toEqual([true, true]);
    expect(v.state()).toMatchObject({ audio: 'all', reason: 'key' });
    expect(v.indicator()).toBe('live');
    expect(pressTalking(v)).toBe(true);
    v.pressHeld!(false);
    expect([fake.enabledTo('t1'), fake.enabledTo('t2')]).toEqual([false, false]);
    expect(v.indicator()).toBe('idle');
  });

  it('is independent of the talk key: releasing one leaves the other open', async () => {
    const fake = new FakeHost({ state: table('1v1'), settings: { talkWhileHolding: true } });
    const v = await voiceOver(fake);
    v.keyDown(false);
    v.pressHeld!(true);
    v.keyUp();
    expect(fake.enabledTo('t1')).toBe(true);
    v.keyDown(false);
    v.pressHeld!(false);
    expect(fake.enabledTo('t1')).toBe(true);
    v.keyUp();
    expect(fake.enabledTo('t1')).toBe(false);
  });

  it('turning the setting on stores it; turning it off mid-press closes the mic', async () => {
    const fake = new FakeHost({ state: table('1v1') });
    const v = await voiceOver(fake);
    await setTalkWhileHolding(v, true);
    expect(fake.settings.writes).toContainEqual({ name: 'talkWhileHolding', value: true });
    v.pressHeld!(true);
    expect(fake.enabledTo('t1')).toBe(true);
    await setTalkWhileHolding(v, false);
    expect(fake.enabledTo('t1')).toBe(false);
    expect(fake.settings.values.talkWhileHolding).toBe(false);
    // The press still ends cleanly.
    v.pressHeld!(false);
    expect(fake.enabledTo('t1')).toBe(false);
  });

  it('a change made before the stored value loaded wins', async () => {
    const fake = new FakeHost({ state: table('1v1'), settings: { talkWhileHolding: true } });
    const v = createVoiceWith(fake.host(), { meter: null, presence: fake.presenceSeam() });
    open.push(v);
    void setTalkWhileHolding(v, false);
    await settle();
    expect(talkWhileHolding(v)).toBe(false);
  });

  it('never while a text field has focus; a text field or a note field taking focus ends the press', async () => {
    const fake = new FakeHost({ state: table('1v1'), settings: { talkWhileHolding: true } });
    const v = await voiceOver(fake);
    v.focus({ text: true });
    v.pressHeld!(true);
    expect(fake.enabledTo('t1')).toBe(false);
    v.focus({ text: false });
    // The press that started in the field does not come back when the field lets go.
    expect(fake.enabledTo('t1')).toBe(false);
    v.pressHeld!(false);

    v.pressHeld!(true);
    expect(fake.enabledTo('t1')).toBe(true);
    v.focus({ text: true });
    expect(fake.enabledTo('t1')).toBe(false);
    v.focus({ text: false });
    expect(fake.enabledTo('t1')).toBe(false);
    v.pressHeld!(false);

    v.pressHeld!(true);
    v.focus({ note: true });
    expect(v.state()).toMatchObject({ audio: 'off', dictation: 'off' });
    v.focus({ note: false });
    expect(fake.enabledTo('t1')).toBe(false);
  });

  it('window blur ends it like the talk key', async () => {
    const fake = new FakeHost({ state: table('1v1'), settings: { talkWhileHolding: true } });
    const v = await voiceOver(fake);
    v.pressHeld!(true);
    v.focus({ window: false });
    expect(fake.enabledTo('t1')).toBe(false);
    v.focus({ window: true });
    expect(fake.enabledTo('t1')).toBe(false);
    expect(pressTalking(v)).toBe(false);
  });

  it('a spectator never talks, whatever the setting', async () => {
    const fake = new FakeHost({ state: table('1v1'), seat: null, settings: { talkWhileHolding: true } });
    const v = await voiceOver(fake, true);
    v.pressHeld!(true);
    expect(v.state().audio).toBe('off');
    expect(v.indicator()).toBe('listening');
    expect(pressTalking(v)).toBe(false);
    expect(fake.added).toEqual([]);
  });

  it('with team talk available it still speaks to the whole table (never team talk)', async () => {
    const fake = new FakeHost({ state: table('2hg'), settings: { talkWhileHolding: true } });
    const v = await voiceOver(fake);
    v.pressHeld!(true);
    expect([fake.enabledTo('t1'), fake.enabledTo('t2'), fake.enabledTo('t3')]).toEqual([true, true, true]);
  });
});

describe('the scene press tracker', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());
  const tracker = (kind: TablePressKind = 'card') => {
    const calls: [string, TablePressKind][] = [];
    const t = new PressHoldTracker({ kind: () => kind, onChange: (phase, k) => calls.push([phase, k]) });
    return { t, calls };
  };

  it('a quick click or tap never starts', () => {
    const { t, calls } = tracker();
    t.press(1);
    vi.advanceTimersByTime(HOLD_PRESS_TALK_MS - 1);
    t.release(1);
    vi.advanceTimersByTime(1000);
    expect(calls).toEqual([]);
    // A double click is two quick presses.
    t.press(1);
    vi.advanceTimersByTime(80);
    t.release(1);
    t.press(1);
    vi.advanceTimersByTime(80);
    t.release(1);
    vi.advanceTimersByTime(1000);
    expect(calls).toEqual([]);
  });

  it('a press held 200 ms starts once with its kind and ends on release', () => {
    const { t, calls } = tracker('line');
    t.press(1);
    vi.advanceTimersByTime(HOLD_PRESS_TALK_MS);
    expect(calls).toEqual([['start', 'line']]);
    expect(t.held()).toBe(true);
    vi.advanceTimersByTime(5000);
    expect(calls).toHaveLength(1);
    t.release(1);
    expect(calls).toEqual([
      ['start', 'line'],
      ['end', 'line'],
    ]);
    expect(t.held()).toBe(false);
  });

  it('two fingers are one press: it ends when the last one lifts; a release of an unknown pointer changes nothing', () => {
    const { t, calls } = tracker('camera');
    t.press(1);
    vi.advanceTimersByTime(100);
    t.press(2);
    vi.advanceTimersByTime(100);
    expect(calls).toEqual([['start', 'camera']]);
    t.release(7);
    t.release(1);
    expect(calls).toHaveLength(1);
    t.release(2);
    expect(calls.at(-1)).toEqual(['end', 'camera']);
  });

  it('a second finger landing late does not restart the clock, and a first finger lifting early does not end a two-finger hold', () => {
    const { t, calls } = tracker('camera');
    t.press(1);
    vi.advanceTimersByTime(150);
    t.press(2);
    t.release(1);
    vi.advanceTimersByTime(50);
    expect(calls).toEqual([['start', 'camera']]);
    t.release(2);
    expect(calls).toHaveLength(2);
  });

  it('blur or a hidden page ends a held press; before the hold time it starts nothing', () => {
    const { t, calls } = tracker();
    t.press(1);
    vi.advanceTimersByTime(HOLD_PRESS_TALK_MS);
    t.releaseAll();
    expect(calls).toEqual([
      ['start', 'card'],
      ['end', 'card'],
    ]);
    t.press(1);
    vi.advanceTimersByTime(50);
    t.releaseAll();
    vi.advanceTimersByTime(1000);
    expect(calls).toHaveLength(2);
    // The pointer that was let go by blur may still send its release.
    t.release(1);
    expect(calls).toHaveLength(2);
  });

  it('a scene that cannot tell what the press does still reports a held press', () => {
    const calls: string[] = [];
    const t = new PressHoldTracker({
      kind: () => {
        throw new Error('no state');
      },
      onChange: (phase, k) => calls.push(`${phase}:${k}`),
    });
    t.press(0);
    vi.advanceTimersByTime(HOLD_PRESS_TALK_MS);
    t.release(0);
    expect(calls).toEqual(['start:other', 'end:other']);
  });
});

describe('the HUD forwarder', () => {
  it('forwards held presses to the voice controller and anchors captions on the pressed card while it talks', () => {
    const held: boolean[] = [];
    const anchors: (string | null)[] = [];
    const p = new PressTalk({ voice: { pressHeld: (h) => held.push(h) }, cardAt: (x) => (x > 100 ? 'card-1' : null), onAnchor: (c) => anchors.push(c) });
    p.down(200, 50);
    p.hold('start', 'card');
    expect(p.anchorCard()).toBe('card-1');
    expect(anchors).toEqual(['card-1']);
    expect(held).toEqual([true]);
    // A finger joining the held press does not move the anchor.
    p.down(10, 10);
    expect(p.anchorCard()).toBe('card-1');
    p.hold('end', 'card');
    expect(held).toEqual([true, false]);
    expect(p.anchorCard()).toBeNull();
    expect(anchors).toEqual(['card-1', null]);
  });

  it('a camera drag, a line or a press on empty table talks without a card anchor', () => {
    const held: boolean[] = [];
    const p = new PressTalk({ voice: { pressHeld: (h) => held.push(h) }, cardAt: () => 'card-1' });
    p.down(0, 0);
    p.hold('start', 'camera');
    expect(p.anchorCard()).toBeNull();
    p.hold('end', 'camera');
    p.down(0, 0);
    p.hold('start', 'line');
    expect(p.anchorCard()).toBeNull();
    p.dispose();
    expect(held).toEqual([true, false, true, false]);
  });

  it('an end without a start, or a second start, is ignored; without voice nothing breaks', () => {
    const held: boolean[] = [];
    const p = new PressTalk({ voice: { pressHeld: (h) => held.push(h) }, cardAt: () => null });
    p.hold('end', 'card');
    p.hold('start', 'card');
    p.hold('start', 'card');
    expect(held).toEqual([true]);
    const solo = new PressTalk({ voice: null, cardAt: () => null });
    solo.hold('start', 'card');
    solo.hold('end', 'card');
    expect(solo.anchorCard()).toBeNull();
  });
});
