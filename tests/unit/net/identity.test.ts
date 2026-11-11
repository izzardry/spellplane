/**
 * Key-pair identity on the wire with real Web Crypto (DESIGN "Specification: network protocol and secrecy": an ECDSA
 * P-256 key pair created on first visit; the peer id is the first 16 hex characters of the SHA-256 of the public
 * key; `welcome.sig` signs the other side's connection nonce). The key pair comes from store/identity.ts.
 */
import { describe, expect, it } from 'vitest';
import { handshakeText } from '../../../src/net/messages';
import { createNetIdentity, fromBase64url, peerIdOfPubKey, verifySignature } from '../../../src/net/identity';
import { generateIdentity } from '../../../src/store/identity';

describe('net identity', () => {
  it('exports the stored key pair as base64url SPKI whose hash is the stored peer id', async () => {
    const rec = await generateIdentity();
    const id = await createNetIdentity(rec.keyPair, rec.peerId, 'Anna');
    expect(id.peerId).toBe(rec.peerId);
    expect(id.nickname).toBe('Anna');
    expect(id.pubKey).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(await peerIdOfPubKey(id.pubKey)).toBe(rec.peerId);
    expect(rec.peerId).toMatch(/^[0-9a-f]{16}$/);
  });

  it('refuses a peer id that does not belong to the key pair', async () => {
    const rec = await generateIdentity();
    await expect(createNetIdentity(rec.keyPair, '0123456789abcdef', 'x')).rejects.toThrow(/does not belong/);
  });

  it('signs the handshake text so that only the right key and text verify', async () => {
    const a = await generateIdentity();
    const b = await generateIdentity();
    const ida = await createNetIdentity(a.keyPair, a.peerId, 'A');
    const idb = await createNetIdentity(b.keyPair, b.peerId, 'B');
    const text = handshakeText('amber-fox-93', 'nonce-1', ida.peerId);
    const sig = await ida.sign(text);
    expect(await verifySignature(ida.pubKey, text, sig)).toBe(true);
    // Another nonce, another room, another signer id, another key: all fail.
    expect(await verifySignature(ida.pubKey, handshakeText('amber-fox-93', 'nonce-2', ida.peerId), sig)).toBe(false);
    expect(await verifySignature(ida.pubKey, handshakeText('other-room-11', 'nonce-1', ida.peerId), sig)).toBe(false);
    expect(await verifySignature(ida.pubKey, handshakeText('amber-fox-93', 'nonce-1', idb.peerId), sig)).toBe(false);
    expect(await verifySignature(idb.pubKey, text, sig)).toBe(false);
    // A tampered signature fails.
    const bytes = fromBase64url(sig)!;
    bytes[5] = bytes[5]! ^ 0xff;
    const tampered = btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    expect(await verifySignature(ida.pubKey, text, tampered)).toBe(false);
  });

  it('treats malformed keys and signatures as invalid instead of throwing', async () => {
    const a = await generateIdentity();
    const id = await createNetIdentity(a.keyPair, a.peerId, 'A');
    const sig = await id.sign('x');
    expect(await verifySignature('not base64 !', 'x', sig)).toBe(false);
    expect(await verifySignature('', 'x', sig)).toBe(false);
    expect(await verifySignature('AAAA', 'x', sig)).toBe(false);
    expect(await verifySignature(id.pubKey, 'x', '')).toBe(false);
    expect(await verifySignature(id.pubKey, 'x', '***')).toBe(false);
    expect(await peerIdOfPubKey('***')).toBe('');
  });

  it('decodes base64url with and without padding', () => {
    expect([...fromBase64url('AQID')!]).toEqual([1, 2, 3]);
    expect([...fromBase64url('AQ')!]).toEqual([1]);
    expect([...fromBase64url('AQ==')!]).toEqual([1]);
    expect([...fromBase64url('-_8')!]).toEqual([251, 255]);
    expect(fromBase64url('A')).toBeNull();
    expect(fromBase64url('a+b')).toBeNull();
  });
});
