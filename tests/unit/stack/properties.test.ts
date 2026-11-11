/**
 * Property tests for the stack and confirmation rounds together (PLAN M1-P3; DESIGN "The effect stack", "Turn flow and
 * confirmation"; "Specification: code interfaces", Reducer contract: pure, total, deterministic).
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { isUndoable, type Action } from '../../../src/core/actions';
import { canonicalJson } from '../../../src/core/hash';
import { checkInvariants } from '../../../src/core/invariants';
import { explain, reduce } from '../../../src/core/reducer';
import { confirmDeadlines, pendingAbout, roundPassed } from '../../../src/core/reducer/confirm';
import type { TableState } from '../../../src/core/types';
import { inverse, undoKey } from '../../../src/core/undo';
import { P, act, ok, play, readyTable } from '../core/helpers';

const KINDS = ['push', 'push', 'push', 'resolve', 'resolve', 'counter', 'reorder', 'dragOut', 'note', 'ask', 'respond', 'respond', 'respond', 'respond', 'autoPass', 'turnPass', 'leave', 'take', 'timer', 'undo', 'clock'] as const;

interface Recipe {
  kind: (typeof KINDS)[number];
  a: number;
  b: number;
  by: number;
  flag: boolean;
}

const recipe: fc.Arbitrary<Recipe> = fc.record({ kind: fc.constantFrom(...KINDS), a: fc.nat(100), b: fc.nat(100), by: fc.nat(2), flag: fc.boolean() });
const pick = <T>(xs: readonly T[], i: number): T | undefined => (xs.length ? xs[i % xs.length] : undefined);
const RESPONSES = ['ok', 'hold', 'release', 'timeout'] as const;

function start(): TableState {
  let s = readyTable(6, 'ffa3', 3);
  s = play(s, 'a00', P(-100, -300));
  s = play(s, 'b00', P(100, 300, 180), 's1');
  for (const id of ['a01', 'a02', 'a03']) s = ok(s, act('reveal', { instanceId: id, ref: { sid: `sid-${id}` }, salt: `salt-${id}` }));
  return s;
}

function build(s: TableState, r: Recipe, n: number, history: { before: TableState; action: Action }[]): Action | null {
  const by = `s${r.by}`;
  const base = { by, cid: `p${n}` };
  const items = s.stack.map((i) => i.id);
  const top = items[items.length - 1] ?? 'none';
  const spells = ['a01', 'a02', 'a03'].filter((id) => s.cards[id] && s.cards[id]!.zone !== 'stack');
  const round = s.confirm?.id ?? 'none';
  switch (r.kind) {
    case 'push': {
      const card = pick(spells, r.a);
      const kind = r.a % 3 === 0 && card ? 'spell' : r.a % 3 === 1 ? 'trigger' : 'ability';
      return { ...base, type: 'stackPush', item: `i${n}`, kind, ...(kind === 'spell' ? { card } : { source: r.flag ? 'a00' : 'b00' }), ...(r.b % 4 === 0 ? {} : { round: `r${n}` }) } as Action;
    }
    case 'resolve':
      return { ...base, type: 'stackResolve', item: top, to: `graveyard:${by}`, ...(r.flag ? { force: true } : {}) };
    case 'counter':
      return { ...base, type: 'stackCounter', item: top };
    case 'reorder':
      return { ...base, type: 'stackReorder', item: pick(items, r.a) ?? 'none', index: r.b % 4 };
    case 'dragOut': {
      const it = s.stack.find((i) => i.card !== undefined);
      return it ? { ...base, type: 'move', card: it.card!, to: `battlefield:${by}`, pose: P(r.a, -200) } : null;
    }
    case 'note':
      return { ...base, type: 'stackNote', item: pick(items, r.a) ?? 'none', note: r.flag ? 'X = 3' : '' };
    case 'ask':
      return { ...base, type: 'ask', round: `k${n}`, ...(r.flag && items.length ? { about: pick(items, r.a)! } : {}), ...(r.b % 2 ? { label: 'attacks?' } : {}) };
    case 'respond': {
      const response = RESPONSES[r.a % 4]!;
      const seat = `s${r.b % 3}`;
      return { ...base, ...(response === 'timeout' ? {} : { by: seat }), type: 'respond', round: r.flag || !s.confirm ? round : 'stale', seat, response };
    }
    case 'autoPass':
      return { ...base, type: 'autoPass', on: r.flag };
    case 'turnPass':
      return { ...base, type: 'turnPass', to: `s${r.b % 3}` };
    case 'leave':
      return { ...base, type: 'seatLeave', seat: by };
    case 'take':
      return { ...base, type: 'seatTake', seat: by, name: `P${r.by}`, colour: r.by };
    case 'timer':
      return { ...base, type: 'settings', settings: { passTimerMs: r.flag ? null : 2000 + (r.a % 29) * 1000 } };
    case 'undo': {
      const last = history[history.length - 1];
      const inv = last ? inverse(last.before, last.action) : null;
      return last && inv ? { ...base, by: last.action.by, type: 'undo', of: last.action.cid, inverse: inv } : null;
    }
    case 'clock': {
      // What the sequencer's clock does when a deadline fires: the first emit, stamped as the sequencer (s0).
      const d = confirmDeadlines(s)[0];
      return d ? ({ ...d.emit[0]!, by: 's0', cid: `clock${n}` } as Action) : null;
    }
  }
}

function run(rs: Recipe[]): { actions: Action[]; states: TableState[]; reasons: (string | null)[] } {
  let s = start();
  const states = [s];
  const actions: Action[] = [];
  const reasons: (string | null)[] = [];
  const history: { before: TableState; action: Action }[] = [];
  rs.forEach((r, i) => {
    const a0 = build(s, r, i, history);
    if (!a0) return;
    const a = { ...a0, seq: s.seq + 1 } as Action;
    const why = explain(s, a);
    const next = reduce(s, a);
    if (next !== s && isUndoable(a)) history.push({ before: s, action: a });
    if (a.type === 'undo' && next !== s) history.pop();
    actions.push(a);
    reasons.push(why);
    states.push(next);
    s = next;
  });
  return { actions, states, reasons };
}

const RUNS = Number(process.env.CORE_PROP_RUNS ?? 150);
const recipes = fc.array(recipe, { minLength: 1, maxLength: 60, size: 'max' });

/** The design's rules for a round, checked independently of the reducer. */
function roundProblems(s: TableState): string[] {
  const r = s.confirm;
  if (!r) return [];
  const out: string[] = [];
  if (r.about !== undefined && !s.stack.some((i) => i.id === r.about)) out.push(`round about ${r.about}, which is not on the stack`);
  if (!s.seats[r.askedBy]) out.push('unknown asker');
  if (!(r.durationMs >= 0)) out.push('negative duration');
  if (r.startSeq > s.seq) out.push('round starts after the current seq');
  if (r.timerSeq !== undefined && (r.timerSeq < r.startSeq || r.timerSeq > s.seq)) out.push('timerSeq out of range');
  if (r.askedBy in r.responses) out.push('the asker answered its own round');
  for (const [seat, resp] of Object.entries(r.responses)) {
    if (!['ok', 'hold', 'timeout'].includes(resp)) out.push(`bad response ${resp}`);
    if (resp === 'hold' && r.holder !== seat) out.push(`${seat} holds without the floor`);
  }
  if (r.holder !== undefined && r.responses[r.holder] !== 'hold') out.push('holder without a hold');
  if (r.durationMs === 0 && Object.values(r.responses).includes('timeout')) out.push('timeout with the timer off');
  return out;
}

