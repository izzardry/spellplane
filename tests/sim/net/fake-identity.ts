/**
 * A stand-in for net/identity.ts in the simulated-network tests. Web Crypto's ECDSA runs on Node's thread pool, so
 * its promises settle outside the fake clock and would make the message schedule (and with it the seeded fault
 * pattern) depend on real time. This fake keeps the same contract — the peer id is derived from the public key and a
 * signature verifies only for the text its key signed — with promises that settle as microtasks. The real crypto
 * is covered by tests/unit/net/identity.test.ts and tests/unit/net/handshake.test.ts.
 */
import type { NetIdentity } from '../../../src/net/types';

export function fakeNetIdentity(peerId: string, nickname = peerId): NetIdentity {
  const pubKey = `pk-${peerId}`;
  return { peerId, pubKey, nickname, sign: (text) => Promise.resolve(`sig(${pubKey}|${text})`) };
}

/** The module that replaces src/net/identity.ts (vi.mock factory). */
export const fakeIdentityModule = {
  fromBase64url: (_t: string) => null,
  createNetIdentity: (_kp: CryptoKeyPair, peerId: string, nickname: string) => Promise.resolve(fakeNetIdentity(peerId, nickname)),
  verifySignature: (pubKey: string, text: string, sig: string) => Promise.resolve(sig === `sig(${pubKey}|${text})`),
  peerIdOfPubKey: (pubKey: string) => Promise.resolve(pubKey.startsWith('pk-') ? pubKey.slice(3) : ''),
};
