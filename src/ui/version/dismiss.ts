/**
 * Which version-mismatch banner the player hid (ui/version/VersionNotice.svelte). A hidden banner stays hidden for the
 * same mismatch: the same version of the same peer. A peer's `bye {reason: 'version'}` can arrive before its hello, so
 * a mismatch may first name no peer ('') and then the peer its hello names: that is still the one the player hid.
 * Another peer or another version shows the banner again.
 */
import type { VersionMismatch } from '../../net/version';

export interface HiddenMismatch {
  theirs: number;
  /** The peer of the hidden mismatch; '' while it was not known. */
  peerId: string;
}

/** The record of hiding `m`. */
export function hide(m: VersionMismatch): HiddenMismatch {
  return { theirs: m.theirs, peerId: m.peerId };
}

/** Whether `m` is the mismatch the player hid. */
export function isHidden(hidden: HiddenMismatch | null, m: VersionMismatch): boolean {
  if (hidden === null || hidden.theirs !== m.theirs) return false;
  return hidden.peerId === '' || m.peerId === '' || hidden.peerId === m.peerId;
}

/** `hidden` once `m` names the peer a mismatch hidden before its hello did not (so another peer shows again). */
export function learnPeer(hidden: HiddenMismatch | null, m: VersionMismatch | null): HiddenMismatch | null {
  if (hidden === null || m === null || hidden.peerId !== '' || m.peerId === '' || !isHidden(hidden, m)) return hidden;
  return { ...hidden, peerId: m.peerId };
}
