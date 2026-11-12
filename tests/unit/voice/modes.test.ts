/**
 * PLAN M3-P3: the talk rule as a pure function (DESIGN "Chat and voice", Talk modes table: push-to-talk while the key
 * is held, turn mic for the whole own turn and push-to-talk outside it, open mic always with a mute toggle, dictation
 * with the key or the turn mic; Live voice: "The talk key is released on window blur and ignored while a text field has
 * focus"; Team channel: Shift plus the talk key sends audio only to the teammate; Notes by voice).
 */
import { describe, expect, it } from 'vitest';
import { talkIndicator, talkState } from '../../../src/voice/modes';
import { DEFAULT_TALK } from '../../../src/store/types';
import { TALK_CLOSED, type TalkInputs, type TalkSettings } from '../../../src/voice/types';

const base: TalkInputs = {
  settings: DEFAULT_TALK,
  keyHeld: false,
  teamKey: false,
  ownTurn: false,
  hasTeammate: false,
  textFocus: false,
  noteFocus: false,
  windowFocus: true,
  micReady: true,
};
const inputs = (patch: Partial<TalkInputs> = {}, settings: Partial<TalkSettings> = {}): TalkInputs => ({ ...base, ...patch, settings: { ...DEFAULT_TALK, ...settings } });

describe('push-to-talk (the default)', () => {
  it('opens audio to everyone exactly while the talk key is held', () => {
    expect(talkState(inputs())).toEqual(TALK_CLOSED);
    expect(talkState(inputs({ keyHeld: true }))).toEqual({ audio: 'all', dictation: 'off', reason: 'key', muted: false });
  });

  it('ignores the key while a text field has focus and when the window has none', () => {
    expect(talkState(inputs({ keyHeld: true, textFocus: true })).audio).toBe('off');
    expect(talkState(inputs({ keyHeld: true, windowFocus: false })).audio).toBe('off');
  });

  it('opens no audio before the microphone was acquired', () => {
    expect(talkState(inputs({ keyHeld: true, micReady: false }))).toEqual(TALK_CLOSED);
  });

  it('is push-to-talk outside the own turn in every gate but the open mic', () => {
    for (const gate of ['ptt', 'turn'] as const) expect(talkState(inputs({ ownTurn: false }, { gate })).audio).toBe('off');
    // The own turn alone opens nothing under push-to-talk.
    expect(talkState(inputs({ ownTurn: true }, { gate: 'ptt' })).audio).toBe('off');
  });
});

describe('turn mic', () => {
  it('opens audio for the whole own turn and closes outside it', () => {
    expect(talkState(inputs({ ownTurn: true }, { gate: 'turn' }))).toEqual({ audio: 'all', dictation: 'off', reason: 'turn', muted: false });
    expect(talkState(inputs({ ownTurn: false }, { gate: 'turn' }))).toEqual(TALK_CLOSED);
  });

  it('falls back to push-to-talk outside the own turn', () => {
    expect(talkState(inputs({ ownTurn: false, keyHeld: true }, { gate: 'turn' }))).toMatchObject({ audio: 'all', reason: 'key' });
  });

  it('keeps the own turn open through window blur and text focus (no key is involved)', () => {
    expect(talkState(inputs({ ownTurn: true, windowFocus: false, textFocus: true }, { gate: 'turn' })).audio).toBe('all');
  });

  it('dictates for the whole own turn when combined with dictation', () => {
    expect(talkState(inputs({ ownTurn: true }, { gate: 'turn', dictation: true }))).toEqual({ audio: 'all', dictation: 'caption', reason: 'turn', muted: false });
    expect(talkState(inputs({ ownTurn: true }, { gate: 'turn', voice: false, dictation: true }))).toEqual({ audio: 'off', dictation: 'caption', reason: 'turn', muted: false });
  });
});

describe('open mic and mute', () => {
  it('is always open, also without focus', () => {
    expect(talkState(inputs({}, { gate: 'open' }))).toEqual({ audio: 'all', dictation: 'off', reason: 'open', muted: false });
    expect(talkState(inputs({ windowFocus: false }, { gate: 'open' })).audio).toBe('all');
  });

  it('mute closes every gate: open mic, turn mic and the held key', () => {
    const muted = { muted: true } as const;
    for (const s of [{ gate: 'open' as const }, { gate: 'turn' as const }, { gate: 'ptt' as const }]) {
      expect(talkState(inputs({ keyHeld: true, ownTurn: true, hasTeammate: true }, { ...s, ...muted, dictation: true }))).toEqual({ ...TALK_CLOSED, muted: true });
    }
  });

  it('dictation follows the key, not the open mic', () => {
    expect(talkState(inputs({}, { gate: 'open', dictation: true })).dictation).toBe('off');
    expect(talkState(inputs({ keyHeld: true }, { gate: 'open', dictation: true })).dictation).toBe('caption');
  });
});

