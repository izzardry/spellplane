/**
 * M0-P5 acceptance: the identity persists and the peer id is stable (DESIGN "Players, seats and formats", Identity;
 * "Specification: network protocol and secrecy": ECDSA P-256 key pair created on first visit, peer id = first 16 hex
 * characters of SHA-256 of the public key; "Local persistence": identity store, key 'me').
 */
import { afterEach, describe, expect, it } from 'vitest';
import { openDb } from '../../../src/store/db';
import { createIdentityStore, MAX_NICKNAME_LENGTH, SEAT_COLOUR_COUNT } from '../../../src/store/identity';
import { openStores, type LocalStores } from '../../../src/store/stores';
import { uniqueDbName } from './helpers';

const open: LocalStores[] = [];
async function stores(name = uniqueDbName('identity')): Promise<LocalStores> {
  const s = await openStores(name);
  open.push(s);
  return s;
}
afterEach(() => {
  for (const s of open.splice(0)) s.close();
});

/** The design's definition, computed independently of the implementation. */
async function expectedPeerId(publicKey: CryptoKey): Promise<string> {
  const spki = await crypto.subtle.exportKey('spki', publicKey);
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', spki));
  return [...digest].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 16);
}

const data = new TextEncoder().encode('hello 0123456789abcdef');
const ECDSA_SHA256 = { name: 'ECDSA', hash: 'SHA-256' } as const;

