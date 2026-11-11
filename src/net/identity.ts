/**
 * Key-pair identity on the wire (DESIGN "Players, seats and formats", Identity; "Specification: network protocol and
 * secrecy", Handshake). Contracts: M1-C. Implementer: M1-P1.
 */
import type { NetIdentity } from './types';

/** The wire identity for a stored key pair (store/types.ts IdentityRecord): base64url SPKI public key and an ECDSA signer. Implementer: M1-P1 (the stub throws). */
export function createNetIdentity(_keyPair: CryptoKeyPair, _peerId: string, _nickname: string): Promise<NetIdentity> {
  return Promise.reject(new Error('not implemented: M1-P1'));
}

/** Whether `sig` is a valid signature of `text` by the base64url SPKI public key `pubKey`. Implementer: M1-P1 (the stub throws). */
export function verifySignature(_pubKey: string, _text: string, _sig: string): Promise<boolean> {
  return Promise.reject(new Error('not implemented: M1-P1'));
}

/** First 16 hex characters of SHA-256 of the SPKI public key, as `hello.peerId` must be. Implementer: M1-P1 (the stub throws). */
export function peerIdOfPubKey(_pubKey: string): Promise<string> {
  return Promise.reject(new Error('not implemented: M1-P1'));
}
