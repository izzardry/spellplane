/**
 * Protocol version check (DESIGN "Specification: network protocol and secrecy": "peers with a different `v` are refused
 * with a visible version-mismatch notice"; PLAN M5-P6: "protocol version check with a clear mismatch message"; PLAN
 * Milestone 5, owner decisions, Version mismatch: "A room records its protocol version. A peer on a different protocol
 * version gets a clear message naming both versions and what to do (reload after the game, or wait for the table to
 * update), never a silent failure"). Contracts: M5-C. Implementer: M5-P6 (this file, the engine's notice, the HUD
 * banner, writing `TableRecord.protocol`).
 */

/** A version mismatch with one peer (PLAN Milestone 5, owner decisions, Version mismatch). Added by M5-C. */
export interface VersionMismatch {
  /** This page's PROTOCOL_VERSION. */
  mine: number;
  /** The peer's version from its envelope or `bye {reason: 'version'}`. */
  theirs: number;
  /** Identity peer id of the peer, '' when its hello was refused before it was read. */
  peerId: string;
  /** Its nickname, '' when unknown. */
  nickname: string;
}

/**
 * What the player should do (PLAN Milestone 5, owner decisions: "reload after the game, or wait for the table to
 * update"). 'reloadAfterGame': this page is older; reload once the game is over (a newer version is published).
 * 'waitForTable': this page is newer; the others reload after their game. Added by M5-C.
 */
export type VersionAdvice = 'reloadAfterGame' | 'waitForTable';

/** The advice for a mismatch: older page reloads, newer page waits. Implementer: M5-P6. Added by M5-C. */
export function versionAdvice(_m: VersionMismatch): VersionAdvice {
  throw new Error('not implemented: M5-P6');
}

/** The notice text, naming both versions and the advice (log line and HUD banner). Implementer: M5-P6. Added by M5-C. */
export function versionNotice(_m: VersionMismatch): string {
  throw new Error('not implemented: M5-P6');
}

/** The protocol version a stored room was played with: `TableRecord.protocol`, 1 when absent (records before M5). Added by M5-C. */
export function roomProtocol(record: { protocol?: number }): number {
  return record.protocol ?? 1;
}
