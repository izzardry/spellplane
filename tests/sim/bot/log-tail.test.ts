/**
 * M8-P6: Sparring's view of "this turn" when its log does not reach back to the turn's start. A resumed session holds
 * only the log after its stored snapshot (store/tables.ts loadTable; persist.ts SNAPSHOT_EVERY), so a snapshot taken
 * during Sparring's turn leaves the turn's untap, draw and land out of the log. Sparring must then neither untap, draw
 * nor play a land a second time in that turn (bot/view.ts buildView).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { decide } from '../../../src/bot/plan';
import { BOT_PROFILES } from '../../../src/bot/types';
import { buildView } from '../../../src/bot/view';
import { runnerOf } from '../../../src/session/computer';
import { resetLifecycleForTests } from '../../../src/util/lifecycle';
import { FAKE_TIMERS, newGame, play, type Sim } from './harness';

vi.mock('../../../src/net/identity', async () => (await import('../net/fake-identity')).fakeIdentityModule);

let sim: Sim | null = null;
beforeEach(() => {
  vi.useFakeTimers(FAKE_TIMERS);
  resetLifecycleForTests();
});
afterEach(() => {
  sim?.game.handle.dispose();
  sim?.stores.close();
  sim = null;
  vi.useRealTimers();
});

describe('a log that starts in the middle of Sparring’s turn', () => {
  it('keeps the draw and the land of the turn done: no second untap, draw or land', async () => {
    sim = await newGame(73);
    const runner = runnerOf(sim.game.handle)!;
    const me = sim.game.handle.seat;
    // Play until Sparring has drawn and played its land in a turn of its own, then hold it there.
    await play(sim, () => {
      const v = runner.view();
      return v.turn.mine && v.thisTurn.drew && v.thisTurn.landPlayed && !v.thisTurn.firstOfGame;
    });
    sim.game.handle.pause();
    const full = runner.view();
    expect(full.turn.mine && full.thisTurn.drew && full.thisTurn.landPlayed).toBe(true);

    const log = sim.bot.log();
    const passAt = log.findLastIndex((e) => e.kind === 'action' && e.action.type === 'turnPass');
    const landAt = log.findLastIndex((e) => e.kind === 'action' && e.action.by === me && e.action.type === 'move' && e.action.to === `battlefield:${me}`);
    expect(landAt).toBeGreaterThan(passAt);
    // The log after a snapshot taken just after the land (as a resume reads it): no turnPass, not from seq 1.
    const tail = log.slice(landAt + 1);
    const view = buildView({ state: sim.bot.getState(), secrets: sim.bot.secrets(), cardData: (r) => sim!.bot.cardData(r), log: tail, me });
    expect(view.thisTurn).toMatchObject({ fresh: false, drew: true, landPlayed: true, firstOfGame: false });
    const step = decide(view, BOT_PROFILES[sim.game.handle.config.level], sim.game.handle.config.seed);
    expect(['draw', 'playLand', 'untap']).not.toContain(step?.kind);
    expect(step).not.toEqual({ kind: 'phase', phase: 'untap' });
  }, 120_000);
});
