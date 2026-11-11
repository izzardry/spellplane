/**
 * The hello handshake (DESIGN "Specification: network protocol and secrecy", Handshake): on connect each side sends
 * `hello {peerId, pubKey, nickname, seat, role, lastSeq, nonce}`; the other side answers `welcome {peerId, sig, ...}`
 * where `sig` signs `handshakeText(roomId, <the hello's nonce>, <signer's peerId>)`. A peer is verified once its
 * `peerId` is the hash of its `pubKey` and its welcome signature over our nonce checks out. A peer with another
 * protocol version gets `bye {reason: 'version'}`. Implementer: M1-P1.
 */
import { base64url } from '../core/hash';
import type { SeatId } from '../core/types';
import { handshakeText, PROTOCOL_VERSION, type ByeMessage, type HelloMessage, type PeerRole, type WelcomeMessage } from './messages';
import { peerIdOfPubKey, verifySignature } from './identity';
import type { NetIdentity } from './types';

/** A fresh connection nonce: 16 random bytes, base64url (DESIGN "Specification: network protocol and secrecy", Handshake). */
export function newNonce(): string {
  return base64url(crypto.getRandomValues(new Uint8Array(16)));
}

/** This browser's hello to one connection. */
export function makeHello(identity: NetIdentity, seat: SeatId | null, role: PeerRole, lastSeq: number, nonce: string): HelloMessage {
  return { v: PROTOCOL_VERSION, t: 'hello', peerId: identity.peerId, pubKey: identity.pubKey, nickname: identity.nickname, seat, role, lastSeq, nonce };
}

/** Whether the hello's peer id is the hash of its public key (DESIGN "Specification: network protocol and secrecy"). */
export async function helloMatchesKey(hello: HelloMessage): Promise<boolean> {
  return (await peerIdOfPubKey(hello.pubKey)) === hello.peerId;
}

/** The welcome answering `hello`: our signature over its nonce. */
export async function makeWelcome(identity: NetIdentity, roomId: string, hello: HelloMessage, sequencer: string | null, seq: number): Promise<WelcomeMessage> {
  const sig = await identity.sign(handshakeText(roomId, hello.nonce, identity.peerId));
  return { v: PROTOCOL_VERSION, t: 'welcome', peerId: identity.peerId, sig, sequencer, seq };
}

/** Whether `welcome` proves the key of `theirHello` over the nonce we sent (`ourNonce`). */
export async function welcomeIsValid(roomId: string, theirHello: HelloMessage, ourNonce: string, welcome: WelcomeMessage): Promise<boolean> {
  if (welcome.peerId !== theirHello.peerId) return false;
  return verifySignature(theirHello.pubKey, handshakeText(roomId, ourNonce, welcome.peerId), welcome.sig);
}

/** A `bye` (its layout is frozen across protocol versions, net/messages.ts ByeMessage). */
export function makeBye(reason: ByeMessage['reason'], detail?: string): ByeMessage {
  return { v: PROTOCOL_VERSION, t: 'bye', reason, version: PROTOCOL_VERSION, ...(detail !== undefined ? { detail } : {}) };
}

/**
 * A raw message from a peer speaking another protocol version: a hello or bye whose `v` is not ours. Returns the
 * other side's version (from `bye.version`, else `v`), or null when the message is not such a notice.
 */
export function foreignVersion(raw: unknown): number | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const m = raw as { v?: unknown; t?: unknown; version?: unknown; reason?: unknown };
  if (m.t === 'bye' && m.reason === 'version') {
    const version = typeof m.version === 'number' ? m.version : typeof m.v === 'number' ? m.v : NaN;
    if (version === PROTOCOL_VERSION) return null;
    return Number.isFinite(version) ? version : -1;
  }
  if (m.v === PROTOCOL_VERSION) return null;
  if (m.t === 'hello' || m.t === 'bye') return typeof m.v === 'number' ? m.v : typeof m.version === 'number' ? m.version : -1;
  return null;
}
