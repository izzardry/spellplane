/**
 * Talk modes as a pure rule (DESIGN "Chat and voice", Talk modes: push-to-talk, turn mic, open mic with mute, dictation;
 * Team channel: Shift plus the talk key to the teammate only; "The talk key is released on window blur and ignored while
 * a text field has focus"). Contracts: M3-C (stub); implementer: M3-P3.
 *
 * The rule, in order (DECISIONS [M3-P3]):
 * 1. Muted closes every gate.
 * 2. The talk key counts only while it is held, the window has focus and no text field has focus (a focused note field
 *    takes the held key for dictation into that field; DESIGN "Notes by voice").
 * 3. The held team key (Shift plus the talk key) sends audio to the teammate only, even while the turn mic or the open
 *    mic is open to everyone, and never captions (a caption is public). Without a teammate it opens nothing, so words
 *    meant for a partner never reach the table.
 * 4. The held talk key opens audio to everyone (voice on) and captions (dictation on).
 * 5. Otherwise the gate decides: the open mic sends audio always; the turn mic sends audio and captions for the whole
 *    own turn (the team's turn in Two-Headed Giant). Dictation follows the key or the turn mic only (DESIGN table:
 *    "While the talk key is held, or for the whole own turn when combined with Turn mic").
 * Audio never opens before the microphone was acquired.
 */
import { TALK_CLOSED, type TalkIndicatorState, type TalkInputs, type TalkState, type TalkStateFn } from './types';

/** The talk state for the given inputs (voice/types.ts TalkInputs). Implementer: M3-P3. */
export const talkState: TalkStateFn = (i: TalkInputs): TalkState => {
  const s = i.settings;
  if (s.muted) return { ...TALK_CLOSED, muted: true };
  const canAudio = s.voice && i.micReady;
  const keyLive = i.keyHeld && i.windowFocus && !i.textFocus;

  // The gate without the key: open mic always, turn mic for the own turn.
  const gateAudio = canAudio && (s.gate === 'open' || (s.gate === 'turn' && i.ownTurn));
  const gateReason: TalkState['reason'] = s.gate === 'open' ? 'open' : s.gate === 'turn' && i.ownTurn ? 'turn' : null;
  const gateCaption = s.dictation && s.gate === 'turn' && i.ownTurn;

  if (keyLive && i.noteFocus) {
    // The key dictates into the focused note field; the open or turn mic keeps sending audio meanwhile.
    return { audio: gateAudio ? 'all' : 'off', dictation: 'field', reason: 'key', muted: false };
  }
  if (keyLive && i.teamKey) {
    if (!i.hasTeammate || !canAudio) return close(gateAudio, gateCaption, gateReason);
    return { audio: 'team', dictation: 'off', reason: 'key', muted: false };
  }
  if (keyLive) {
    const audio = canAudio ? 'all' : 'off';
    const dictation = s.dictation ? 'caption' : 'off';
    if (audio === 'off' && dictation === 'off') return close(gateAudio, gateCaption, gateReason);
    return { audio, dictation, reason: 'key', muted: false };
  }
  return close(gateAudio, gateCaption, gateReason);
};

/** The state the gate alone gives (no key). */
function close(audio: boolean, caption: boolean, reason: TalkState['reason']): TalkState {
  if (!audio && !caption) return TALK_CLOSED;
  return { audio: audio ? 'all' : 'off', dictation: caption ? 'caption' : 'off', reason, muted: false };
}

/**
 * The talk-mode indicator for a talk state (voice/types.ts TalkIndicatorState): muted first, then what goes out (live
 * audio, team audio, captions only), then 'noMic' before the microphone was acquired, else 'idle'.
 */
export function talkIndicator(state: TalkState, micReady: boolean): TalkIndicatorState {
  if (state.muted) return 'muted';
  if (state.audio === 'all') return 'live';
  if (state.audio === 'team') return 'team';
  if (state.dictation !== 'off') return 'dictating';
  return micReady ? 'idle' : 'noMic';
}

/** Whether two talk states are the same. */
export function sameTalk(a: TalkState, b: TalkState): boolean {
  return a.audio === b.audio && a.dictation === b.dictation && a.reason === b.reason && a.muted === b.muted;
}
