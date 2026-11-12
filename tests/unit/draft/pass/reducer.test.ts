/**
 * The pass-draft, Pick-Two and sealed reducer cases (core/reducer/pass.ts; DESIGN "Specification: card data, packs and
 * draft formats", Draft formats: pass draft, Pick-Two preset, sealed; "Specification: network protocol and secrecy",
 * Draft packs: `packOpen` publishes commitments, `pick {packId, count}` keeps identities with the picker,
 * `packPass {packId, to, count}` hands the rest on; Secret shuffle: packs come from a pack seed the opener could not
 * choose).
 */
import { describe, expect, it } from 'vitest';
import { canonicalJson } from '../../../../src/core/hash';
import type { TableState } from '../../../../src/core/types';
import { act, draftOf, draftTable, no, ok, openPack, packCards, packOpenFields, sealPackSeed } from '../open/helpers';

const PASS3 = { format: 'pass', packs: 3, picks: 1 } as const;

/** The id of the pack `seat` opened as pack `number`. */
function packOf(state: TableState, seat: string, number: number): string {
  const p = Object.values(draftOf(state).packs).find((x) => x.opener === seat && x.number === number);
  expect(p, `${seat}'s pack ${number + 1}`).toBeDefined();
  return p!.id;
}

/** Every seat opens a face-down pack of `size` cards for the current round. */
function openRound(state: TableState, size: number, set = 'M19'): TableState {
  let s = state;
  const round = draftOf(s).round;
  for (const seat of draftOf(s).drafters) s = openPack(s, seat, packCards(size), round, 'down', set);
  return s;
}

/** The front pack of `seat` picks (count = what the pack needs) and passes it on, if any is left. */
function pickAndPass(state: TableState, seat: string): TableState {
  const d = draftOf(state);
  const packId = d.queues[seat]![0]!;
  const picks = (d.settings as { picks: number }).picks;
  const count = Math.min(picks, d.packs[packId]!.count);
  let s = ok(state, act('pick', { packId, count }, seat));
  const after = draftOf(s).packs[packId]!;
  if (after.count === 0) return s;
  const to = passTo(s, seat, after.number);
  s = ok(s, act('packPass', { packId, to, count: after.count }, seat));
  return s;
}

/** Left (next seat clockwise, the next higher seat index) in odd rounds counted from 1, right in even rounds. */
function passTo(state: TableState, seat: string, number: number): string {
  const ds = draftOf(state).drafters;
  const i = ds.indexOf(seat);
  return number % 2 === 0 ? ds[(i + 1) % ds.length]! : ds[(i + ds.length - 1) % ds.length]!;
}

