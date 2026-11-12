/**
 * Where a caption hangs (DESIGN "Chat and voice", Placement: "anchored to the card or stack item the speaker last acted
 * on or is hovering … With no card context it appears beside the speaker's avatar"; DECISIONS [M3-C]: a spectator's
 * caption without an anchor sits at the table's near edge), the scene's caption mapping, and the talk mode that opens
 * dictation without voice controls (DESIGN "Chat and voice", Talk modes).
 */
import { describe, expect, it } from 'vitest';
import type { TableState } from '../../../src/core/types';
import { mtgLayout } from '../../../src/games/mtg/layout';
import { captionPoint, textOn } from '../../../src/scene/captions';
import { stackPose } from '../../../src/scene/layout';
import { settingsDictation, talkSource } from '../../../src/session/captions';
import { DEFAULT_TALK } from '../../../src/store/types';
import { TALK_CLOSED, type TalkState, type VoiceControls } from '../../../src/voice/types';
import { memorySettings } from './helpers';
import { sceneCaptions } from '../../../src/ui/settings/captions';
import { P, act, ok, play, readyTable } from '../core/helpers';

const layout = mtgLayout('1v1');

function board() {
  let s = readyTable(10);
  s = play(s, 'a00', P(-120, -260));
  s = play(s, 'b00', P(80, 240, 180), 's1');
  s = ok(s, act('move', { card: 'b00', to: 'graveyard:s1' }, 's1'));
  s = play(s, 'a01', P(0, -300));
  s = ok(s, act('stackPush', { item: 'i1', kind: 'spell', card: 'a01' }));
  s = ok(s, act('stackPush', { item: 'i2', kind: 'ability', source: 'a00' }));
  return s;
}

describe('captionPoint', () => {
  const s = board();
  const avatar = (i: number) => ({ x: layout.seats[i]!.zones.avatar.x, y: layout.seats[i]!.zones.avatar.y });

  it('hangs from a card on the battlefield at its pose', () => {
    expect(captionPoint(s, layout, { anchor: { kind: 'card', id: 'a00' }, seat: 's0' })).toEqual({ point: { x: -120, y: -260 }, anchoredTo: { kind: 'card', id: 'a00' } });
  });

  it('hangs from a card in a public pile at the pile, and from a spell or ability at its stack slot', () => {
    const gy = layout.seats[1]!.zones.graveyard;
    expect(captionPoint(s, layout, { anchor: { kind: 'card', id: 'b00' }, seat: 's0' })?.point).toEqual({ x: gy.x, y: gy.y });
    const slot0 = stackPose(layout.stackLane, 0, 0);
    const slot1 = stackPose(layout.stackLane, 1, 0);
    expect(captionPoint(s, layout, { anchor: { kind: 'card', id: 'a01' }, seat: 's0' }, { viewer: 's0' })?.point).toEqual({ x: slot0.x, y: slot0.y });
    expect(captionPoint(s, layout, { anchor: { kind: 'stackItem', id: 'i2' }, seat: 's0' }, { viewer: 's0' })).toEqual({ point: { x: slot1.x, y: slot1.y }, anchoredTo: { kind: 'stackItem', id: 'i2' } });
  });

  it('prefers where the scene draws the anchor right now', () => {
    expect(captionPoint(s, layout, { anchor: { kind: 'card', id: 'a00' }, seat: 's0' }, { drawn: () => ({ x: 1, y: 2 }) })?.point).toEqual({ x: 1, y: 2 });
  });

  it('with no card context, or an anchor gone or hidden, sits beside the speaker’s avatar', () => {
    expect(captionPoint(s, layout, { anchor: null, seat: 's1' })).toEqual({ point: avatar(1), anchoredTo: { kind: 'seat', id: 's1' } });
    expect(captionPoint(s, layout, { anchor: { kind: 'card', id: 'gone' }, seat: 's0' })).toEqual({ point: avatar(0), anchoredTo: { kind: 'seat', id: 's0' } });
    expect(captionPoint(s, layout, { anchor: { kind: 'card', id: 'a05' }, seat: 's0' })?.anchoredTo).toEqual({ kind: 'seat', id: 's0' });
    expect(captionPoint(s, layout, { anchor: { kind: 'stackItem', id: 'resolved' }, seat: 's0' })?.anchoredTo).toEqual({ kind: 'seat', id: 's0' });
    // A drawn position never brings back a card that is not public.
    expect(captionPoint(s, layout, { anchor: { kind: 'card', id: 'a05' }, seat: 's0' }, { drawn: () => ({ x: 9, y: 9 }) })?.point).toEqual(avatar(0));
    // A seat anchor names that seat's avatar.
    expect(captionPoint(s, layout, { anchor: { kind: 'seat', id: 's1' }, seat: 's0' })?.point).toEqual(avatar(1));
  });

  it('a spectator’s caption without an anchor sits at the viewer’s near edge', () => {
    expect(captionPoint(s, layout, { anchor: null, seat: null }, { viewer: 's0' })).toEqual({ point: { x: 0, y: -layout.table.d / 2 }, anchoredTo: null });
    const far = captionPoint(s, layout, { anchor: null, seat: null }, { viewer: 's1' })!;
    expect(far.point.x).toBeCloseTo(0);
    expect(far.point.y).toBeCloseTo(layout.table.d / 2);
  });
});

