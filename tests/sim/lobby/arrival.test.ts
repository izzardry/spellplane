/**
 * M8-P7 property over whole matchmakers (PLAN Milestone 8, M8-P7 Sim; contracts.md Part G "Matchmaking" item 2): 2 to
 * 12 pages seek over a loopback lobby with seeded delay, drop and reordering, accept every match, and enter the game
 * room. Some pairs of browsers cannot reach each other (no relay): a member of a match with such a pair is not connected
 * to every other member, so after 30 s it is back in `seeking` with its waiting time kept. Asserted: nobody is ever in
 * two matches or two rooms at once, every member of a room agrees on its member list, and a stranded member keeps its
 * original waiting time.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fc from 'fast-check';
import type { QueueId } from '../../../src/core/types';
import { ARRIVE_MS } from '../../../src/session/match-room';
import type { MatchmakerStatus } from '../../../src/session/types';
import { browser, closeAll, type Browser } from '../session/harness';
import { FAKE_TIMERS, lobbyNet } from './harness';
import { mmPage, type MmPage } from './mm-harness';

vi.mock('../../../src/net/identity', async () => (await import('../net/fake-identity')).fakeIdentityModule);

let browsers: Browser[] = [];
let pages: MmPage[] = [];
beforeEach(() => vi.useFakeTimers(FAKE_TIMERS));
afterEach(() => {
  for (const p of pages) p.mm.dispose();
  pages = [];
  closeAll(browsers);
  browsers = [];
  vi.useRealTimers();
});

type Moving = Extract<MatchmakerStatus, { phase: 'moving' }>;

describe('matchmakers with the 30-second arrival rule (property)', () => {
  it('nobody is in two matches or rooms; members agree; a stranded member is back in seeking with its wait kept', async () => {
    const queues: QueueId[] = ['1v1.constructed.casual', 'ffa4.constructed.casual'];
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 2, max: 12 }),
        fc.integer({ min: 1, max: 1_000_000 }),
        fc.array(fc.record({ q: fc.subarray(queues, { minLength: 1, maxLength: 2 }), late: fc.integer({ min: 0, max: 2_000 }) }), { minLength: 12, maxLength: 12 }),
        fc.array(fc.tuple(fc.integer({ min: 0, max: 11 }), fc.integer({ min: 0, max: 11 })), { maxLength: 6 }),
        async (n, seed, people, cuts) => {
          const lobby = lobbyNet({ seed, delay: { min: 5, max: 300 }, drop: 0.01 });
          const run: { b: Browser; p: MmPage }[] = [];
          for (let i = 0; i < n; i++) {
            const b = await browser(`p${i}`, `peer-${seed}-${i}`, `P${i}`, i % 4);
            const p = mmPage(lobby, `P${i}`, b.peerId, b.stores);
            browsers.push(b);
            pages.push(p);
            run.push({ b, p });
          }
          // Pairs whose browsers cannot reach each other in a game room.
          const blocked = new Set(cuts.filter(([x, y]) => x !== y && x < n && y < n).map(([x, y]) => `peer-${seed}-${Math.min(x, y)}|peer-${seed}-${Math.max(x, y)}`));
          const reach = (x: string, y: string): boolean => !blocked.has(x < y ? `${x}|${y}` : `${y}|${x}`);

          const sinceOf = new Map<number, number>();
          const enteredAt = new Map<number, { room: string; at: number; peers: string[] }>();
          const inRoom = new Map<number, string>();
          const arrivedRooms = new Map<number, string[]>();
          const membersOf = new Map<string, string>();
          const errors: string[] = [];

          const drive = (): void => {
            for (const [i, { p }] of run.entries()) {
              const s = p.mm.status();
              if (s.phase === 'seeking') {
                const first = sinceOf.get(i);
                if (first === undefined) sinceOf.set(i, s.since);
                else if (first !== s.since) errors.push(`P${i} lost its waiting time: ${first} → ${s.since}`);
              }
              if (s.phase === 'check' && !s.mine) p.mm.answer(true);
              if (s.phase === 'moving') {
                const m: Moving = s;
                const key = m.plan.seats.map((x) => x.peerId).join(',');
                const known = membersOf.get(m.link.roomId);
                if (known !== undefined && known !== key) errors.push(`room ${m.link.roomId}: members disagree`);
                membersOf.set(m.link.roomId, key);
                if (!enteredAt.has(i) || enteredAt.get(i)!.room !== m.link.roomId) {
                  if (inRoom.has(i) && inRoom.get(i) !== m.link.roomId) errors.push(`P${i} in two rooms`);
                  inRoom.set(i, m.link.roomId);
                  enteredAt.set(i, { room: m.link.roomId, at: Date.now(), peers: m.plan.seats.map((x) => x.peerId) });
                }
              }
            }
            // A member arrives once every other member of its room is in that room and reachable; else it is stranded at 30 s.
            for (const [i, e] of enteredAt) {
              const { p, b } = run[i]!;
              if (inRoom.get(i) !== e.room) continue;
              const others = e.peers.filter((x) => x !== b.peerId);
              const here = others.every((peer) => {
                const j = run.findIndex((r) => r.b.peerId === peer);
                return j >= 0 && inRoom.get(j) === e.room && reach(b.peerId, peer);
              });
              if (here) {
                p.mm.arrived(e.room);
                const list = arrivedRooms.get(i) ?? [];
                if (!list.includes(e.room)) list.push(e.room);
                arrivedRooms.set(i, list);
                enteredAt.delete(i);
              } else if (Date.now() - e.at >= ARRIVE_MS) {
                const missing = others.find((peer) => !reach(b.peerId, peer)) ?? null;
                p.mm.stranded(e.room, missing);
                inRoom.delete(i);
                enteredAt.delete(i);
              }
            }
          };

          try {
            for (const [i, { p }] of run.entries()) {
              for (let t = 0; t < people[i]!.late; t += 50) {
                drive();
                await vi.advanceTimersByTimeAsync(50);
              }
              p.mm.seek({ queues: people[i]!.q, deckId: `deck-${i}` });
            }
            for (let t = 0; t < 75_000; t += 50) {
              drive();
              await vi.advanceTimersByTimeAsync(50);
            }
            expect(errors).toEqual([]);
            for (const [i, list] of arrivedRooms) expect(list.length, `P${i} arrived in ${list.join(', ')}`).toBe(1);
            // A stranded member is seeking again (or matched anew), never stuck in `moving` for a room it left.
            for (const [i, { p }] of run.entries()) {
              const s = p.mm.status();
              if (s.phase === 'moving') expect(inRoom.get(i), `P${i} moving without a room`).toBe(s.link.roomId);
            }
          } finally {
            for (const { p } of run) p.mm.dispose();
          }
        },
      ),
      { numRuns: 8 },
    );
  }, 240_000);

  it('a stranded member keeps its place: the exact waiting time and back to seeking within 30 s of moving', async () => {
    const lobby = lobbyNet({ seed: 7, delay: { min: 100, max: 300 } });
    const A = await browser('a', 'peer-a', 'Ann', 0);
    const B = await browser('b', 'peer-b', 'Ben', 1);
    browsers.push(A, B);
    const a = mmPage(lobby, 'Ann', A.peerId, A.stores);
    const b = mmPage(lobby, 'Ben', B.peerId, B.stores);
    pages.push(a, b);
    a.mm.seek({ queues: ['1v1.constructed.casual'], deckId: 'd' });
    await vi.advanceTimersByTimeAsync(4_000);
    const since = (a.mm.status() as { since: number }).since;
    b.mm.seek({ queues: ['1v1.constructed.casual'], deckId: 'd' });
    for (let t = 0; t < 5_000 && a.mm.status().phase !== 'check'; t += 50) await vi.advanceTimersByTimeAsync(50);
    a.mm.answer(true);
    b.mm.answer(true);
    for (let t = 0; t < 5_000 && a.mm.status().phase !== 'moving'; t += 50) await vi.advanceTimersByTimeAsync(50);
    const m = a.mm.status() as Moving;
    expect(m.phase).toBe('moving');
    await vi.advanceTimersByTimeAsync(ARRIVE_MS);
    a.mm.stranded(m.link.roomId, 'Ben');
    expect(a.mm.notice()).toBe('Ben could not be reached directly. Some networks do not allow it, and Spellplane uses no relay.');
    for (let t = 0; t < 3_000 && a.mm.status().phase !== 'seeking'; t += 50) await vi.advanceTimersByTimeAsync(50);
    expect(a.mm.status()).toMatchObject({ phase: 'seeking', since });
    expect((await A.stores.matches.get(m.link.roomId))?.state).toBe('void');
  });
});