describe('pass draft: packOpen', () => {
  it('records a face-down pack with its commitments and size, at the back of its opener\'s queue, and no identities', () => {
    const t = draftTable(3, PASS3);
    const cards = packCards(15);
    const s = openPack(t, 's1', cards, 0, 'down');
    const d = draftOf(s);
    const id = packOf(s, 's1', 0);
    const p = d.packs[id]!;
    expect(p).toMatchObject({ opener: 's1', number: 0, set: 'M19', count: 15, holder: 's1', picks: 0, sinceSeq: s.seq });
    expect(p.commitment.instanceIds).toEqual(cards.map((c) => c.instanceId).sort());
    expect(p.commitment.commits).toHaveLength(15);
    expect(p.cards).toBeUndefined();
    expect(d.queues.s1).toEqual([id]);
    // No Scryfall id or salt of the pack is in shared state.
    const json = canonicalJson(s);
    for (const c of cards) {
      expect(json).not.toContain(c.ref.sid);
      expect(json).not.toContain(c.salt);
    }
  });

  it('refuses a pack without a fresh pack seed of its own opener', () => {
    const t = draftTable(2, PASS3);
    const cards = packCards(15);
    // No seed round at all.
    no(t, act('packOpen', packOpenFields('px', cards, 'nope', 0, 'M19', 'down'), 's0'), /pack-seed round/);
    // Another seat's round.
    const other = sealPackSeed(t, 's1');
    no(other.state, act('packOpen', packOpenFields('px', cards, other.sid, 0, 'M19', 'down'), 's0'), /belongs to s1/);
    // A round still waiting for peer nonces.
    const pending = ok(t, act('shuffleCommit', { sid: 'open-round', zone: 'pack:s0', h: 'h', purpose: 'pack' }, 's0'));
    no(pending, act('packOpen', packOpenFields('px', cards, 'open-round', 0, 'M19', 'down'), 's0'), /waits for peer nonces/);
    // An older round when a newer one exists: the opener may not choose among seeds.
    const first = sealPackSeed(t, 's0');
    const second = sealPackSeed(first.state, 's0');
    no(second.state, act('packOpen', packOpenFields('px', cards, first.sid, 0, 'M19', 'down'), 's0'), /latest/);
    ok(second.state, act('packOpen', packOpenFields('px', cards, second.sid, 0, 'M19', 'down'), 's0'));
  });

  it('refuses public cards, unsorted or missing commitments and ids, reused ids, a wrong set and a pack of another round', () => {
    const t = draftTable(2, PASS3, ['M19', 'M20']);
    const sealed = sealPackSeed(t, 's0');
    const s = sealed.state;
    const cards = packCards(15);
    const base = packOpenFields('px', cards, sealed.sid, 0, 'M19', 'down');
    no(s, act('packOpen', packOpenFields('px', cards, sealed.sid, 0, 'M19', 'up'), 's0'), /hidden/);
    no(s, act('packOpen', { ...base, commits: [...base.commits].reverse() }, 's0'), /sorted/);
    no(s, act('packOpen', { ...base, commits: base.commits.slice(1) }, 's0'), /commitments/);
    no(s, act('packOpen', { ...base, instanceIds: [...base.instanceIds!].reverse() }, 's0'), /sorted/);
    no(s, act('packOpen', { ...base, count: 14 }, 's0'));
    no(s, act('packOpen', { ...base, set: 'M20' }, 's0'), /set M19/);
    no(s, act('packOpen', { ...base, number: 1, set: 'M20' }, 's0'), /round 1/);
    no(s, act('packOpen', { ...base, count: 0, commits: [], instanceIds: [] }, 's0'));
    // Ids of an open pack cannot be reused.
    const opened = ok(s, act('packOpen', base, 's0'));
    const again = sealPackSeed(opened, 's1');
    no(again.state, act('packOpen', packOpenFields('py', cards, again.sid, 0, 'M19', 'down'), 's1'), /already in use/);
    // One pack per drafter per round.
    const twice = sealPackSeed(opened, 's0');
    no(twice.state, act('packOpen', packOpenFields('pz', packCards(15), twice.sid, 0, 'M19', 'down'), 's0'), /already opened/);
  });

  it('refuses a seat that is not drafting, and any draft action outside the draft stage', () => {
    const t = draftTable(2, PASS3);
    const sealed = sealPackSeed(t, 's0');
    const fields = packOpenFields('px', packCards(15), sealed.sid, 0, 'M19', 'down');
    no({ ...sealed.state, stage: 'build' }, act('packOpen', fields, 's0'), /draft stage/);
    no(sealed.state, act('packOpen', fields, 's3'));
  });
});

