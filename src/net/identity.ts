/**
 * Key-pair identity on the wire (DESIGN "Players, seats and formats", Identity; "Specification: network protocol and
 * secrecy", Handshake: an ECDSA P-256 key pair created on first visit, the peer id is the first 16 hex characters of
 * the SHA-256 of the public key). The key pair itself is created and persisted by store/identity.ts; this module
 * turns it into the wire form (base64url SPKI) and signs and verifies handshake texts with Web Crypto.
 * Contracts: M1-C. Implementer: M1-P1.
 */
import { base64url } from '../core/hash';
import type { NetIdentity } from './types';

const ECDSA_IMPORT: EcKeyImportParams = { name: 'ECDSA', namedCurve: 'P-256' };
const ECDSA_SIGN: EcdsaParams = { name: 'ECDSA', hash: 'SHA-256' };

/** base64url (with or without padding) to bytes; null when it is not base64url. */
export function fromBase64url(text: string): Uint8Array<ArrayBuffer> | null {
  if (!/^[A-Za-z0-9_-]*={0,2}$/.test(text)) return null;
  const b64 = text.replace(/=+$/, '').replace(/-/g, '+').replace(/_/g, '/');
  if (b64.length % 4 === 1) return null;
  try {
    const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

function hex(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += b.toString(16).padStart(2, '0');
  return s;
}

/** The wire identity for a stored key pair (store/types.ts IdentityRecord): base64url SPKI public key and an ECDSA signer. */
export async function createNetIdentity(keyPair: CryptoKeyPair, peerId: string, nickname: string): Promise<NetIdentity> {
  const spki = new Uint8Array(await crypto.subtle.exportKey('spki', keyPair.publicKey));
  const pubKey = base64url(spki);
  const derived = await peerIdOfPubKey(pubKey);
  if (derived !== peerId) throw new Error(`peer id ${peerId} does not belong to this key pair (expected ${derived})`);
  const encoder = new TextEncoder();
  return {
    peerId,
    pubKey,
    nickname,
    async sign(text: string): Promise<string> {
      const sig = await crypto.subtle.sign(ECDSA_SIGN, keyPair.privateKey, encoder.encode(text));
      return base64url(new Uint8Array(sig));
    },
  };
}

/** Whether `sig` is a valid signature of `text` by the base64url SPKI public key `pubKey`; false (never a throw) for malformed input. */
export async function verifySignature(pubKey: string, text: string, sig: string): Promise<boolean> {
  const spki = fromBase64url(pubKey);
  const signature = fromBase64url(sig);
  if (!spki || !signature || spki.length === 0 || signature.length === 0) return false;
  try {
    const key = await crypto.subtle.importKey('spki', spki, ECDSA_IMPORT, false, ['verify']);
    return await crypto.subtle.verify(ECDSA_SIGN, key, signature, new TextEncoder().encode(text));
  } catch {
    return false;
  }
}

/** First 16 hex characters of SHA-256 of the SPKI public key, as `hello.peerId` must be; '' for a key that is not base64url. */
export async function peerIdOfPubKey(pubKey: string): Promise<string> {
  const spki = fromBase64url(pubKey);
  if (!spki || spki.length === 0) return '';
  const digest = await crypto.subtle.digest('SHA-256', spki);
  return hex(new Uint8Array(digest)).slice(0, 16);
}
