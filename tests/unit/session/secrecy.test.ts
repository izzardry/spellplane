/**
 * The secrecy primitives the session runs (DESIGN "Specification: network protocol and secrecy": Commitments, Secret
 * shuffle steps 3-5). The synchronous SHA-256 must match Web Crypto exactly, the shuffle must be a deterministic
 * permutation of the sorted ids, and the swap partners must be unbiased.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { base64url, sha256 } from '../../../src/core/hash';
import { ByteStream, commitFor, orderHash, sha256Sync, shuffledOrder, shuffleSeed } from '../../../src/session/index';

async function webSha(text: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
}

describe('sha256Sync', () => {
  it('matches the FIPS 180-4 test vectors', () => {
    const hex = (t: string) =>
      Buffer.from(sha256Sync(t).replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('hex');
    expect(hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(hex('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq')).toBe('248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1');
  });

  it('equals Web Crypto for any text, including multi-byte characters and block boundaries', async () => {
    await fc.assert(
      fc.asyncProperty(fc.string({ unit: 'binary', maxLength: 300 }), async (t) => {
        expect(sha256Sync(t)).toBe(base64url(await webSha(t)));
      }),
      { numRuns: 300 },
    );
    for (let n = 50; n < 140; n++) {
      const t = 'x'.repeat(n);
      expect(sha256Sync(t)).toBe(await sha256(t));
    }
  });
});

describe('commitments', () => {
  it('commit = base64url(SHA-256(instanceId|sid|f-or-n|salt))', async () => {
    expect(commitFor('c1', { sid: 'abc' }, 'salt')).toBe(await sha256('c1|abc|n|salt'));
    expect(commitFor('c1', { sid: 'abc', foil: true }, 'salt')).toBe(await sha256('c1|abc|f|salt'));
  });
});

describe('secret shuffle', () => {
  const ids = Array.from({ length: 60 }, (_, i) => `c${String(i).padStart(2, '0')}`);

  it('is a deterministic permutation of the lexicographically sorted ids', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1, maxLength: 30 }), fc.shuffledSubarray(ids, { minLength: 0 }), (nonce, sub) => {
        const seed = shuffleSeed(nonce, []);
        const a = shuffledOrder(sub, seed);
        expect([...a].sort()).toEqual([...sub].sort());
        // The input order does not matter: the ids are sorted first.
        expect(shuffledOrder([...sub].reverse(), seed)).toEqual(a);
      }),
      { numRuns: 200 },
    );
  });

  it('mixes peer nonces into the seed in seat order', async () => {
    expect(shuffleSeed('o', [])).toBe(await sha256('o'));
    expect(shuffleSeed('o', ['p1', 'p2'])).toBe(await sha256('op1p2'));
    expect(shuffleSeed('o', ['p1', 'p2'])).not.toBe(shuffleSeed('o', ['p2', 'p1']));
  });

  it('draws the byte stream from SHA-256(seed + counter)', async () => {
    const s = new ByteStream('seed');
    const got = Array.from({ length: 40 }, () => s.next());
    const want = [...(await webSha('seed0')), ...(await webSha('seed1')).slice(0, 8)];
    expect(got).toEqual(want);
  });

  it('gives every permutation of three cards about equally often', () => {
    const counts = new Map<string, number>();
    const N = 6000;
    for (let i = 0; i < N; i++) {
      const k = shuffledOrder(['a', 'b', 'c'], shuffleSeed(`n${i}`, [])).join('');
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    expect(counts.size).toBe(6);
    // Expected 1000 each; a 4.5-sigma band (sigma about 29) keeps this deterministic test far from flaky.
    for (const c of counts.values()) expect(Math.abs(c - N / 6)).toBeLessThan(130);
  });

  it('samples swap partners without modulo bias', () => {
    const s = new ByteStream('bias');
    const n = 3;
    const counts = [0, 0, 0];
    for (let i = 0; i < 30000; i++) counts[s.below(n)]! += 1;
    for (const c of counts) expect(Math.abs(c - 10000)).toBeLessThan(400);
    expect(() => s.below(0)).toThrow();
  });

  it('hashes the order as SHA-256(order joined by "," + "|" + nonce)', async () => {
    expect(orderHash(['b', 'a', 'c'], 'n')).toBe(await sha256('b,a,c|n'));
  });
});
