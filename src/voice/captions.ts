/**
 * Dictation and captions (DESIGN "Chat and voice", Dictation and captions: interim and final captions anchored to the
 * card or stack item the speaker last acted on or is hovering, else beside the avatar; the final transcript stored on
 * the action in the log; dictation into note fields). Contracts: M3-C (stubs); implementer: M3-P4.
 */
import type { Anchor, LogEntry, SeatId } from '../core/types';
import type { CreateCaptions } from './types';

/** Create the caption controller (voice/types.ts CaptionControls). Implementer: M3-P4. */
export const createCaptions: CreateCaptions = () => {
  throw new Error('not implemented: M3-P4');
};

/**
 * The card or stack item `seat` last acted on, with the cid of that action, or null (DESIGN "Chat and voice", Placement
 * and Record: the caption is anchored there and stored on that action). Implementer: M3-P4.
 */
export function lastTouched(_log: readonly LogEntry[], _seat: SeatId): { anchor: Anchor; about: string } | null {
  throw new Error('not implemented: M3-P4');
}