describe('caption bubbles', () => {
  it('carry the speaker’s seat and seat colour; a spectator gets neither', () => {
    const s = board();
    const out = sceneCaptions(
      [
        { id: 's1:1', speaker: 's1', text: 'hi', final: false, anchor: null, at: 0 },
        { id: 'v:p:0', speaker: 'v:p', text: 'go', final: true, anchor: { kind: 'card', id: 'a00' }, at: 1 },
      ],
      s,
    );
    expect(out).toEqual([
      { id: 's1:1', text: 'hi', final: false, anchor: null, seat: 's1', colour: s.seats.s1!.colour, opacity: 1 },
      { id: 'v:p:0', text: 'go', final: true, anchor: { kind: 'card', id: 'a00' }, seat: null, colour: null, opacity: 1 },
    ]);
  });

  it('text on the seat colour is black or white, whichever has more contrast', () => {
    expect(textOn('#ffffff')).toBe('#000');
    expect(textOn('#111')).toBe('#fff');
    expect(textOn('#f2c200')).toBe('#000');
    expect(textOn('#1f4fd1')).toBe('#fff');
  });
});

describe('dictation from the stored talk mode, without voice controls', () => {
  const s = readyTable(4);
  it('opens with an open gate, and with the turn gate during the own turn only', () => {
    expect(settingsDictation(DEFAULT_TALK, s, 's0').dictation).toBe('off');
    expect(settingsDictation({ ...DEFAULT_TALK, dictation: true, gate: 'open' }, s, 's0').dictation).toBe('caption');
    expect(settingsDictation({ ...DEFAULT_TALK, dictation: true, gate: 'open', muted: true }, s, 's0').dictation).toBe('off');
    expect(settingsDictation({ ...DEFAULT_TALK, dictation: true, gate: 'ptt' }, s, 's0').dictation).toBe('off');
    const active = s.turn.active;
    const other = active === 's0' ? 's1' : 's0';
    expect(settingsDictation({ ...DEFAULT_TALK, dictation: true, gate: 'turn' }, s, active).dictation).toBe('caption');
    expect(settingsDictation({ ...DEFAULT_TALK, dictation: true, gate: 'turn' }, s, other).dictation).toBe('off');
    // Never audio: that is the voice controls' part.
    expect(settingsDictation({ ...DEFAULT_TALK, dictation: true, gate: 'open' }, s, 's0').audio).toBe('off');
  });
});

describe('the talk source dictation follows', () => {
  interface FakeSession {
    seat: string;
    state: TableState;
    voice: Pick<VoiceControls, 'state' | 'subscribe'> | undefined;
    getState(): TableState;
    subscribe(l: () => void): () => void;
    tick(next?: TableState): void;
  }
  function fakeSession(state = readyTable(4)): FakeSession {
    const listeners = new Set<() => void>();
    const session: FakeSession = {
      seat: 's0',
      state,
      voice: undefined,
      getState: () => session.state,
      subscribe(l: () => void) {
        listeners.add(l);
        return () => void listeners.delete(l);
      },
      tick(next = session.state) {
        session.state = next;
        for (const l of [...listeners]) l();
      },
    };
    return session;
  }
  function fakeVoice(initial: TalkState) {
    const listeners = new Set<(s: TalkState) => void>();
    let current = initial;
    return {
      state: () => current,
      subscribe(l: (s: TalkState) => void) {
        listeners.add(l);
        return () => listeners.delete(l);
      },
      set(s: TalkState) {
        current = s;
        for (const l of [...listeners]) l(s);
      },
    };
  }
  const settle = async (): Promise<void> => {
    for (let i = 0; i < 5; i++) await Promise.resolve();
  };
  const KEY: TalkState = { audio: 'off', dictation: 'caption', reason: 'key', muted: false };

  it('adopts voice controls mounted after the captions, and from then on follows only them', async () => {
    const session = fakeSession();
    const settings = memorySettings({ talk: { ...DEFAULT_TALK, dictation: true, gate: 'open' } });
    const talk = talkSource(session as never, settings);
    const seen: string[] = [];
    talk.subscribe((s) => seen.push(s.dictation));
    await settle();
    expect(talk.state().dictation).toBe('caption');
    const voice = fakeVoice(TALK_CLOSED);
    session.voice = voice;
    // Picked up with the next state change.
    session.tick();
    expect(talk.state().dictation).toBe('off');
    expect(seen).toEqual(['caption', 'off']);
    voice.set(KEY);
    expect(seen.at(-1)).toBe('caption');
    // The stored mode no longer matters.
    settings.data.talk = { ...DEFAULT_TALK };
    session.tick();
    await settle();
    expect(talk.state().dictation).toBe('caption');
    talk.dispose();
    voice.set(TALK_CLOSED);
    expect(seen.at(-1)).toBe('caption');
  });

  it('adopts voice controls mounted right after the captions, before anything happened at the table', async () => {
    const session = fakeSession();
    const talk = talkSource(session as never, memorySettings({ talk: { ...DEFAULT_TALK, dictation: true, gate: 'open' } }));
    session.voice = fakeVoice(KEY);
    await settle();
    expect(talk.state()).toEqual(KEY);
    talk.dispose();
  });

  it('without voice controls, a changed talk setting takes effect when the turn passes', async () => {
    const s = readyTable(4);
    const session = fakeSession(s);
    const settings = memorySettings({ talk: { ...DEFAULT_TALK } });
    const talk = talkSource(session as never, settings);
    await settle();
    expect(talk.state().dictation).toBe('off');
    settings.data.talk = { ...DEFAULT_TALK, dictation: true, gate: 'open' };
    const other = s.turn.active === 's0' ? 's1' : 's0';
    session.tick(ok(s, act('turnPass', { to: other }, s.turn.active as string)));
    await settle();
    expect(talk.state().dictation).toBe('caption');
    talk.dispose();
  });
});
