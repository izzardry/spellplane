/**
 * PLAN M2-P3 acceptance on a simulated network: a Winston draft driven end to end by the drivers (draft/winston.ts)
 * over LoopbackNetwork with delay, reordering and dropped sequencing messages, with a reload of each browser on the
 * way, and once more with the other player's browser lost (killed and revived) right when the dealer must show it a
 * pile. The leak scenario of the same runs is tests/sim/draft/open/leak.test.ts.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { close, type DraftSeat } from './net';
import { requestsTo, winstonDraft, type WinstonRun } from './winston-run';

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
});
afterEach(() => {
  vi.useRealTimers();
});

/** Every card of every pack is taken by exactly one player, and each pool holds exactly its cards in pick order. */
function expectEveryCardInOnePool(run: WinstonRun, packs: number): void {
  const { t } = run;
  const [a, b] = t.seats as [DraftSeat, DraftSeat];
  const final = a.peer.state;
  for (const s of t.seats) expect(s.peer.state).toEqual(final);
  const d = final.draft!;
  expect(d.done).toBe(true);
  expect(d.winston).toMatchObject({ stack: 0, piles: [0, 0, 0], dealer: 's0' });
  // `packs` packs, all opened face down by the dealer from their own pack-seed rounds, none listing its ids.
  const opens = a.peer.log().flatMap((x) => (x.type === 'packOpen' ? [x] : []));
  expect(opens).toHaveLength(packs);
  expect(opens.every((x) => x.by === 's0' && x.public !== true && x.cards === undefined)).toBe(true);
  expect(new Set(opens.map((x) => x.sid)).size).toBe(packs);
  expect(opens.slice(0, -1).every((x) => x.instanceIds === undefined)).toBe(true);
  const generated = a.secrets().draft!.generated.filter((g) => opens.some((x) => x.packId === g.packId));
  expect(generated.map((g) => g.packId)).toEqual(opens.map((x) => x.packId));
  const all = generated.flatMap((g) => g.cards);
  const byId = new Map(all.map((c) => [c.instanceId, c]));
  expect(opens.at(-1)!.instanceIds).toEqual([...byId.keys()].sort());
  const taken = [...d.taken!.s0!, ...d.taken!.s1!];
  expect(new Set(taken).size).toBe(taken.length);
  expect([...taken].sort()).toEqual([...byId.keys()].sort());
  expect(d.pools).toEqual({ s0: d.taken!.s0!.length, s1: d.taken!.s1!.length });
  // Both pools hold exactly the identities of the cards each took, in pick order.
  expect(a.secrets().pool).toEqual(d.taken!.s0!.map((id) => byId.get(id)!.ref));
  expect(b.secrets().pool).toEqual(d.taken!.s1!.map((id) => byId.get(id)!.ref));
}

describe('Winston over the network', () => {
  it('six packs: the dealer deals, both draft to the end, and every card ends in exactly one pool', async () => {
    const run = await winstonDraft(3, 6);
    expectEveryCardInOnePool(run, 6);
    close(run.t);
  }, 120_000);

  it('the other player lost while the turn passes to it still sees its pile and gets every card it took', async () => {
    const run = await winstonDraft(8, 6, { outages: true, sets: ['M19', 'M20'] });
    // Both outages happened: one disclosure was lost on the way, one found no connected peer.
    expect(run.outages).toMatchObject({ inFlight: true, offline: true });
    expect(run.outages.undelivered).toBeGreaterThan(0);
    // s1 asked the dealer again for what it lacked.
    expect(requestsTo(run.t.seats[0]!)).toBeGreaterThan(0);
    expectEveryCardInOnePool(run, 6);
    close(run.t);
  }, 120_000);

  it('the other player reloaded between the turn passing to it and its pile arriving asks for the pile and drafts on', async () => {
    const run = await winstonDraft(6, 3, { reloadLacking: true });
    expect(run.outages.reloadedLacking).toBe(true);
    expect(requestsTo(run.t.seats[0]!)).toBeGreaterThan(0);
    expectEveryCardInOnePool(run, 3);
    close(run.t);
  }, 120_000);
});
