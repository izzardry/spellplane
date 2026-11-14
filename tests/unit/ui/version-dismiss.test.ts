/**
 * The version-mismatch banner's Hide (PLAN M5-P6; ui/version/dismiss.ts): hidden for the same mismatch only. A peer's
 * version `bye` can arrive before its hello, so the hidden mismatch may name no peer at first; the hello that names
 * the peer afterwards must not bring the banner back, while another peer or another version does.
 */
import { describe, expect, it } from 'vitest';
import type { VersionMismatch } from '../../../src/net/version';
import { hide, isHidden, learnPeer, type HiddenMismatch } from '../../../src/ui/version/dismiss';

const m = (peerId: string, theirs = 3): VersionMismatch => ({ mine: 2, theirs, peerId, nickname: peerId ? 'Ben' : '' });

describe('version banner dismissal', () => {
  it('stays hidden for the same peer and version, and shows for another peer or version', () => {
    const h = hide(m('peer-b'));
    expect(isHidden(h, m('peer-b'))).toBe(true);
    expect(isHidden(h, m('peer-c'))).toBe(false);
    expect(isHidden(h, m('peer-b', 4))).toBe(false);
    expect(isHidden(null, m('peer-b'))).toBe(false);
  });

  it('a banner hidden before the peer’s hello stays hidden once the hello names the peer', () => {
    let h: HiddenMismatch | null = hide(m(''));
    expect(isHidden(h, m(''))).toBe(true);
    h = learnPeer(h, m('peer-b'));
    expect(isHidden(h, m('peer-b'))).toBe(true);
    // From then on it is that peer's mismatch: another peer of the same version shows the banner again.
    expect(isHidden(h, m('peer-c'))).toBe(false);
  });

  it('learns nothing from another version or no mismatch', () => {
    const h = hide(m(''));
    expect(learnPeer(h, m('peer-b', 4))).toEqual(h);
    expect(learnPeer(h, null)).toEqual(h);
    expect(learnPeer(null, m('peer-b'))).toBeNull();
  });
});
