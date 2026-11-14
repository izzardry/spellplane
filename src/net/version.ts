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

/**
 * The advice for a mismatch: older page reloads, newer page waits. A version this page cannot read (`theirs` below 1, a
 * malformed notice) counts as older: the other page is the one that has to change. Implementer: M5-P6. Added by M5-C.
 */
export function versionAdvice(m: VersionMismatch): VersionAdvice {
  return m.theirs > m.mine ? 'reloadAfterGame' : 'waitForTable';
}

/** How the notice names the other side. */
function who(m: VersionMismatch): string {
  return m.nickname.trim() !== '' ? m.nickname.trim() : 'Another player';
}

/** A version as the notice shows it. */
function shown(v: number): string {
  return Number.isInteger(v) && v >= 1 ? `version ${v}` : 'an unknown version';
}

/**
 * The notice text, naming both versions and the advice (log line and HUD banner). Implementer: M5-P6. Added by M5-C.
 * The two pages cannot play together until both run the same version, so the notice says so first.
 */
export function versionNotice(m: VersionMismatch): string {
  const head = `Version mismatch: ${who(m)} runs Spellplane protocol ${shown(m.theirs)}, this page runs protocol ${shown(m.mine)}, so the two cannot play at one table.`;
  if (versionAdvice(m) === 'reloadAfterGame') {
    return `${head} This page is older: reload it after the game (a newer Spellplane is published), then join again.`;
  }
  return `${head} This page is newer: wait for the table to update — ${m.nickname.trim() !== '' ? m.nickname.trim() : 'the other player'} reloads Spellplane after the game, then joins again.`;
}

/**
 * The notice for a stored room that a newer Spellplane last played (`TableRecord.protocol` above this page's version):
 * its log may hold actions this page cannot apply. Null when this page can continue the room. Added by M5-P6.
 */
export function roomVersionNotice(record: { protocol?: number }, mine: number): string | null {
  const room = roomProtocol(record);
  if (room <= mine) return null;
  return `Version mismatch: this table was last played with Spellplane protocol version ${room}, this page runs protocol version ${mine}. This page is older: reload it to get the newer Spellplane before you play on.`;
}

/** The protocol version a stored room was played with: `TableRecord.protocol`, 1 when absent (records before M5). Added by M5-C. */
export function roomProtocol(record: { protocol?: number }): number {
  return record.protocol ?? 1;
}
