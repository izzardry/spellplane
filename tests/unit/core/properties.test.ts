/**
 * PLAN M0-P1 acceptance, property tests with fast-check:
 *  - any action sequence keeps every card in exactly one zone and keeps pile indices contiguous;
 *  - replaying the same actions gives the same state hash;
 *  - undo after any undoable action restores the previous hash;
 *  - the reducer never mutates its input, never reads the clock or randomness, and rejects with the same object.
 *
 * Actions are generated from "recipes" interpreted against the current state, so most of them apply and the rest
 * exercise the reasons of `explain`. A share of the recipes name unknown ids on purpose.
 */
import fc from 'fast-check';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { isUndoable, type Action, type UndoableAction } from '../../../src/core/actions';
import { canonicalJson, stateHash } from '../../../src/core/hash';
import { checkInvariants } from '../../../src/core/invariants';
import { explain, reduce } from '../../../src/core/reducer';
import type { Anchor, Pose, TableState } from '../../../src/core/types';
import { inverse } from '../../../src/core/undo';
import { cardsInExactlyOneZone, deepFreeze, hasHiddenIdentity, hiddenZonesOpaque, pileIndicesContiguous, readyTable, withoutSeq, withoutSeqOrHiddenIdentity } from './helpers';

const KINDS = [
  'move', 'move', 'move', 'tap', 'flip', 'transform', 'rotate', 'counter', 'note', 'attach', 'attach', 'detach', 'pile', 'pile', 'pile',
  'tidy', 'createToken', 'copy', 'remove', 'toZone', 'draw', 'draw', 'reveal', 'reveal', 'hide', 'mulligan', 'lookAt',
  'stackPush', 'stackPush', 'stackNote', 'stackResolve', 'stackCounter', 'stackReorder', 'lineAdd', 'lineAdd', 'lineRemove', 'ping',
  'phaseSet', 'turnPass', 'life', 'playerCounter', 'seatTake', 'seatLeave', 'undoLast', 'moveTemp', 'moveTemp', 'settle',
] as const;

interface Recipe {
  kind: (typeof KINDS)[number];
  a: number;
  b: number;
  c: number;
  by: number;
  flag: boolean;
  bogus: boolean;
  pose: Pose;
  num: number;
}

const coord = fc.oneof(fc.integer({ min: -600, max: 600 }), fc.double({ min: -600, max: 600, noNaN: true, noDefaultInfinity: true }));
const recipeArb: fc.Arbitrary<Recipe> = fc.record({
  kind: fc.constantFrom(...KINDS),
  a: fc.nat(1000),
  b: fc.nat(1000),
  c: fc.nat(1000),
  by: fc.nat(1),
  flag: fc.boolean(),
  bogus: fc.integer({ min: 0, max: 99 }).map((v) => v < 8),
  pose: fc.record({ x: coord, y: coord, rot: fc.oneof(fc.constantFrom(0, 90, 180, 270), fc.double({ min: -720, max: 720, noNaN: true, noDefaultInfinity: true })) }),
  num: fc.integer({ min: -5, max: 5 }),
});

const pick = <T>(xs: readonly T[], i: number): T | undefined => (xs.length ? xs[i % xs.length] : undefined);

