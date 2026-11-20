/**
 * M8-P7 broker simulations (PLAN Milestone 8, M8-P7 Sim; matchmaking.md 2.5; contracts.md Part G "Matchmaking"):
 * LobbyRooms over a LoopbackNetwork with seeded delay, drop and reordering under fake timers.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fc from 'fast-check';
import type { QueueId } from '../../../src/core/types';
import { midOf } from '../../../src/net/lobby/pairing';
import { ticketText } from '../../../src/net/lobby/text';
import type { Ticket } from '../../../src/net/lobby/messages';
import type { Message } from '../../../src/net/transport';
import { advance, draft, FAKE_TIMERS, joinAndSeek, lobbyNet, makeSeeker, stop, until, type Seeker } from './harness';

vi.mock('../../../src/net/identity', async () => (await import('../net/fake-identity')).fakeIdentityModule);

let all: Seeker[] = [];
beforeEach(() => vi.useFakeTimers(FAKE_TIMERS));
afterEach(() => {
  stop(all);
  all = [];
  vi.useRealTimers();
});

const Q1: QueueId = '1v1.constructed.ranked';
const seeker = (...a: Parameters<typeof makeSeeker>): Seeker => {
  const s = makeSeeker(...a);
  all.push(s);
  return s;
};

describe('broker over a loopback lobby', () => {
  it('two compatible seekers reach check within 1 s and moving after both ready, with equal room, key and seats', async () => {
    const net = lobbyNet({ seed: 1 });
    const a = seeker(net, 'ann', { tid: 'a1', answer: null });
    const b = seeker(net, 'ben', { tid: 'b1', answer: null });
    await a.room.join();
    await b.room.join();
    await advance(100);
    const t0 = Date.now();
    await a.room.seek(draft([Q1]));
    await b.room.seek(draft([Q1]));
    await until(() => a.room.state.phase === 'check' && b.room.state.phase === 'check', 1_000, 'both in check');
    expect(Date.now() - t0).toBeLessThanOrEqual(1_000);
    a.room.answer(true);
    await advance(300);
    expect(a.room.state.phase).toBe('check');
    b.room.answer(true);
    await until(() => a.formed.length === 1 && b.formed.length === 1, 2_000, 'both formed');
    const [fa, fb] = [a.formed[0]!, b.formed[0]!];
    expect(fa.roomId).toBe(fb.roomId);
    expect(fa.roomKey).toBe(fb.roomKey);
    expect(fa.order).toEqual(fb.order);
    expect([...fa.order].sort()).toEqual(['a1', 'b1']);
    expect(a.room.state.phase).toBe('moving');
  });

  it('2k compatible 1v1 seekers form k matches within 10 s', async () => {
    const net = lobbyNet({ seed: 2, delay: { min: 5, max: 80 } });
    const k = 4;
    const ss = Array.from({ length: 2 * k }, (_, i) => seeker(net, `s${i}`, { tid: `t${String(i).padStart(2, '0')}` }));
    for (const s of ss) await s.room.join();
    await advance(200);
    const t0 = Date.now();
    for (const s of ss) await s.room.seek(draft([Q1]));
    await until(() => ss.every((s) => s.formed.length === 1), 10_000, 'k matches');
    expect(Date.now() - t0).toBeLessThanOrEqual(10_000);
    expect(new Set(ss.map((s) => s.formed[0]!.mid)).size).toBe(k);
  });

  it('four seekers form one ffa4 match with four distinct seats', async () => {
    const net = lobbyNet({ seed: 3 });
    const q: QueueId = 'ffa4.constructed.casual';
    const ss = ['a', 'b', 'c', 'd'].map((n) => seeker(net, n, { tid: `${n}9` }));
    for (const s of ss) await joinAndSeek(s, draft([q]));
    await until(() => ss.every((s) => s.formed.length === 1), 10_000, 'the ffa4 match');
    const f = ss[0]!.formed[0]!;
    expect(f.queue).toBe(q);
    expect(new Set(f.order).size).toBe(4);
    for (const s of ss) {
      expect(s.formed[0]!.order).toEqual(f.order);
      expect(s.formed[0]!.roomId).toBe(f.roomId);
    }
  });

  it('a decline returns the others to seeking with their waiting time kept; the decliner stops', async () => {
    const net = lobbyNet({ seed: 4 });
    const a = seeker(net, 'ann', { tid: 'a2', answer: true });
    const b = seeker(net, 'ben', { tid: 'b2', answer: false });
    await joinAndSeek(a, draft([Q1]));
    const since = a.room.state.since;
    await joinAndSeek(b, draft([Q1]));
    await until(() => b.effects.some((e) => e.kind === 'stopped'), 5_000, 'Ben declined');
    await until(() => a.effects.some((e) => e.kind === 'returned'), 2_000, 'Ann back in the queue');
    expect(a.room.state.phase === 'seeking' || a.room.state.phase === 'collecting').toBe(true);
    expect(a.room.state.since).toBe(since);
    expect(b.room.state.phase).toBe('watching');
    expect(b.room.state.ticket).toBeNull();
    expect(a.formed).toHaveLength(0);
  });

  it('the ready check lapses after 20 s on the one who did not answer; the other keeps its wait', async () => {
    const net = lobbyNet({ seed: 5 });
    const a = seeker(net, 'ann', { tid: 'a3', answer: true });
    const b = seeker(net, 'ben', { tid: 'b3', answer: null });
    await joinAndSeek(a, draft([Q1]));
    const since = a.room.state.since;
    await joinAndSeek(b, draft([Q1]));
    await until(() => b.room.state.phase === 'check', 2_000, 'check');
    await advance(20_500, 50);
    expect(b.effects.some((e) => e.kind === 'stopped' && e.reason === 'lapsed')).toBe(true);
    await until(() => a.effects.some((e) => e.kind === 'returned'), 3_000, 'Ann returned');
    expect(a.room.state.since).toBe(since);
  });

  it('overlapping offers yield exactly one match', async () => {
    const net = lobbyNet({ seed: 6, delay: { min: 5, max: 40 } });
    const q: QueueId = 'ffa3.constructed.casual';
    const [a, b, c, d] = ['a', 'b', 'c', 'd'].map((n) => seeker(net, n, { tid: `${n}5` })) as [Seeker, Seeker, Seeker, Seeker];
    for (const s of [a, b, c, d]) await joinAndSeek(s, draft([q]));
    // While B collects A's offer {A,B,C}, D offers {B,C,D} to the same two members.
    await until(() => b.room.state.phase === 'collecting', 5_000, 'B collecting');
    const transport = (d.room as unknown as { o: { transport: { send(c: string, m: Message, to?: string): void } } }).o.transport;
    const mid = midOf(q, ['b5', 'c5', 'd5'], 'd5', 99);
    const members = ['b5', 'c5', 'd5'].map((t) => ({ tid: t, rev: 1 }));
    for (const to of ['b5', 'c5']) transport.send('ctl', { v: 1, t: 'offer', mid, queue: q, members } as unknown as Message, to);
    await advance(15_000, 20);
    const formed = [a, b, c, d].flatMap((s) => s.formed.map((f) => ({ who: s.name, mid: f.mid })));
    expect(new Set(formed.map((f) => f.mid)).size).toBe(1);
    expect(formed).toHaveLength(3);
    for (const s of [a, b, c, d]) expect(s.formed.length).toBeLessThanOrEqual(1);
  });

  it('a forged hold is ignored', async () => {
    const net = lobbyNet({ seed: 7 });
    const a = seeker(net, 'ann', { tid: 'a4' });
    await joinAndSeek(a, draft([Q1]));
    // A raw peer with a valid ticket answers the offer with a hold whose signature is not its key's.
    const raw = net.create('z4');
    const unsigned = { v: 1 as const, tid: 'z4', peerId: 'p-z4', pubKey: 'pk-p-z4', ...draft([Q1]) };
    const ticket: Ticket = { ...unsigned, sig: `sig(pk-p-z4|${ticketText(unsigned)})` };
    let offered: string | null = null;
    raw.on('ctl', (m) => {
      if (m.t === 'offer') offered = m.mid as string;
    });
    await raw.join('x', 'y');
    await advance(50);
    raw.send('ctl', { v: 1, t: 'beat', state: 'seeking', waitedMs: 0, n: 1, links: ['a4'] } as unknown as Message);
    raw.send('ctl', { v: 1, t: 'seek', ticket, waitedMs: 0 } as unknown as Message);
    await until(() => offered !== null, 3_000, 'the offer');
    raw.send('ctl', { v: 1, t: 'hold', mid: offered!, nonce: 'A'.repeat(22), sig: 'sig(pk-someone-else|forged)' } as unknown as Message, 'a4');
    await advance(4_000);
    expect(a.checks).toHaveLength(0);
    // The same peer with its own signature does reach the check.
    await until(() => a.room.state.hold !== null, 5_000, 'another offer');
    const mid = a.room.state.hold!.offer.mid;
    raw.send('ctl', { v: 1, t: 'hold', mid, nonce: 'A'.repeat(22), sig: `sig(pk-p-z4|spellplane-v1|hold|${mid}|z4|p-z4)` } as unknown as Message, 'a4');
    await until(() => a.checks.length === 1, 2_000, 'check with a valid hold');
  });

  it('two seekers 300 ms apart are matched within 7 s of each row boundary (no livelock after a window pass)', async () => {
    const cases: { boundary: number; band: 1 | 2 | 3 | 4 | 5; r: number }[] = [
      { boundary: 10_000, band: 4, r: 1500 },
      { boundary: 20_000, band: 3, r: 1750 },
      { boundary: 40_000, band: 5, r: 1500 },
      { boundary: 60_000, band: 3, r: 2000 },
      { boundary: 90_000, band: 1, r: 1500 },
    ];
    for (const [i, c] of cases.entries()) {
      const net = lobbyNet({ seed: 20 + i, delay: { min: 300, max: 300 } });
      const a = seeker(net, 'ann', { tid: `a7${i}` });
      const b = seeker(net, 'ben', { tid: `b7${i}` });
      await a.room.join();
      await b.room.join();
      await advance(1_000);
      const t0 = Date.now();
      await a.room.seek(draft([Q1], { band: 5 }));
      await b.room.seek(draft([Q1], { band: c.band === 1 ? 1 : (5 - (c.band - 3)) as 1 | 2 | 3 | 4 | 5, r: c.r }));
      await until(() => a.formed.length === 1 && b.formed.length === 1, c.boundary + 7_000 + 2_000, `the match at ${c.boundary}`);
      const at = Date.now() - t0;
      expect(at, `boundary ${c.boundary}`).toBeGreaterThanOrEqual(c.boundary - 1_000);
      expect(at, `boundary ${c.boundary}`).toBeLessThanOrEqual(c.boundary + 7_000);
      stop([a, b]);
    }
  }, 60_000);

  it('property: 2 to 12 seekers with delay, drop and reordering: nobody in two matches, members agree on the member list', async () => {
    const queues: QueueId[] = ['1v1.constructed.ranked', '1v1.constructed.casual', 'ffa3.constructed.casual', 'ffa4.constructed.casual'];
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 2, max: 12 }),
        fc.integer({ min: 1, max: 1_000_000 }),
        fc.array(fc.record({ q: fc.subarray(queues, { minLength: 1, maxLength: 2 }), band: fc.integer({ min: 2, max: 4 }), late: fc.integer({ min: 0, max: 3_000 }), decline: fc.boolean() }), { minLength: 12, maxLength: 12 }),
        async (n, seed, people) => {
          const net = lobbyNet({ seed, delay: { min: 5, max: 400 }, drop: 0.02 });
          const ss = people.slice(0, n).map((p, i) => makeSeeker(net, `s${i}`, { tid: `q${seed}x${String(i).padStart(2, '0')}`, answer: !(p.decline && i % 3 === 0) }));
          try {
            for (const s of ss) await s.room.join();
            for (const [i, s] of ss.entries()) {
              await advance(people[i]!.late, 50);
              await s.room.seek(draft(people[i]!.q, { band: people[i]!.band as 2 | 3 | 4 }));
            }
            await advance(40_000, 50);
            const byMid = new Map<string, { names: Set<string>; members: string }[]>();
            for (const s of ss) {
              expect(s.formed.length).toBeLessThanOrEqual(1);
              for (const f of s.formed) {
                const list = byMid.get(f.mid) ?? [];
                list.push({ names: new Set([s.room.tid]), members: [...f.order].join(',') });
                byMid.set(f.mid, list);
              }
            }
            for (const [, list] of byMid) {
              const members = list[0]!.members.split(',');
              for (const x of list) expect(x.members).toBe(list[0]!.members);
              // Every member that formed is in the member list; a dropped `ready` may keep one from forming, never put it elsewhere.
              for (const x of list) expect(members).toContain([...x.names][0]);
            }
            // Nobody is in two rooms.
            const rooms = ss.flatMap((s) => s.formed.map((f) => `${s.room.tid}@${f.roomId}`));
            expect(new Set(rooms.map((r) => r.split('@')[0])).size).toBe(rooms.length);
          } finally {
            stop(ss);
          }
        },
      ),
      { numRuns: 12 },
    );
  }, 120_000);
});
