/**
 * Resume across reloads and restarts (DESIGN "Multiplayer architecture", Resume and failure handling: rejoin and catch
 * up from any connected peer; if nobody is connected, the first browser back restores from its own save; later
 * arrivals reconcile to the copy with the highest sequence number). Contracts: M1-C. Implementer: M1-P7.
 */

/** A peer's offer of its copy, from `hello.lastSeq` or `hb.seq` (DESIGN "Multiplayer architecture", Resume). */
export interface ResumeOffer {
  peerId: string;
  lastSeq: number;
}

/** Which copy to continue from (DESIGN "Multiplayer architecture", Resume). */
export type ResumeChoice = { from: 'local' } | { from: 'peer'; peerId: string; haveSeq: number };

/**
 * The copy with the highest sequence number wins; the own save wins ties (DESIGN "Multiplayer architecture", Resume).
 * Implementer: M1-P7 (the stub always keeps the local copy).
 */
export function chooseResume(_localSeq: number, _offers: readonly ResumeOffer[]): ResumeChoice {
  return { from: 'local' };
}