/** Turn a recipe into a concrete action against `s`. `history` holds applied undoable actions for undoLast. */
function build(s: TableState, r: Recipe, n: number, history: { before: TableState; action: Action }[]): Action {
  const by = `s${r.by}`;
  const base = { by, cid: `c${n}` };
  const cards = Object.keys(s.cards).sort();
  const pub = cards.filter((id) => s.zones[s.cards[id]!.zone]?.visibility === 'public');
  const zones = Object.keys(s.zones).sort();
  const pubZones = zones.filter((z) => s.zones[z]!.visibility === 'public' && z !== 'stack');
  const hidZones = zones.filter((z) => s.zones[z]!.visibility !== 'public');
  const anyCard = r.bogus ? 'ghost' : (pick(cards, r.a) ?? 'none');
  const pubCard = r.bogus ? 'ghost' : (pick(pub, r.a) ?? anyCard);
  const pubCard2 = pick(pub, r.b) ?? pubCard;
  const items = s.stack.map((i) => i.id);
  const lines = Object.keys(s.lines).sort();
  const pileIds = [...new Set(Object.values(s.cards).flatMap((c) => (c.pile ? [c.pile.id] : [])))].sort();
  const anchor = (i: number): Anchor =>
    i % 3 === 0 ? { kind: 'seat', id: `s${i % 2}` } : i % 3 === 1 && items.length ? { kind: 'stackItem', id: pick(items, i)! } : { kind: 'card', id: pick(pub, i) ?? anyCard };
  switch (r.kind) {
    case 'move': {
      const to = r.flag ? s.cards[pubCard]?.zone && s.zones[s.cards[pubCard]!.zone]!.visibility === 'public' && s.cards[pubCard]!.zone !== 'stack' ? s.cards[pubCard]!.zone : pick(pubZones, r.b)! : pick(pubZones, r.b)!;
      const card = r.c % 4 === 0 ? anyCard : pubCard;
      const pile = r.c % 5 === 0 ? null : r.c % 5 === 1 ? { id: pick(pileIds, r.b) ?? `p${r.b % 3}`, index: r.c % 4, kind: r.flag ? ('cascade' as const) : ('squared' as const) } : undefined;
      return { ...base, type: 'move', card, to, ...(r.c % 3 === 0 ? {} : { pose: r.pose }), ...(pile !== undefined ? { pile } : {}), ...(r.c % 7 === 0 ? { index: r.b % 5 } : {}), ...(r.c % 11 === 0 ? { controller: `s${r.b % 2}` } : {}) };
    }
    case 'tap':
      return { ...base, type: 'tap', card: pubCard, tapped: r.flag };
    case 'flip':
      return { ...base, type: 'flip', card: pubCard, face: r.flag ? 'up' : 'down' };
    case 'transform':
      return { ...base, type: 'transform', card: pubCard, faceIndex: r.flag ? 1 : 0 };
    case 'rotate':
      return { ...base, type: 'rotate', card: pubCard, delta: r.pose.rot };
    case 'counter':
      return { ...base, type: 'counter', card: pubCard, kind: r.flag ? '+1/+1' : 'loyalty', delta: r.num };
    case 'note':
      return { ...base, type: 'note', card: pubCard, text: r.flag ? `n${r.b}` : '' };
    case 'attach':
      return { ...base, type: 'attach', card: pubCard, to: pubCard2, ...(r.flag ? { pose: r.pose } : {}) };
    case 'detach':
      return { ...base, type: 'detach', card: pick(cards.filter((id) => s.cards[id]!.attachedTo), r.a) ?? pubCard, ...(r.flag ? { pose: r.pose } : {}) };
    case 'pile':
      return {
        ...base,
        type: 'pile',
        card: pubCard,
        pile: r.c % 4 === 0 ? null : { id: pick(pileIds, r.b) && r.c % 2 ? pick(pileIds, r.b)! : `p${r.b % 4}`, index: r.c % 5, kind: r.flag ? 'cascade' : 'squared' },
        ...(r.c % 3 === 0 ? { pose: r.pose } : {}),
      };
    case 'tidy': {
      const zone = `battlefield:${by}`;
      const ids = (s.zones[zone]?.ids ?? []).filter((_, i) => (i + r.b) % 2 === 0);
      return { ...base, type: 'tidy', seat: by, poses: Object.fromEntries(ids.map((id, i) => [id, { x: -500 + i * 69, y: r.pose.y, rot: 0 }])) };
    }
    case 'createToken':
      return { ...base, type: 'createToken', card: `tok${n}`, zone: pick(pubZones, r.b)!, pose: r.pose, ...(r.flag ? { ref: { sid: `t-${r.c % 3}` } } : { label: 'Treasure' }) };
    case 'copy':
      return { ...base, type: 'copy', card: `cp${n}`, of: pubCard, pose: r.pose };
    case 'remove':
      return { ...base, type: 'remove', card: pick(cards.filter((id) => s.cards[id]!.isToken), r.a) ?? anyCard };
    case 'toZone':
      return { ...base, type: 'toZone', card: r.flag ? pubCard : anyCard, to: pick(hidZones, r.b)!, position: r.c % 2 ? 'top' : 'bottom' };
    case 'draw': {
      const lib = s.zones[`library:${by}`]!.ids;
      return { ...base, type: 'draw', instanceId: r.bogus ? 'ghost' : (pick(lib, r.a) ?? anyCard) };
    }
    case 'reveal':
      return { ...base, type: 'reveal', instanceId: anyCard, ref: { sid: `sid-${r.b % 40}`, ...(r.flag ? { foil: true as const } : {}) }, salt: 'salt' };
    case 'hide':
      return { ...base, type: 'hide', card: pubCard };
    case 'mulligan':
      return { ...base, type: 'mulligan', count: 1 };
    case 'lookAt':
      return { ...base, type: 'lookAt', zone: `library:${by}`, count: r.num + 2 };
    case 'stackPush': {
      const k = (['spell', 'spell', 'ability', 'trigger', 'copy'] as const)[r.c % 5]!;
      return {
        ...base,
        type: 'stackPush',
        item: r.bogus && items.length ? items[0]! : `i${n}`,
        kind: k,
        ...(k === 'spell' ? { card: anyCard } : {}),
        ...(k === 'ability' || k === 'trigger' ? { source: pubCard } : {}),
        ...(k === 'copy' ? { copyOf: pick(items, r.b) ?? 'none' } : {}),
        ...(r.flag ? { note: 'X = 2' } : {}),
      };
    }
    case 'stackNote':
      return { ...base, type: 'stackNote', item: pick(items, r.a) ?? 'none', note: r.flag ? 'kicked' : '' };
    case 'stackResolve': {
      const top = items[items.length - 1] ?? 'none';
      return { ...base, type: 'stackResolve', item: r.c % 5 === 0 ? (pick(items, r.a) ?? top) : top, ...(r.flag ? { to: pick(zones, r.b)! } : {}), ...(r.c % 2 ? { pose: r.pose } : {}) };
    }
    case 'stackCounter': {
      const top = items[items.length - 1] ?? 'none';
      return { ...base, type: 'stackCounter', item: top, ...(r.flag ? { to: pick(zones, r.b)! } : {}) };
    }
    case 'stackReorder':
      return { ...base, type: 'stackReorder', item: pick(items, r.a) ?? 'none', index: r.b % 4 };
    case 'lineAdd':
      return { ...base, type: 'lineAdd', line: r.bogus && lines.length ? lines[0]! : `l${n}`, kind: (['target', 'attack', 'block', 'attach', 'mark'] as const)[r.c % 5]!, from: anchor(r.a), to: anchor(r.b + 1), ...(r.flag ? { label: 'x' } : {}) };
    case 'lineRemove':
      return { ...base, type: 'lineRemove', line: pick(lines, r.a) ?? 'none' };
    case 'ping':
      return { ...base, type: 'ping', target: anchor(r.a) };
    case 'phaseSet':
      return { ...base, type: 'phaseSet', phase: ['untap', 'upkeep', 'draw', 'main1', 'combat', 'main2', 'end'][r.a % 7]! };
    case 'turnPass':
      return { ...base, type: 'turnPass', to: `s${r.b % 2}` };
    case 'life':
      return { ...base, type: 'life', seat: `s${r.b % 2}`, delta: r.num };
    case 'playerCounter':
      return { ...base, type: 'playerCounter', seat: `s${r.b % 2}`, kind: r.flag ? 'poison' : 'energy', delta: r.num };
    case 'seatTake':
      return { ...base, type: 'seatTake', seat: by, name: `P${r.b % 3}`, colour: r.c % 8 };
    case 'seatLeave':
      return { ...base, type: 'seatLeave', seat: by };
    case 'undoLast': {
      const last = history[history.length - 1];
      const inv = last ? inverse(last.before, last.action) : null;
      if (last && inv) return { ...base, type: 'undo', of: last.action.cid, inverse: inv };
      return { ...base, type: 'tap', card: pubCard, tapped: r.flag };
    }
    case 'moveTemp':
      return {
        ...base,
        type: 'moveTemp',
        card: pubCard,
        pose: r.pose,
        ...(r.c % 3 === 0 ? {} : { combat: r.c % 3 === 1 ? ('attack' as const) : ('block' as const) }),
        ...(r.c % 4 === 0 ? {} : { tap: r.flag }),
      };
    case 'settle':
      return { ...base, type: 'settle', ...(r.flag ? {} : { cards: [pubCard, pubCard2] }) };
  }
}

