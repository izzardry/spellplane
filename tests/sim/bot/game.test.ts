/**
 * M8-P6 acceptance (PLAN Milestone 8, M8-P6 Sim): a whole game of Sparring against a scripted human over a
 * LocalNetwork under fake timers ends with Sparring's own `concede` at 0 life and equal state hashes on both sessions.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetLifecycleForTests } from '../../../src/util/lifecycle';
import { FAKE_TIMERS, hashOf, newGame, play, until, type Sim } from './harness';

vi.mock('../../../src/net/identity', async () => (await import('../net/fake-identity')).fakeIdentityModule);

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

describe('a whole game against Sparring', () => {
  it('ends with Sparring conceding at 0 life, both sessions on the same hash', async () => {
    const sim = await newGame(1);
    sims.push(sim);
    expect(sim.human.seat).toBe('s0');
    expect(sim.bot.seat).toBe('s1');
    expect(sim.human.secrets().hand).toHaveLength(7);
    await play(sim, (s) => s.result !== undefined, 60);
    const st = sim.human.getState();
    expect(st.result?.winners).toEqual(['s0']);
    expect(st.seats.s1!.life).toBeLessThanOrEqual(0);
    const concede = sim.human.log().filter((e) => e.kind === 'action' && e.action.type === 'concede');
    expect(concede).toHaveLength(1);
    expect(concede[0]!.kind === 'action' && concede[0]!.action.by).toBe('s1');
    await until(() => sim.bot.engine.pending().length === 0 && sim.human.engine.pending().length === 0 && sim.bot.engine.seq() === sim.human.engine.seq(), 30_000, 'convergence');
    expect(hashOf(sim.bot.engine.confirmedState())).toBe(hashOf(sim.human.engine.confirmedState()));
  }, 60_000);
});