describe('stack and confirmation properties (PLAN M1-P3)', () => {
  it('every sequence keeps the table and the round consistent, and the reducer total', () => {
    fc.assert(
      fc.property(recipes, (rs) => {
        const { states, actions, reasons } = run(rs);
        states.forEach((s, i) => {
          const where = i === 0 ? 'initial' : `after ${canonicalJson(actions[i - 1])}`;
          expect(checkInvariants(s), where).toEqual([]);
          expect(roundProblems(s), where).toEqual([]);
        });
        for (const why of reasons) expect(why ?? '').not.toMatch(/internal error/);
      }),
      { numRuns: RUNS },
    );
  });

  it('a resolve without force never takes an item whose round still waits', () => {
    fc.assert(
      fc.property(recipes, (rs) => {
        const { states, actions } = run(rs);
        actions.forEach((a, i) => {
          const before = states[i]!;
          if (a.type === 'stackResolve' && a.force !== true && pendingAbout(before, a.item)) expect(states[i + 1]).toBe(before);
        });
      }),
      { numRuns: RUNS },
    );
  });

  it('every deadline emit applies when it fires, and passes the round once all emits are in', () => {
    fc.assert(
      fc.property(recipes, (rs) => {
        const { states } = run(rs);
        for (const s of states) {
          const [d] = confirmDeadlines(s);
          if (!d) continue;
          let t = s;
          for (const e of d.emit) {
            const a = { ...e, by: 's0', cid: `x-${canonicalJson(e)}`, seq: t.seq + 1 } as Action;
            expect(explain(t, a)).toBeNull();
            t = reduce(t, a);
          }
          expect(roundPassed(t)).toBe(true);
          expect(confirmDeadlines(t)).toEqual([]);
        }
      }),
      { numRuns: RUNS },
    );
  });

  it('replaying the JSON log gives the same state', () => {
    fc.assert(
      fc.property(recipes, (rs) => {
        const { actions, states } = run(rs);
        let s = start();
        for (const a of JSON.parse(JSON.stringify(actions)) as Action[]) s = reduce(s, a);
        expect(canonicalJson(s)).toBe(canonicalJson(states[states.length - 1]));
      }),
      { numRuns: RUNS },
    );
  });

  it('when an undoable stack action has an inverse, undoing it restores the table, round included', () => {
    fc.assert(
      fc.property(recipes, (rs) => {
        const { actions, states } = run(rs);
        actions.forEach((a, i) => {
          if (!isUndoable(a) || states[i + 1] === states[i]) return;
          const inv = inverse(states[i]!, a);
          if (!inv) return;
          const undone = reduce(states[i + 1]!, { type: 'undo', by: a.by, cid: `u${i}`, of: a.cid, inverse: inv });
          expect(undoKey(undone)).toBe(undoKey(states[i]!));
        });
      }),
      { numRuns: RUNS },
    );
  });
});
