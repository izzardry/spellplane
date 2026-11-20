/**
 * M8-P6 (computer.md 5.2 row 3, C2 "turn 1 on the play does not draw"): the starting player skips the draw of its first
 * turn of the game, whoever wins the first-player roll. The roll hands the turn over with a `turnPass`, so the turn
 * number is no guide; the view reads the roll (bot/view.ts firstTurnOfGame).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Action, ActionOf } from '../../../src/core/actions';
import type * as Secrecy from '../../../src/session/secrecy';
import { actionsOf } from '../../../src/bot/cues';
import { firstTurnOfGame } from '../../../src/bot/view';
import { resetLifecycleForTests } from '../../../src/util/lifecycle';
import { FAKE_TIMERS, newGame, play, type Sim } from './harness';

vi.mock('../../../src/net/identity', async () => (await import('../net/fake-identity')).fakeIdentityModule);
// The roll's nonces come from `randomSalt` (crypto); seeded here so that which seat wins the roll is fixed per game.
const salts = vi.hoisted(() => ({ next: 1 }));
vi.mock('../../../src/session/secrecy', async (importOriginal) => {
  const real = await importOriginal<typeof Secrecy>();
  return { ...real, randomSalt: (): string => `salt-${(salts.next++).toString(36).padStart(8, '0')}` };
});

/** A new game whose roll the given seat wins: the seeded salts make each attempt deterministic. */
async function gameWon(by: 's0' | 's1'): Promise<Sim> {
  for (let seed = 1; seed <= 16; seed++) {
    salts.next = seed * 1000;
    const sim = await newGame(seed);
    sims.push(sim);
    if (firstSeatOf(sim) === by) return sim;
  }
  throw new Error(`no seed in 1..16 where ${by} wins the roll`);
}

let sims: Sim[] = [];
beforeEach(() => {
  vi.useFakeTimers(FAKE_TIMERS);
  resetLifecycleForTests();
});
afterEach(() => {
  for (const s of sims) {
    s.game.handle.dispose();
    s.stores.close();
  }
  sims = [];
  vi.useRealTimers();
});

/**
 * The turns after the roll, as [seat, its draws]: a draw counts when the turn's seat drew after its first `phaseSet` of
 * the turn (an opening hand or a mulligan comes before it). The roll's own hand-over opens no turn.
 */
function turnDraws(actions: readonly Action[], firstSeat: string): [string, number][] {
  const commit = actions.find((a): a is ActionOf<'rngCommit'> => a.type === 'rngCommit' && a.purpose === 'firstPlayer');
  const rid = commit?.rid;
  let i = actions.findLastIndex((a) => a.type === 'rngReveal' && a.rid === rid) + 1;
  const handOver = actions.findIndex((a, k) => k >= i && (a.type === 'turnPass' || a.type === 'phaseSet'));
  if (handOver >= 0 && actions[handOver]!.type === 'turnPass') i = handOver + 1;
  const out: [string, number][] = [[firstSeat, 0]];
  let phased = false;
  for (const a of actions.slice(i)) {
    const cur = out.at(-1)!;
    if (a.type === 'turnPass') {
      out.push([a.to, 0]);
      phased = false;
    } else if (a.by === cur[0] && a.type === 'phaseSet') phased = true;
    else if (a.by === cur[0] && a.type === 'draw' && phased) cur[1]++;
  }
  return out;
}

const firstSeatOf = (sim: Sim): string => {
  const st = sim.human.getState();
  const r = Object.values(st.rng).find((x) => x.purpose === 'firstPlayer');
  if (r?.result == null) throw new Error('no first-player roll');
  return r.result === 1 ? 's1' : 's0';
};

describe('the first turn of the game', () => {
  it('Sparring on the play does not draw on its first turn, draws on its second; the human draws on its first', async () => {
    const sim = await gameWon('s1');
    // The roll's turnPass raised the number: a check on `turn.number === 1` would let Sparring draw.
    expect(sim.human.getState().turn).toMatchObject({ active: 's1', number: 2 });
    expect(firstTurnOfGame(sim.bot.getState(), actionsOf(sim.bot.log()))).toBe(true);
    await play(sim, (s) => s.turn.number >= 5, 10);
    // [seat, draws] of the first three turns: Sparring on the play skips its draw, then everyone draws once.
    expect(turnDraws(actionsOf(sim.human.log()), 's1').slice(0, 3)).toEqual([['s1', 0], ['s0', 1], ['s1', 1]]);
    expect(firstTurnOfGame(sim.bot.getState(), actionsOf(sim.bot.log()))).toBe(false);
  }, 60_000);

  it('the human on the play does not draw on its first turn; Sparring draws on its first', async () => {
    const sim = await gameWon('s0');
    const st = sim.human.getState();
    expect(st.turn).toMatchObject({ active: 's0', number: 1 });
    expect(firstTurnOfGame(st, actionsOf(sim.human.log()))).toBe(true);
    await play(sim, (s) => s.turn.number >= 4, 10);
    expect(turnDraws(actionsOf(sim.human.log()), 's0').slice(0, 3)).toEqual([['s0', 0], ['s1', 1], ['s0', 1]]);
  }, 60_000);
});