describe('identity', () => {
  it('creates an ECDSA P-256 key pair on first visit with a non-extractable private key', async () => {
    const s = await stores();
    expect(await s.db.get('identity', 'me')).toBeUndefined();
    const me = await s.identity.get();
    expect(me.id).toBe('me');
    expect(me.keyPair.privateKey.type).toBe('private');
    expect(me.keyPair.privateKey.extractable).toBe(false);
    expect(me.keyPair.privateKey.algorithm).toMatchObject({ name: 'ECDSA', namedCurve: 'P-256' });
    expect(me.keyPair.publicKey.algorithm).toMatchObject({ name: 'ECDSA', namedCurve: 'P-256' });
    await expect(crypto.subtle.exportKey('pkcs8', me.keyPair.privateKey)).rejects.toThrow();
    await expect(crypto.subtle.exportKey('jwk', me.keyPair.privateKey)).rejects.toThrow();
    expect(await s.db.get('identity', 'me')).toBeDefined();
  });

  it('stores the key pair as JWK data, never as CryptoKey objects (WebKit would need the macOS keychain)', async () => {
    const s = await stores();
    const me = await s.identity.get();
    const stored = (await s.db.get('identity', 'me'))!;
    expect(stored.keyPair).toBeUndefined();
    expect(stored.privateJwk).toMatchObject({ kty: 'EC', crv: 'P-256' });
    expect(stored.publicJwk).toMatchObject({ kty: 'EC', crv: 'P-256' });
    expect(JSON.parse(JSON.stringify(stored))).toEqual(stored);
    expect(stored.peerId).toBe(me.peerId);
  });

  it('still reads a record written by an earlier build (CryptoKey key pair)', async () => {
    const s = await stores();
    const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign', 'verify']);
    const peerId = await expectedPeerId(pair.publicKey);
    await s.db.put('identity', { id: 'me', keyPair: pair, peerId, nickname: 'old', seatColour: 3 });
    const me = await s.identity.get();
    expect(me.peerId).toBe(peerId);
    expect(me.nickname).toBe('old');
    const sig = await crypto.subtle.sign(ECDSA_SHA256, me.keyPair.privateKey, data);
    expect(await crypto.subtle.verify(ECDSA_SHA256, pair.publicKey, sig, data)).toBe(true);
  });

  it('derives the peer id as the first 16 hex characters of SHA-256 of the public key', async () => {
    const s = await stores();
    const me = await s.identity.get();
    expect(me.peerId).toMatch(/^[0-9a-f]{16}$/);
    expect(me.peerId).toBe(await expectedPeerId(me.keyPair.publicKey));
  });

  it('persists: a reopened database yields the same peer id and a private key that still signs', async () => {
    const name = uniqueDbName('identity');
    const first = await stores(name);
    const me = await first.identity.get();
    first.close();

    const again = await (await stores(name)).identity.get();
    expect(again.peerId).toBe(me.peerId);
    expect(again.peerId).toBe(await expectedPeerId(again.keyPair.publicKey));
    expect(again.keyPair.privateKey.extractable).toBe(false);
    // The stored private key signs; the original public key verifies, so it is the same key pair.
    const sig = await crypto.subtle.sign(ECDSA_SHA256, again.keyPair.privateKey, data);
    expect(await crypto.subtle.verify(ECDSA_SHA256, me.keyPair.publicKey, sig, data)).toBe(true);
  });

  it('is stable across repeated calls', async () => {
    const s = await stores();
    const ids = new Set<string>();
    for (let i = 0; i < 5; i++) ids.add((await s.identity.get()).peerId);
    expect(ids.size).toBe(1);
  });

  it('creates exactly one identity when first-visit calls race (one store, and two connections like two tabs)', async () => {
    const name = uniqueDbName('identity');
    const db1 = await openDb(name);
    const db2 = await openDb(name);
    try {
      const a = createIdentityStore(db1);
      const b = createIdentityStore(db2);
      const results = await Promise.all([a.get(), a.get(), b.get(), b.get()]);
      expect(new Set(results.map((r) => r.peerId)).size).toBe(1);
      expect((await db1.get('identity', 'me'))!.peerId).toBe(results[0]!.peerId);
      expect(await db1.count('identity')).toBe(1);
    } finally {
      db1.close();
      db2.close();
    }
  });

  it('gives different browsers (databases) different peer ids', async () => {
    const a = await (await stores()).identity.get();
    const b = await (await stores()).identity.get();
    expect(a.peerId).not.toBe(b.peerId);
  });

  it('stores the nickname and preferred seat colour without touching the key pair', async () => {
    const name = uniqueDbName('identity');
    const s = await stores(name);
    const me = await s.identity.get();
    expect(me.nickname).toBe('');
    expect(Number.isInteger(me.seatColour) && me.seatColour >= 0 && me.seatColour < SEAT_COLOUR_COUNT).toBe(true);

    await s.identity.setNickname('  Ada   Lovelace ');
    await s.identity.setSeatColour(5);
    s.close();

    const again = await (await stores(name)).identity.get();
    expect(again.nickname).toBe('Ada Lovelace');
    expect(again.seatColour).toBe(5);
    expect(again.peerId).toBe(me.peerId);
    const sig = await crypto.subtle.sign(ECDSA_SHA256, again.keyPair.privateKey, data);
    expect(await crypto.subtle.verify(ECDSA_SHA256, me.keyPair.publicKey, sig, data)).toBe(true);
  });

  it('can set the nickname before the identity was ever read (creates it first)', async () => {
    const s = await stores();
    await s.identity.setNickname('Bo');
    const me = await s.identity.get();
    expect(me.nickname).toBe('Bo');
    expect(me.peerId).toBe(await expectedPeerId(me.keyPair.publicKey));
  });

  it('caps the nickname length', async () => {
    const s = await stores();
    await s.identity.setNickname('x'.repeat(100));
    expect((await s.identity.get()).nickname).toHaveLength(MAX_NICKNAME_LENGTH);
  });

  it('rejects a seat colour outside the eight seat colours', async () => {
    const s = await stores();
    await s.identity.setSeatColour(2);
    for (const bad of [-1, SEAT_COLOUR_COUNT, 1.5, Number.NaN]) await expect(s.identity.setSeatColour(bad)).rejects.toThrow(RangeError);
    expect((await s.identity.get()).seatColour).toBe(2);
  });
});
