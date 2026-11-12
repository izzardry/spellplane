/**
 * The browser's identity (DESIGN "Players, seats and formats", Identity; "Specification: network protocol and
 * secrecy": an ECDSA P-256 key pair created on first visit, peer id = first 16 hex characters of SHA-256 of the
 * public key). The key pair is stored as JWK in the `identity` store, key 'me', and handed out with a non-extractable
 * private key (StoredIdentity in store/types.ts says why it is not stored as CryptoKey objects).
 */
import type { IDBPDatabase } from 'idb';
import type { IdentityRecord, IdentityStore, SpellplaneDB, StoredIdentity } from './types';

/** Number of seat colours every theme provides (themes/types.ts: eight seat colours). */
export const SEAT_COLOUR_COUNT = 8;

/** Longest nickname kept, in characters. */
export const MAX_NICKNAME_LENGTH = 32;

const KEY_ALGORITHM: EcKeyGenParams = { name: 'ECDSA', namedCurve: 'P-256' };

function toHex(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += b.toString(16).padStart(2, '0');
  return s;
}

/** The public key as exported for peers: SPKI (DER) bytes. */
export async function exportPublicKey(publicKey: CryptoKey): Promise<Uint8Array<ArrayBuffer>> {
  return new Uint8Array(await crypto.subtle.exportKey('spki', publicKey));
}

/** Peer id: first 16 hex characters of SHA-256 of the exported (SPKI) public key. */
export async function peerIdOf(publicKey: CryptoKey): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await exportPublicKey(publicKey));
  return toHex(new Uint8Array(digest)).slice(0, 16);
}

/** A fresh identity to store: new key pair as JWK, empty nickname, seat colour derived from the peer id. */
export async function generateIdentity(): Promise<StoredIdentity> {
  const pair = await crypto.subtle.generateKey(KEY_ALGORITHM, true, ['sign', 'verify']);
  const peerId = await peerIdOf(pair.publicKey);
  const [privateJwk, publicJwk] = await Promise.all([crypto.subtle.exportKey('jwk', pair.privateKey), crypto.subtle.exportKey('jwk', pair.publicKey)]);
  return { id: 'me', privateJwk, publicJwk, peerId, nickname: '', seatColour: parseInt(peerId.slice(0, 2), 16) % SEAT_COLOUR_COUNT };
}

/** The in-memory identity: JWK records are imported with a non-extractable private key; old CryptoKey records pass through. */
export async function toIdentityRecord(stored: StoredIdentity): Promise<IdentityRecord> {
  const { peerId, nickname, seatColour } = stored;
  if (stored.privateJwk && stored.publicJwk) {
    const [privateKey, publicKey] = await Promise.all([
      crypto.subtle.importKey('jwk', stored.privateJwk, KEY_ALGORITHM, false, ['sign']),
      crypto.subtle.importKey('jwk', stored.publicJwk, KEY_ALGORITHM, true, ['verify']),
    ]);
    return { id: 'me', keyPair: { privateKey, publicKey }, peerId, nickname, seatColour };
  }
  if (stored.keyPair) return { id: 'me', keyPair: stored.keyPair, peerId, nickname, seatColour };
  throw new Error('stored identity has no key pair');
}

/** Trimmed, whitespace-collapsed, at most MAX_NICKNAME_LENGTH characters. */
export function normalizeNickname(nickname: string): string {
  return [...nickname.trim().replace(/\s+/g, ' ')].slice(0, MAX_NICKNAME_LENGTH).join('').trim();
}

/** The IdentityStore on an open database (store/types.ts IdentityStore). */
export function createIdentityStore(db: IDBPDatabase<SpellplaneDB>): IdentityStore {
  let creating: Promise<IdentityRecord> | null = null;

  async function load(): Promise<IdentityRecord> {
    const existing = await db.get('identity', 'me');
    if (existing) return toIdentityRecord(existing);
    // Key generation is async and cannot run inside an IndexedDB transaction, so generate first and then `add`:
    // if another tab or store instance created the identity meanwhile, `add` fails and theirs wins.
    const fresh = await generateIdentity();
    try {
      await db.add('identity', fresh);
      return toIdentityRecord(fresh);
    } catch (err) {
      const winner = await db.get('identity', 'me');
      if (winner) return toIdentityRecord(winner);
      throw err;
    }
  }

  async function get(): Promise<IdentityRecord> {
    creating ??= load().finally(() => {
      creating = null;
    });
    return creating;
  }

  async function update(change: (record: StoredIdentity) => void): Promise<void> {
    await get();
    const tx = db.transaction('identity', 'readwrite');
    const record = await tx.store.get('me');
    if (!record) throw new Error('identity vanished during update');
    change(record);
    await Promise.all([tx.store.put(record), tx.done]);
  }

  return {
    get,
    async setNickname(nickname: string): Promise<void> {
      const value = normalizeNickname(nickname);
      await update((r) => {
        r.nickname = value;
      });
    },
    async setSeatColour(colour: number): Promise<void> {
      if (!Number.isInteger(colour) || colour < 0 || colour >= SEAT_COLOUR_COUNT) {
        throw new RangeError(`seat colour must be an integer 0..${SEAT_COLOUR_COUNT - 1}, got ${colour}`);
      }
      await update((r) => {
        r.seatColour = colour;
      });
    },
  };
}
