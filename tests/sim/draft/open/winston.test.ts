/**
 * PLAN M2-P3 acceptance on a simulated network: a Winston draft driven end to end by the drivers (draft/winston.ts)
 * over LoopbackNetwork with delay, reordering and dropped sequencing messages, with a reload of each browser on the
 * way; and the package's leak scenario (CLAUDE.md: any code touching hidden information adds its scenario to the
 * shared leak test; DESIGN "Pre-game", Hidden information: Winston "pile contents visible to whoever looks").
 *
 * s0 deals (it holds the stack's identities); s1 is shown a pile only while it looks at it, and the cards it takes.
 * What s1 may know is derived here from the public log alone, independently of the driver's disclosure code: every
 * pile s1 looked at, at the moment it looked, and every card s1 took. Everything else of the dealer's packs (Scryfall
 * ids, salts, the instance-to-card mapping) and every pack-seed owner nonce must be absent from every message s1
 * received, from s1's shared state and from s1's secret store. s0 receives no `draftCards` at all.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { reduce } from '../../../../src/core/reducer';
import { winstonActive, winstonDealt } from '../../../../src/core/open';
import type { InstanceId, TableState } from '../../../../src/core/types';
import { mulberry32 } from '../../../../src/util/prng';
import { scanPairs } from '../../../leak/leak';
import { scan } from '../../../leak/scan';
import { close, draftNet, runDraft, type DraftNet, type DraftSeat } from './net';

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
});
afterEach(() => {
  vi.useRealTimers();
});

/** A player who looks at the pile shown and takes it or declines it at random (taking when declining is refused). */
function randomWinston(seed: number): (s: DraftSeat) => void {
  const rand = mulberry32(seed);
  return (s) => {
    const v = s.driver.view();
    if (!v.waitingOn.includes(s.seat) || v.pile === undefined) return;
    expect(v.pile.length).toBeGreaterThan(0);
    const take = rand() < 0.35;
    if (s.driver.pileLook!(take)) return;
    expect(take).toBe(false);
    expect(s.driver.pileLook!(true)).toBe(true);
  };
}

/** What s1 may know of the dealer's cards, from the public log: piles it looked at when it looked, and what it took. */
function allowedFor(t: DraftNet, seat: string): Set<InstanceId> {
  const out = new Set<InstanceId>();
  let s: TableState = t.start;
  const note = (st: TableState): void => {
    const d = st.draft!;
    if (winstonDealt(d.winston) && winstonActive(d) === seat) for (const id of d.winston.pileIds[d.winston.pile]!) out.add(id);
    for (const id of d.taken?.[seat] ?? []) out.add(id);
  };
  for (const a of t.seats[0]!.peer.log()) {
    s = reduce(s, a);
    note(s);
  }
  return out;
}

async function winstonDraft(seed: number, packs: number): Promise<DraftNet> {
  const t = await draftNet(2, { format: 'winston', packs }, { seed, delay: { min: 0, max: 100 }, drop: 0.05, faultyChannels: ['act', 'ctl'] });
  const bot = randomWinston(seed * 7);
  const reloads = new Set<string>();
  await runDraft(t, (s) => {
    // Each browser reloads once in mid-draft (the dealer while holding the stack, the other between looks).
    const taken = s.peer.state.draft?.taken?.[s.seat]?.length ?? 0;
    if (!reloads.has(s.seat) && taken >= 6) {
      reloads.add(s.seat);
      s.reload();
    }
    bot(s);
  });
  expect(reloads.size).toBe(2);
  return t;
}