/** Run recipes from a ready table, returning the action log and every intermediate state. */
function run(recipes: Recipe[], sequenced = true): { actions: Action[]; states: TableState[] } {
  let s = readyTable(8);
  const states = [s];
  const actions: Action[] = [];
  const history: { before: TableState; action: Action }[] = [];
  recipes.forEach((r, i) => {
    const a0 = build(s, r, i, history);
    const a = sequenced ? { ...a0, seq: s.seq + 1 } : a0;
    const next = reduce(s, a);
    if (next !== s && isUndoable(a)) history.push({ before: s, action: a });
    if (a.type === 'undo' && next !== s) history.pop();
    actions.push(a);
    states.push(next);
    s = next;
  });
  return { actions, states };
}

/** Raise with CORE_PROP_RUNS=2000 for a soak run. */
const NUM_RUNS = Number(process.env.CORE_PROP_RUNS ?? 120);
const recipes = fc.array(recipeArb, { minLength: 1, maxLength: 80, size: 'max' });

afterEach(() => vi.restoreAllMocks());

describe('core engine properties (PLAN M0-P1)', () => {
  it('any action sequence keeps every card in exactly one zone and pile indices contiguous', () => {
    fc.assert(
      fc.property(recipes, (rs) => {
        const { states, actions } = run(rs);
        states.forEach((s, i) => {
          const where = i === 0 ? 'initial' : `after #${i - 1} ${canonicalJson(actions[i - 1])}`;
          expect(cardsInExactlyOneZone(s), where).toEqual([]);
          expect(pileIndicesContiguous(s), where).toEqual([]);
          expect(hiddenZonesOpaque(s), where).toEqual([]);
          expect(checkInvariants(s), where).toEqual([]);
        });
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('replaying the same actions gives the same state hash (also from the JSON wire form)', async () => {
    await fc.assert(
      fc.asyncProperty(recipes, async (rs) => {
        const { actions, states } = run(rs);
        const final = states[states.length - 1]!;
        const wire = JSON.parse(JSON.stringify(actions)) as Action[];
        let replay = readyTable(8);
        for (const a of wire) replay = reduce(replay, a);
        expect(await stateHash(replay)).toBe(await stateHash(final));
      }),
      { numRuns: Math.ceil(NUM_RUNS / 2) },
    );
  });

  it('undo after any undoable action restores the previous hash', async () => {
    let checked = 0;
    let exact = 0;
    const types = new Set<string>();
    await fc.assert(
      fc.asyncProperty(recipes, async (rs) => {
        const { actions, states } = run(rs, false);
        for (let i = 0; i < actions.length; i++) {
          const a = actions[i]!;
          const before = states[i]!;
          const after = states[i + 1]!;
          const inv = inverse(before, a);
          if (!isUndoable(a) || after === before) {
            expect(inv, `${a.type} that did not apply or is not undoable`).toBeNull();
            continue;
          }
          expect(inv, `inverse of ${canonicalJson(a)}`).not.toBeNull();
          // The inverse travels as plain JSON inside an undo action.
          const wireInv = JSON.parse(JSON.stringify(inv)) as UndoableAction;
          const undo: Action = { type: 'undo', by: a.by, cid: `u${i}`, of: a.cid, inverse: wireInv, seq: after.seq + 1 };
          expect(explain(after, undo), `undo of ${canonicalJson(a)}`).toBeNull();
          const undone = reduce(after, undo);
          expect(checkInvariants(undone)).toEqual([]);
          // A card revealed where it lies in a hidden zone (and then moved out) comes back without its identity;
          // nothing else may differ, and every other undo restores the exact hash.
          expect(withoutSeqOrHiddenIdentity(undone), `undo of ${canonicalJson(a)}`).toBe(withoutSeqOrHiddenIdentity(before));
          if (withoutSeq(undone) === withoutSeq(before)) {
            expect(await stateHash({ ...undone, seq: before.seq })).toBe(await stateHash(before));
            exact++;
          } else {
            expect(hasHiddenIdentity(before)).toBe(true);
          }
          types.add(a.type);
          checked++;
        }
      }),
      { numRuns: NUM_RUNS },
    );
    expect(checked).toBeGreaterThan(500);
    expect(exact / checked).toBeGreaterThan(0.9);
    for (const t of ['move', 'moveTemp', 'settle', 'toZone', 'draw', 'remove', 'stackResolve', 'turnPass', 'pile', 'attach']) expect(types, t).toContain(t);
  });

  it('never mutates its input, rejects with the same object, and never reads the clock or randomness', () => {
    fc.assert(
      fc.property(recipes, (rs) => {
        const { actions, states } = run(rs);
        const clock = vi.spyOn(Date, 'now').mockImplementation(() => {
          throw new Error('reducer read the clock');
        });
        const rand = vi.spyOn(Math, 'random').mockImplementation(() => {
          throw new Error('reducer read randomness');
        });
        const perf = vi.spyOn(performance, 'now').mockImplementation(() => {
          throw new Error('reducer read the clock');
        });
        try {
          for (let i = 0; i < actions.length; i++) {
            const before = structuredClone(states[i]!);
            const frozen = deepFreeze(structuredClone(states[i]!));
            const a = deepFreeze(structuredClone(actions[i]!));
            const why = explain(frozen, a);
            const out = reduce(frozen, a);
            expect(canonicalJson(frozen)).toBe(canonicalJson(before));
            expect(canonicalJson(out)).toBe(canonicalJson(states[i + 1]!));
            if (why !== null) expect(out).toBe(frozen);
            expect(why ?? '').not.toMatch(/internal error/);
          }
        } finally {
          clock.mockRestore();
          rand.mockRestore();
          perf.mockRestore();
        }
      }),
      { numRuns: Math.ceil(NUM_RUNS / 2) },
    );
  });

  it('most generated actions apply, so the properties are not vacuous', () => {
    const { actions, states } = run(fc.sample(recipeArb, { numRuns: 2000, seed: 7 }));
    const applied = actions.filter((_, i) => states[i + 1] !== states[i]);
    expect(applied.length / actions.length).toBeGreaterThan(0.45);
    const types = new Set(applied.map((a) => a.type));
    for (const t of ['move', 'pile', 'attach', 'toZone', 'draw', 'stackPush', 'stackResolve', 'lineAdd', 'undo', 'tidy', 'remove', 'copy', 'moveTemp', 'settle']) {
      expect(types, t).toContain(t);
    }
  });
});
