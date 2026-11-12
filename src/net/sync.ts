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
 * The copy with the highest sequence number wins; the own save wins ties, and among peers with the same highest copy
 * the one that offered first (DESIGN "Multiplayer architecture", Resume). The rule `NetEngine.deferTo` follows when it
 * picks whom to catch up from. Implementer: M1-P7.
 */
export function chooseResume(localSeq: number, offers: readonly ResumeOffer[]): ResumeChoice {
  let best: ResumeOffer | null = null;
  for (const o of offers) if (o.lastSeq > localSeq && (best === null || o.lastSeq > best.lastSeq)) best = o;
  return best ? { from: 'peer', peerId: best.peerId, haveSeq: localSeq } : { from: 'local' };
}