describe('pass draft: pick and packPass', () => {
  it('a pick takes the picks per pass from the front pack, names no card, and the next pack comes to the front', () => {
    let s = openRound(draftTable(2, PASS3), 15);
    const a = packOf(s, 's0', 0);
    const b = packOf(s, 's1', 0);
    no(s, act('pick', { packId: a, count: 2 }, 's0'), /takes 1 card/);
    no(s, act('pick', { packId: a, count: 1, cards: ['x'] }, 's0'), /names no card/);
    no(s, act('pick', { packId: b, count: 1 }, 's0'), /picks from pack/);
    s = ok(s, act('pick', { packId: a, count: 1 }, 's0'));
    let d = draftOf(s);
    expect(d.packs[a]).toMatchObject({ count: 14, picks: 1, holder: 's0' });
    expect(d.pools.s0).toBe(1);
    expect(d.queues.s0).toEqual([]);
    // Passing goes left in round 1: s0 -> s1, at the back of s1's queue.
    no(s, act('packPass', { packId: a, to: 's0', count: 14 }, 's0'));
    no(s, act('packPass', { packId: a, to: 's1', count: 15 }, 's0'), /holds 14/);
    no(s, act('packPass', { packId: b, to: 's0', count: 15 }, 's1'), /before passing/);
    s = ok(s, act('packPass', { packId: a, to: 's1', count: 14 }, 's0'));
    d = draftOf(s);
    expect(d.queues.s1).toEqual([b, a]);
    expect(d.packs[a]!.holder).toBe('s1');
    // s1 picks from its own pack first; then s0's pack comes to the front and its pick timer starts there.
    s = ok(s, act('pick', { packId: b, count: 1 }, 's1'));
    expect(draftOf(s).queues.s1).toEqual([a]);
    expect(draftOf(s).packs[a]!.sinceSeq).toBe(s.seq);
  });

  it('a pick refused for a seat that holds no pack, and a pass of a pack held by another seat', () => {
    let s = openRound(draftTable(3, PASS3), 15);
    const a = packOf(s, 's0', 0);
    s = ok(s, act('pick', { packId: a, count: 1 }, 's0'));
    no(s, act('packPass', { packId: a, to: 's2', count: 14 }, 's1'), /does not hold/);
    s = ok(s, act('packPass', { packId: a, to: 's1', count: 14 }, 's0'));
    s = ok(s, act('pick', { packId: packOf(s, 's2', 0), count: 1 }, 's2'));
    // s2 holds a picked pack but no queued one.
    no(s, act('pick', { packId: packOf(s, 's2', 0), count: 1 }, 's2'), /no pack to pick/);
  });

  it('passes go left, right, left with three packs, and a round starts only when every pack of the round is empty', () => {
    let s = draftTable(4, PASS3);
    const seen: { round: number; from: string; to: string }[] = [];
    for (let round = 0; round < 3; round++) {
      expect(draftOf(s).round).toBe(round);
      s = openRound(s, 15);
      // Opening the next round's pack is refused until this one is over.
      const early = sealPackSeed(s, 's0');
      no(early.state, act('packOpen', packOpenFields('early', packCards(15), early.sid, round + 1, 'M19', 'down'), 's0'));
      for (;;) {
        const d = draftOf(s);
        const seat = d.drafters.find((x) => (d.queues[x] ?? []).length > 0);
        if (seat === undefined) break;
        const packId = d.queues[seat]![0]!;
        const before = s;
        s = pickAndPass(s, seat);
        const last = s.seq > before.seq + 1;
        if (last) seen.push({ round, from: seat, to: draftOf(s).packs[packId]!.holder! });
      }
    }
    const d = draftOf(s);
    expect(d.done).toBe(true);
    expect(d.round).toBe(2);
    const left = (x: string): string => `s${(Number(x.slice(1)) + 1) % 4}`;
    const right = (x: string): string => `s${(Number(x.slice(1)) + 3) % 4}`;
    expect(seen.length).toBe(3 * 4 * 14);
    for (const p of seen) expect(p.to).toBe(p.round === 1 ? right(p.from) : left(p.from));
    // Every card went to exactly one pool: 3 rounds × 4 packs × 15 cards.
    expect(Object.values(d.pools).reduce((a, b) => a + b, 0)).toBe(180);
    for (const x of d.drafters) expect(d.pools[x]).toBe(45);
    // Everything is empty and nobody holds anything.
    for (const p of Object.values(d.packs)) expect(p).toMatchObject({ count: 0, holder: null });
    // Nothing more applies once the draft is done.
    no(s, act('pick', { packId: Object.keys(d.packs)[0]!, count: 1 }, 's0'), /over/);
  });

  it('Pick-Two takes two per pass, and the last card of an odd pack alone', () => {
    let s = openRound(draftTable(4, { format: 'pass', packs: 3, picks: 2 }), 15);
    const counts: number[] = [];
    for (;;) {
      const d = draftOf(s);
      const seat = d.drafters.find((x) => (d.queues[x] ?? []).length > 0);
      if (seat === undefined) break;
      const packId = d.queues[seat]![0]!;
      const left = d.packs[packId]!.count;
      if (left >= 2) no(s, act('pick', { packId, count: 1 }, seat), /takes 2 cards/);
      s = pickAndPass(s, seat);
      counts.push(left - draftOf(s).packs[packId]!.count);
    }
    expect(counts.filter((c) => c === 2)).toHaveLength(4 * 7);
    expect(counts.filter((c) => c === 1)).toHaveLength(4);
    expect(draftOf(s).round).toBe(1);
    for (const x of draftOf(s).drafters) expect(draftOf(s).pools[x]).toBe(15);
  });

  it('two seats: a pack comes back to its opener, and the pass in round 2 goes to the right (the same seat)', () => {
    let s = openRound(draftTable(2, { format: 'pass', packs: 2, picks: 1 }), 3);
    while (draftOf(s).round === 0) {
      const d = draftOf(s);
      s = pickAndPass(s, d.drafters.find((x) => (d.queues[x] ?? []).length > 0)!);
    }
    s = openRound(s, 3);
    const a = packOf(s, 's0', 1);
    s = ok(s, act('pick', { packId: a, count: 1 }, 's0'));
    s = ok(s, act('packPass', { packId: a, to: 's1', count: 2 }, 's0'));
    expect(draftOf(s).packs[a]!.holder).toBe('s1');
  });

  it('is deterministic: the same actions give the same state hash', () => {
    const run = (): string => {
      let s = openRound(draftTable(3, PASS3), 4, 'M19');
      for (let i = 0; i < 4; i++) {
        const d = draftOf(s);
        s = pickAndPass(s, d.drafters.find((x) => (d.queues[x] ?? []).length > 0)!);
      }
      // Only the shape matters: ids differ between runs, so compare the counts.
      const d = draftOf(s);
      return canonicalJson({ pools: d.pools, queues: Object.values(d.queues).map((q) => q.length), counts: Object.values(d.packs).map((p) => p.count) });
    };
    expect(run()).toBe(run());
  });
});

