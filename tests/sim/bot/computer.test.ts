/**
 * M8-P6 acceptance (PLAN Milestone 8, M8-P6 Sim): Sparring never moves, taps or removes a card it does not own
 * (property over 50 seeded games); 50 games created and disposed leave the lifecycle counters at zero; a game resumed
 * from its saved record continues with the same next step; Sparring's save lives beside the human's.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Action } from '../../../src/core/actions';
import { decide } from '../../../src/bot/plan';
import { ManualClock } from '../../../src/bot/runner';
import { BOT_PROFILES } from '../../../src/bot/types';
import { runnerOf } from '../../../src/session/computer';
import { isBotTable } from '../../../src/store/computer';
import { live, resetLifecycleForTests } from '../../../src/util/lifecycle';
import { FAKE_TIMERS, hashOf, newGame, play, resumeGame, settle, until, type Sim } from './harness';

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

/** The cards an action moves, taps, turns, marks or removes. */
function touched(a: Action): string[] {
  switch (a.type) {
    case 'settle':
      return a.cards ?? ['*every displaced card*'];
    case 'ping':
    case 'lineAdd':
      return a.type === 'lineAdd' && a.from.kind === 'card' ? [a.from.id] : [];
    default: {
      const c = (a as { card?: unknown }).card;
      return typeof c === 'string' && a.type !== 'stackPush' ? [c] : a.type === 'stackPush' && a.card !== undefined ? [a.card] : [];
    }
  }
}

describe('Sparring and the cards it does not own', () => {
  it('never moves, taps or removes a card it does not own (50 seeded games)', async () => {
    let actions = 0;
    for (let seed = 100; seed < 150; seed++) {
      const sim = await newGame(seed);
      await play(sim, (s) => s.result !== undefined, 14);
      const st = sim.human.getState();
      for (const e of sim.human.log()) {
        if (e.kind !== 'action' || e.action.by !== 's1') continue;
        actions++;
        for (const id of touched(e.action)) expect(st.cards[id]?.owner, `${e.action.type} by Sparring on ${id} (seed ${seed})`).toBe('s1');
        if (e.action.type === 'life' && e.action.seat === 's0') expect(e.action.delta).toBeLessThan(0);
      }
      sim.game.handle.dispose();
      sim.stores.close();
    }
    expect(actions).toBeGreaterThan(1000);
  }, 120_000);
});

describe('lifecycle', () => {
  it('50 games created and disposed leave every count at zero', async () => {
    for (let seed = 200; seed < 250; seed++) {
      const sim = await newGame(seed);
      expect(live().botRunners).toBe(1);
      await vi.advanceTimersByTimeAsync(2_000);
      sim.game.handle.dispose();
      sim.stores.close();
      expect(sim.net.memberIds()).toEqual([]);
    }
    await vi.advanceTimersByTimeAsync(10_000);
    const counts = live();
    for (const k of ['botRunners', 'sessions', 'engines', 'transports', 'timers'] as const) expect(counts[k], k).toBe(0);
  }, 120_000);
});

describe('save and resume', () => {
  it("keeps Sparring's save beside the human's and continues with the same next step", async () => {
    const sim = await newGame(7);
    sims.push(sim);
    await play(sim, (s) => s.turn.number >= 6 && s.turn.active === 's1' && s.turn.phase === 'main1', 30);
    const runner = runnerOf(sim.game.handle)!;
    runner.pause();
    await until(() => sim.bot.engine.pending().length === 0 && sim.human.engine.pending().length === 0 && sim.bot.engine.seq() === sim.human.engine.seq(), 30_000, 'quiet');
    await settle(Promise.all([sim.human.whenSaved(), sim.bot.whenSaved()]));
    const hash = hashOf(sim.human.engine.confirmedState());
    const next = decide(runner.view(), BOT_PROFILES.steady, sim.game.handle.config.seed);
    expect(next).not.toBeNull();
    const rooms = (await sim.stores.tables.listTables()).map((t) => t.roomId);
    expect(rooms).toContain('c-sim-7');
    expect(rooms.filter(isBotTable)).toEqual(['bot~c-sim-7']);
    const record = await sim.stores.computer.get('c-sim-7');
    expect(record?.bot.identity.privateJwk).toBeDefined();
    expect(JSON.stringify(record)).not.toContain('CryptoKey');
    sim.game.handle.dispose();
    sims = [];

    const again = await resumeGame(7, sim.stores, { clock: new ManualClock() });
    sims.push(again);
    await until(() => again.bot.engine.seq() === again.human.engine.seq() && again.bot.engine.pending().length === 0, 30_000, 'resumed');
    expect(hashOf(again.human.engine.confirmedState())).toBe(hash);
    expect(hashOf(again.bot.engine.confirmedState())).toBe(hash);
    expect(again.bot.secrets().hand.length).toBe(sim.bot.secrets().hand.length);
    const r2 = runnerOf(again.game.handle)!;
    expect(decide(r2.view(), BOT_PROFILES.steady, again.game.handle.config.seed)).toEqual(next);
    // And Sparring goes on.
    const before = again.human.engine.seq();
    await settle(r2.stepNow());
    await until(() => again.human.engine.seq() > before, 10_000, 'a step');
  }, 60_000);
});
