// M0-P2 acceptance: the limiter never exceeds 2 requests per second under a burst of 50 calls (fake timers), and a
// 429 locks the client out for 30 s (DESIGN "Card data and images"; "Specification: card data, packs and draft formats").
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RateLimiter, scryfallLimiter } from '../../../src/data/limiter';
import { ScryfallClient } from '../../../src/data/scryfall';
import { FakeScryfall } from './fakeScryfall';

/** Largest number of request starts inside any half-open window [t, t + 1000). */
function maxPerSecond(starts: number[]): number {
  const s = [...starts].sort((a, b) => a - b);
  let max = 0;
  for (let i = 0; i < s.length; i++) {
    let n = 0;
    for (let j = i; j < s.length && s[j]! < s[i]! + 1000; j++) n++;
    max = Math.max(max, n);
  }
  return max;
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('rate limiter', () => {
  it('never exceeds 2 requests per second under a burst of 50 API calls', async () => {
    vi.setSystemTime(1_000_000);
    const fake = new FakeScryfall();
    const client = new ScryfallClient({ fetch: fake.fetch, limiter: new RateLimiter() });
    const ids = fake.cards.slice(0, 50).map((c) => c.id);
    let done = 0;
    const all = Promise.all(ids.map((id) => client.collection([{ id }]).then((r) => (done++, r))));
    // Nothing is pending forever: everything finishes once enough (fake) time has passed.
    await vi.advanceTimersByTimeAsync(30_000);
    const results = await all;
    expect(done).toBe(50);
    expect(results.map((r) => r.cards[0]?.id)).toEqual(ids);
    const starts = fake.calls.map((c) => c.at);
    expect(starts).toHaveLength(50);
    expect(maxPerSecond(starts)).toBeLessThanOrEqual(2);
    // …and it is not needlessly slow: 50 requests at 2/s take about 25 s.
    expect(Math.max(...starts) - Math.min(...starts)).toBeLessThanOrEqual(25_000);
  });

  it('starts requests in the order they were made, and a burst is spread over time rather than sent at once', async () => {
    vi.setSystemTime(0);
    const limiter = new RateLimiter();
    const order: number[] = [];
    const ps = Array.from({ length: 10 }, (_, i) => limiter.schedule(async () => order.push(i)));
    expect(order).toEqual([0, 1]);
    expect(limiter.pending).toBe(8);
    await vi.advanceTimersByTimeAsync(999);
    expect(order).toEqual([0, 1]);
    await vi.advanceTimersByTimeAsync(1);
    expect(order).toEqual([0, 1, 2, 3]);
    await vi.advanceTimersByTimeAsync(5000);
    await Promise.all(ps);
    expect(order).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it('counts calls from every client sharing the default limiter together', async () => {
    vi.setSystemTime(50_000_000);
    const fake = new FakeScryfall();
    const a = new ScryfallClient({ fetch: fake.fetch });
    const b = new ScryfallClient({ fetch: fake.fetch });
    expect(a.limiter).toBe(scryfallLimiter);
    expect(b.limiter).toBe(scryfallLimiter);
    const id = fake.cards[0]!.id;
    const ps = Array.from({ length: 12 }, (_, i) => (i % 2 ? a : b).collection([{ id }]));
    await vi.advanceTimersByTimeAsync(10_000);
    await Promise.all(ps);
    expect(maxPerSecond(fake.calls.map((c) => c.at))).toBeLessThanOrEqual(2);
  });

  it('runs on a monotonic clock: setting the system clock back neither stalls the window nor the lock-out', async () => {
    vi.setSystemTime(1_000_000_000);
    const limiter = new RateLimiter();
    const order: number[] = [];
    const ps = Array.from({ length: 4 }, (_, i) => limiter.schedule(async () => order.push(i)));
    expect(order).toEqual([0, 1]);
    vi.setSystemTime(1_000_000_000 - 1_000_000);
    await vi.advanceTimersByTimeAsync(1000);
    expect(order).toEqual([0, 1, 2, 3]);
    await Promise.all(ps);
    limiter.backOff();
    const late = limiter.schedule(async () => order.push(4));
    vi.setSystemTime(1_000_000_000 - 2_000_000);
    await vi.advanceTimersByTimeAsync(30_000);
    await late;
    expect(order).toEqual([0, 1, 2, 3, 4]);
  });

  it('a task scheduled with front: true starts before tasks already queued', async () => {
    vi.setSystemTime(0);
    const limiter = new RateLimiter();
    const order: string[] = [];
    const ps = ['a', 'b', 'c', 'd'].map((n) => limiter.schedule(async () => order.push(n)));
    ps.push(limiter.schedule(async () => order.push('retry'), { front: true }));
    await vi.advanceTimersByTimeAsync(2000);
    await Promise.all(ps);
    expect(order).toEqual(['a', 'b', 'retry', 'c', 'd']);
  });

  it('a failing request still counts and does not block the queue', async () => {
    vi.setSystemTime(0);
    const limiter = new RateLimiter();
    const p1 = limiter.schedule(() => Promise.reject(new Error('boom')));
    const p2 = limiter.schedule(() => {
      throw new Error('sync boom');
    });
    const p3 = limiter.schedule(async () => 'ok');
    await expect(p1).rejects.toThrow('boom');
    await expect(p2).rejects.toThrow('sync boom');
    await vi.advanceTimersByTimeAsync(1000);
    await expect(p3).resolves.toBe('ok');
  });
});

describe('429 back-off', () => {
  it('after a 429 no request starts for 30 s; the request is then retried and succeeds', async () => {
    vi.setSystemTime(0);
    const fake = new FakeScryfall({ rateLimitCalls: [0] });
    const client = new ScryfallClient({ fetch: fake.fetch, limiter: new RateLimiter() });
    const id = fake.cards[0]!.id;
    const first = client.collection([{ id }]);
    await vi.advanceTimersByTimeAsync(1);
    // The 429 arrived at t=0; a request made afterwards has a free rate slot but is held back by the lock-out.
    const second = client.collection([{ id: fake.cards[1]!.id }]);
    await vi.advanceTimersByTimeAsync(29_998);
    expect(fake.calls.map((c) => c.at)).toEqual([0]);
    await vi.advanceTimersByTimeAsync(2_000);
    const [r1, r2] = await Promise.all([first, second]);
    expect(r1.cards[0]?.id).toBe(id);
    expect(r2.cards[0]?.id).toBe(fake.cards[1]!.id);
    const later = fake.calls.slice(1).map((c) => c.at);
    expect(later.every((t) => t >= 30_000)).toBe(true);
  });

  it('the request that hit a 429 is retried ahead of requests queued after it', async () => {
    vi.setSystemTime(0);
    const fake = new FakeScryfall({ rateLimitCalls: [0] });
    const client = new ScryfallClient({ fetch: fake.fetch, limiter: new RateLimiter() });
    const ids = fake.cards.slice(0, 4).map((c) => c.id);
    // a and b start at once (2 per second); a gets the 429 while c and d wait in the queue.
    const all = Promise.all(ids.map((id) => client.collection([{ id }])));
    await vi.advanceTimersByTimeAsync(40_000);
    await all;
    const order = fake.calls.map((c) => ((c.body as { identifiers: { id: string }[] }).identifiers[0]!.id));
    expect(order).toEqual([ids[0], ids[1], ids[0], ids[2], ids[3]]);
  });

  it('gives up with an error after repeated 429s instead of retrying forever', async () => {
    vi.setSystemTime(0);
    const fake = new FakeScryfall({ rateLimitCalls: [0, 1, 2, 3, 4] });
    const client = new ScryfallClient({ fetch: fake.fetch, limiter: new RateLimiter() });
    const p = client.collection([{ id: fake.cards[0]!.id }]);
    const caught = p.catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(120_000);
    const err = await caught;
    expect(err).toBeInstanceOf(Error);
    expect((err as { status?: number }).status).toBe(429);
    expect(fake.calls).toHaveLength(3);
    expect(fake.calls[1]!.at - fake.calls[0]!.at).toBeGreaterThanOrEqual(30_000);
    expect(fake.calls[2]!.at - fake.calls[1]!.at).toBeGreaterThanOrEqual(30_000);
  });
});