describe('pass draft: pick timer', () => {
  function timed(state: TableState): TableState {
    return { ...state, draft: { ...draftOf(state), pickTimer: true } };
  }

  it('draftTimeout takes the front pack\'s pick for its holder, once per pick number', () => {
    let s = openRound(timed(draftTable(2, PASS3)), 15);
    const a = packOf(s, 's0', 0);
    no(s, act('draftTimeout', { packId: a, picks: 1 }, 's1'), /is over/);
    s = ok(s, act('draftTimeout', { packId: a, picks: 0 }, 's1'));
    expect(draftOf(s).packs[a]).toMatchObject({ count: 14, picks: 1, holder: 's0' });
    expect(draftOf(s).pools.s0).toBe(1);
    // The holder's own pick of that turn is now refused (the pack left its queue), and so is a repeated timeout.
    no(s, act('pick', { packId: a, count: 1 }, 's0'));
    no(s, act('draftTimeout', { packId: a, picks: 0 }, 's1'), /not waiting/);
    // The holder still passes it.
    s = ok(s, act('packPass', { packId: a, to: 's1', count: 14 }, 's0'));
    expect(draftOf(s).queues.s1).toHaveLength(2);
  });

  it('is refused when the timer is off or for a pack that is not at the front', () => {
    const s = openRound(draftTable(2, PASS3), 15);
    no(s, act('draftTimeout', { packId: packOf(s, 's0', 0), picks: 0 }, 's1'), /timer is off/);
    let t = openRound(timed(draftTable(2, PASS3)), 15);
    const a = packOf(t, 's0', 0);
    t = ok(t, act('pick', { packId: a, count: 1 }, 's0'));
    t = ok(t, act('packPass', { packId: a, to: 's1', count: 14 }, 's0'));
    // s1's queue: its own pack, then s0's pack (not at the front).
    no(t, act('draftTimeout', { packId: a, picks: 1 }, 's1'), /not waiting/);
  });
});

describe('sealed', () => {
  const SEALED = { format: 'sealed', packs: 3 } as const;

  it('opens each drafter\'s packs in order straight into its pool, then the draft is done', () => {
    let s = draftTable(2, SEALED, ['M19', 'M20']);
    for (let n = 0; n < 3; n++) {
      for (const seat of ['s0', 's1']) {
        if (n === 0 && seat === 's0') {
          // Out of order is refused.
          const early = sealPackSeed(s, seat);
          no(early.state, act('packOpen', packOpenFields('early', packCards(15), early.sid, 1, 'M20', 'down'), seat), /pack 1/);
        }
        s = openPack(s, seat, packCards(15), n, 'down', n === 0 ? 'M19' : 'M20');
      }
    }
    const d = draftOf(s);
    expect(d.done).toBe(true);
    expect(d.pools).toEqual({ s0: 45, s1: 45 });
    for (const p of Object.values(d.packs)) expect(p).toMatchObject({ count: 0, holder: null });
    expect(Object.values(d.queues).every((q) => q.length === 0)).toBe(true);
  });

  it('has no picks, passes or timer', () => {
    const s = openPack(draftTable(2, SEALED), 's0', packCards(15), 0, 'down');
    const id = packOf(s, 's0', 0);
    no(s, act('pick', { packId: id, count: 1 }, 's0'), /sealed has no picks/);
    no(s, act('packPass', { packId: id, to: 's1', count: 15 }, 's0'));
    no(s, act('draftTimeout', { packId: id, picks: 0 }, 's1'));
  });

  it('refuses more packs than the settings give', () => {
    let s = draftTable(2, { format: 'sealed', packs: 1 });
    s = openPack(s, 's0', packCards(15), 0, 'down');
    const extra = sealPackSeed(s, 's0');
    no(extra.state, act('packOpen', packOpenFields('more', packCards(15), extra.sid, 1, 'M19', 'down'), 's0'), /opened all 1/);
  });
});
