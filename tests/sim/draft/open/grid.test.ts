/**
 * PLAN M2-P3 acceptance on a simulated network: a Grid draft of 18 grids driven end to end by the drivers
 * (draft/grid.ts) over LoopbackNetwork with delay, reordering and dropped sequencing messages (DESIGN "Specification:
 * card data, packs and draft formats", Grid: nine face-up cards from shuffled packs, first player takes a row or
 * column, second a remaining one, the rest is discarded, first player alternates, end after 18 grids).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { verifyReveal } from '../../../../src/core/commit';
import { gridLineOpen, gridTaker } from '../../../../src/core/open';
import { mulberry32 } from '../../../../src/util/prng';
import { close, draftNet, fixtureGenerator, fixtureSet, runDraft, type DraftSeat } from './net';
import { ByteStream, shuffleSeed } from '../../../../src/core/rng';
import { shuffleWith } from '../../../../src/draft/open';

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
});
afterEach(() => {
  vi.useRealTimers();
});

/** A player who takes a random open row or column when it is their take. */
function randomTaker(seed: number): (s: DraftSeat) => void {
  const rand = mulberry32(seed);
  return (s) => {
    const d = s.host.state().draft;
    if (!d?.grid || gridTaker(d) !== s.seat) return;
    const lines = (['row', 'col'] as const).flatMap((line) => ([0, 1, 2] as const).map((index) => ({ line, index }))).filter((l) => gridLineOpen(d.grid!, l.line, l.index));
    const l = lines[Math.floor(rand() * lines.length)]!;
    expect(s.driver.gridTake!(l.line, l.index)).toBe(true);
  };
}

describe('Grid over the network', () => {
  it('18 grids: laid by alternating first players, every card in exactly one pool or the discard', async () => {
    const t = await draftNet(2, { format: 'grid', grids: 18 }, { seed: 18, delay: { min: 0, max: 100 }, drop: 0.05, faultyChannels: ['act', 'ctl'] });
    const bot = randomTaker(18);
    let refused = 0;
    await runDraft(t, (s) => {
      // A take out of turn, or of a line already taken, is refused by the driver.
      const d = s.host.state().draft;
      if (d?.grid && d.grid.cells.length > 0 && gridTaker(d) !== s.seat && !s.driver.gridTake!('row', 0)) refused++;
      bot(s);
    });
    expect(refused).toBeGreaterThan(0);
    const [a] = t.seats as [DraftSeat, DraftSeat];
    const final = a.peer.state;
    for (const s of t.seats) expect(s.peer.state).toEqual(final);
    const d = final.draft!;
    expect(d.done).toBe(true);
    expect(d.grid!.index).toBe(18);

    const log = a.peer.log();
    const opens = log.flatMap((x) => (x.type === 'packOpen' ? [x] : []));
    expect(opens).toHaveLength(18);
    // The first player alternates and lays its grid; nine face-up cards each, opening the commitments.
    expect(opens.map((x) => x.by)).toEqual(Array.from({ length: 18 }, (_, g) => (g % 2 === 0 ? 's0' : 's1')));
    for (const o of opens) {
      expect(o.cards).toHaveLength(9);
      for (const c of o.cards!) expect(verifyReveal(d.packs[o.packId]!.commitment, c)).toBe(true);
    }
    // The first take of each grid is the first player's, the second the other's.
    const takes = log.flatMap((x) => (x.type === 'gridTake' ? [x] : []));
    for (let g = 0; g < 18; g++) {
      const these = takes.filter((x) => x.grid === g);
      expect(these.map((x) => x.by)).toEqual(g % 2 === 0 ? ['s0', 's1'] : ['s1', 's0']);
    }
    // Every card: taken by exactly one player or discarded with its grid.
    const all = opens.flatMap((o) => o.cards!);
    const taken = [...d.taken!.s0!, ...d.taken!.s1!];
    const discarded = Object.values(d.packs).flatMap((p) => p.cards!.map((c) => c.id));
    expect(new Set([...taken, ...discarded]).size).toBe(taken.length + discarded.length);
    expect([...taken, ...discarded].sort()).toEqual(all.map((c) => c.instanceId).sort());
    // Pools hold the face-up identities in take order.
    const ref = new Map(all.map((c) => [c.instanceId, c.ref]));
    for (const s of t.seats) expect(s.secrets().pool).toEqual(d.taken![s.seat]!.map((id) => ref.get(id)));
    close(t);
  }, 120_000);

  it('each grid is reproducible from its pack seed: the generated booster, shuffled by the same stream, first nine', async () => {
    const t = await draftNet(2, { format: 'grid', grids: 2 }, { seed: 4, delay: { min: 0, max: 30 } });
    await runDraft(t, randomTaker(4));
    const opens = t.seats[0]!.peer.log().flatMap((x) => (x.type === 'packOpen' ? [x] : []));
    for (const s of t.seats) {
      for (const rec of s.secrets().draft!.generated) {
        const stream = new ByteStream(shuffleSeed(rec.ownerNonce, rec.peerNonces));
        const regenerated = fixtureGenerator()(fixtureSet(rec.set), stream);
        expect(rec.cards.map((c) => c.ref)).toEqual(regenerated.cards.map((c) => c.ref));
        const shown = shuffleWith(rec.cards, stream).slice(0, 9);
        const open = opens.find((o) => o.packId === rec.packId)!;
        expect(open.by).toBe(s.seat);
        expect(open.cards).toEqual(shown);
      }
    }
    close(t);
  }, 120_000);
});
