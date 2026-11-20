/**
 * Plain notices after a fork was repaired (persistence.md section 6, "When two branches both advanced"; contracts.md
 * Part G "Rejoin" item 2). The engine reports `onAdopt {forkSeq, abandonedOwn, from}` when this copy gave up part of
 * its history for a copy with more moves; the session shows one notice when something this player did was replayed
 * on top, and none when only the sequencer's own records were dropped. Pure. Implementer: M8-P5.
 *
 * The per-action counts of the design's longer wording (`7 of your actions were played again on top; 2 no longer
 * applied.`) are later: tonight's line is the one the review fixed.
 */

/** What the engine reports when this copy adopted another history. */
export interface AdoptEvent {
  /** The last seq both copies shared. */
  forkSeq: number;
  /** How many of this browser's own actions of the abandoned part are proposed again. */
  abandonedOwn: number;
  /** The peer whose copy won. */
  from: string;
}

/** The notice after an adopt (contracts.md Part G "Rejoin" item 2). */
export const ADOPT_NOTICE = "The table with more moves is kept; the other side's moves are played again on top where they still fit.";

/** The notice for `e`, or null when nothing this player did was replayed (only sequencer records were dropped). */
export function adoptNotice(e: AdoptEvent): string | null {
  return e.abandonedOwn > 0 ? ADOPT_NOTICE : null;
}

/** The notice when a player left on purpose (persistence.md section 5). */
export function leftNotice(name: string): string {
  const who = name.trim() || 'A player';
  return `${who} left. The game goes on; ${who} can come back.`;
}
