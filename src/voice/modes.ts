/**
 * Talk modes as a pure rule (DESIGN "Chat and voice", Talk modes: push-to-talk, turn mic, open mic with mute, dictation;
 * Team channel: Shift plus the talk key to the teammate only; "The talk key is released on window blur and ignored while
 * a text field has focus"). Contracts: M3-C (stub); implementer: M3-P3.
 */
import type { TalkIndicatorState, TalkState, TalkStateFn } from './types';

/** The talk state for the given inputs (voice/types.ts TalkInputs). Implementer: M3-P3. */
export const talkState: TalkStateFn = () => {
  throw new Error('not implemented: M3-P3');
};

/** The talk-mode indicator for a talk state (voice/types.ts TalkIndicatorState). Implementer: M3-P3. */
export function talkIndicator(_state: TalkState, _micReady: boolean): TalkIndicatorState {
  throw new Error('not implemented: M3-P3');
}