describe('team talk (Shift plus the talk key)', () => {
  it('sends audio to the teammate only and never captions (a caption is public)', () => {
    expect(talkState(inputs({ keyHeld: true, teamKey: true, hasTeammate: true }, { dictation: true }))).toEqual({ audio: 'team', dictation: 'off', reason: 'key', muted: false });
  });

  it('narrows an open mic or an open turn mic to the teammate while held', () => {
    expect(talkState(inputs({ keyHeld: true, teamKey: true, hasTeammate: true }, { gate: 'open' })).audio).toBe('team');
    expect(talkState(inputs({ keyHeld: true, teamKey: true, hasTeammate: true, ownTurn: true }, { gate: 'turn', dictation: true }))).toEqual({ audio: 'team', dictation: 'off', reason: 'key', muted: false });
  });

  it('without a teammate opens nothing, so words meant for a partner never reach the table', () => {
    expect(talkState(inputs({ keyHeld: true, teamKey: true, hasTeammate: false }, { dictation: true }))).toEqual(TALK_CLOSED);
    // Turn mic with captions on the own turn: the held team key never lets the public caption through, joined or not.
    const turnCaptions = { gate: 'turn', dictation: true } as const;
    for (const micReady of [true, false]) {
      for (const voice of [true, false]) {
        for (const hasTeammate of [true, false]) {
          const s = talkState(inputs({ keyHeld: true, teamKey: true, hasTeammate, ownTurn: true, micReady }, { ...turnCaptions, voice }));
          expect(s.dictation).toBe('off');
          // With a teammate, the turn mic's audio narrows to the team (or stays shut without a microphone).
          if (hasTeammate) expect(s.audio).not.toBe('all');
        }
      }
    }
    // Without the microphone (not joined, or voice off) it opens nothing at all.
    expect(talkState(inputs({ keyHeld: true, teamKey: true, hasTeammate: true, ownTurn: true, micReady: false }, turnCaptions))).toEqual(TALK_CLOSED);
    expect(talkState(inputs({ keyHeld: true, teamKey: true, hasTeammate: true, ownTurn: true }, { ...turnCaptions, voice: false }))).toEqual(TALK_CLOSED);
    // Released, the turn mic's caption is back.
    expect(talkState(inputs({ ownTurn: true, micReady: false }, turnCaptions)).dictation).toBe('caption');
    // The gate that is open anyway stays open.
    expect(talkState(inputs({ keyHeld: true, teamKey: true, hasTeammate: false }, { gate: 'open' })).audio).toBe('all');
  });

  it('is released on blur and ignored in text fields like the talk key', () => {
    expect(talkState(inputs({ keyHeld: true, teamKey: true, hasTeammate: true, windowFocus: false })).audio).toBe('off');
    expect(talkState(inputs({ keyHeld: true, teamKey: true, hasTeammate: true, textFocus: true })).audio).toBe('off');
  });
});

describe('dictation', () => {
  it('captions while the key is held, alone or together with voice', () => {
    expect(talkState(inputs({ keyHeld: true }, { voice: false, dictation: true }))).toEqual({ audio: 'off', dictation: 'caption', reason: 'key', muted: false });
    expect(talkState(inputs({ keyHeld: true }, { dictation: true }))).toEqual({ audio: 'all', dictation: 'caption', reason: 'key', muted: false });
  });

  it('needs no microphone (the engine listens itself)', () => {
    expect(talkState(inputs({ keyHeld: true, micReady: false }, { dictation: true }))).toEqual({ audio: 'off', dictation: 'caption', reason: 'key', muted: false });
  });

  it('with voice off, the key sends no audio', () => {
    expect(talkState(inputs({ keyHeld: true }, { voice: false, dictation: true })).audio).toBe('off');
    expect(talkState(inputs({ ownTurn: true }, { gate: 'open', voice: false, dictation: true })).audio).toBe('off');
  });

  it('the held key in a focused note field dictates into that field, not into a caption or the mic', () => {
    expect(talkState(inputs({ keyHeld: true, noteFocus: true }))).toEqual({ audio: 'off', dictation: 'field', reason: 'key', muted: false });
    // An open mic keeps sending meanwhile.
    expect(talkState(inputs({ keyHeld: true, noteFocus: true }, { gate: 'open' })).audio).toBe('all');
    // A note field with focus and no key: nothing.
    expect(talkState(inputs({ noteFocus: true }))).toEqual(TALK_CLOSED);
  });
});

describe('the talk-mode indicator', () => {
  it('names each state', () => {
    expect(talkIndicator(TALK_CLOSED, false)).toBe('noMic');
    expect(talkIndicator(TALK_CLOSED, true)).toBe('idle');
    expect(talkIndicator({ ...TALK_CLOSED, muted: true }, true)).toBe('muted');
    expect(talkIndicator({ ...TALK_CLOSED, muted: true }, false)).toBe('muted');
    expect(talkIndicator({ audio: 'all', dictation: 'off', reason: 'key', muted: false }, true)).toBe('live');
    expect(talkIndicator({ audio: 'all', dictation: 'caption', reason: 'key', muted: false }, true)).toBe('live');
    expect(talkIndicator({ audio: 'team', dictation: 'off', reason: 'key', muted: false }, true)).toBe('team');
    expect(talkIndicator({ audio: 'off', dictation: 'caption', reason: 'key', muted: false }, false)).toBe('dictating');
  });
});