describe('Winston over the network', () => {
  it('six packs: the dealer deals, both draft to the end, and every card ends in exactly one pool', async () => {
    const t = await winstonDraft(3, 6);
    const [a, b] = t.seats as [DraftSeat, DraftSeat];
    const final = a.peer.state;
    for (const s of t.seats) expect(s.peer.state).toEqual(final);
    const d = final.draft!;
    expect(d.done).toBe(true);
    expect(d.winston).toMatchObject({ stack: 0, piles: [0, 0, 0], dealer: 's0' });
    // Six packs, all opened face down by the dealer, from six pack-seed rounds.
    const opens = a.peer.log().filter((x) => x.type === 'packOpen');
    expect(opens).toHaveLength(6);
    expect(opens.every((x) => x.by === 's0' && x.type === 'packOpen' && x.public !== true && x.cards === undefined)).toBe(true);
    const generated = a.secrets().draft!.generated;
    expect(generated.map((g) => g.packId)).toEqual(opens.map((x) => (x.type === 'packOpen' ? x.packId : '')));
    const all = generated.flatMap((g) => g.cards);
    const byId = new Map(all.map((c) => [c.instanceId, c]));
    // Every card of every pack is taken by exactly one player.
    const taken = [...d.taken!.s0!, ...d.taken!.s1!];
    expect(new Set(taken).size).toBe(taken.length);
    expect([...taken].sort()).toEqual([...byId.keys()].sort());
    expect(d.pools).toEqual({ s0: d.taken!.s0!.length, s1: d.taken!.s1!.length });
    // Both pools hold exactly the identities of the cards each took, in pick order.
    expect(a.secrets().pool).toEqual(d.taken!.s0!.map((id) => byId.get(id)!.ref));
    expect(b.secrets().pool).toEqual(d.taken!.s1!.map((id) => byId.get(id)!.ref));
    close(t);
  }, 120_000);

  it('leak scenario: the other player sees only the piles it looked at and the cards it took', async () => {
    const t = await winstonDraft(5, 6);
    const [a, b] = t.seats as [DraftSeat, DraftSeat];
    const allowed = allowedFor(t, 's1');
    const generated = a.secrets().draft!.generated;
    const all = generated.flatMap((g) => g.cards);
    const hidden = all.filter((c) => !allowed.has(c.instanceId));
    // The scenario is meaningful: the dealer looked at piles s1 never saw, and s1 saw some piles it did not take.
    expect(hidden.length).toBeGreaterThan(10);
    expect([...allowed].filter((id) => !b.peer.state.draft!.taken!.s1!.includes(id)).length).toBeGreaterThan(0);

    const shownSids = new Set(all.filter((c) => allowed.has(c.instanceId)).map((c) => c.ref.sid));
    const tokens = [
      ...hidden.flatMap((c) => [c.salt, ...(shownSids.has(c.ref.sid) ? [] : [c.ref.sid])]),
      ...generated.map((g) => g.ownerNonce),
    ];
    const pairs = hidden.map((c) => ({ pair: [c.instanceId, c.ref.sid] as [string, string], why: 'mapping' as const }));
    const observed: unknown[] = [b.peer.received, b.peer.state, b.peer.log(), b.secrets(), b.driver.view()];
    expect(scan(observed, tokens)).toEqual([]);
    expect(scanPairs(observed, pairs)).toEqual([]);

    // Every draftCards message s1 received names allowed cards only; s0 never receives one.
    const toB = b.peer.received.filter((m) => (m.msg as { t?: string }).t === 'draftCards');
    expect(toB.length).toBeGreaterThan(0);
    for (const m of toB) for (const c of (m.msg as { cards: { instanceId: string }[] }).cards) expect(allowed.has(c.instanceId)).toBe(true);
    expect(a.peer.received.filter((m) => (m.msg as { t?: string }).t === 'draftCards')).toEqual([]);

    // Negative control: one more card on the pair channel is caught by the same scan.
    const leaked = hidden[0]!;
    a.host.sendCards!('s1', 'control', [leaked]);
    await vi.advanceTimersByTimeAsync(500);
    const again: unknown[] = [b.peer.received, b.secrets()];
    expect(scan(again, tokens).length).toBeGreaterThan(0);
    // s1 kept it (it opens the commitment), but its pool did not change: it did not take it.
    expect(b.secrets().pool).toHaveLength(b.peer.state.draft!.taken!.s1!.length);
    close(t);
  }, 120_000);
});
