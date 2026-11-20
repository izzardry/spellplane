/**
 * Leak test of the computer opponent (contracts.md Part A; computer.md 12.1; PLAN M8-P6 Leak): with the shared scanner
 * tapped on the LocalNetwork, nothing of the human's hand or library reaches Sparring's session (messages, state, log,
 * secrets, its save) and the reverse; Sparring's view never holds the human's hidden cards, nor the identities or order
 * of its own library.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { canonicalJson } from '../../../src/core/hash';
import { runnerOf } from '../../../src/session/computer';
import type { NetTable } from '../../../src/session/net';
import { leakScan, scanPairs, type Disclosure } from '../../leak/leak';
import { trackDisclosures } from '../session/harness';
import { FAKE_TIMERS, newGame, scriptedHuman, type Sim } from './harness';

vi.mock('../../../src/net/identity', async () => (await import('../net/fake-identity')).fakeIdentityModule);

let sims: Sim[] = [];
beforeEach(() => vi.useFakeTimers(FAKE_TIMERS));
afterEach(() => {
  for (const s of sims) {
    s.game.handle.dispose();
    s.stores.close();
  }
  sims = [];
  vi.useRealTimers();
});

async function observed(sim: Sim, who: NetTable, peer: string, botSide: boolean): Promise<unknown[]> {
  const delivered = sim.deliveries.filter((d) => d.to === peer).map((d) => d.msg);
  const received = who.engine.messages().filter((r) => r.dir === 'in');
  const room = botSide ? `bot~${who.roomId}` : who.roomId;
  const saved = [await sim.stores.db.get('tables', room), await sim.stores.db.get('secrets', room), ...(await sim.stores.db.getAll('log', IDBKeyRange.bound([room, -Infinity], [room, Infinity])))];
  return [...delivered, ...received, who.getState(), who.engine.confirmedState(), who.log(), who.secrets(), ...saved];
}

describe('computer opponent leaks (M8-P6)', () => {
  it('the bot session and the human session see nothing hidden of each other', async () => {
    const sim = await newGame(31, { tap: true });
    sims.push(sim);
    const toBot: Disclosure[] = trackDisclosures(sim.human, 's1');
    const toHuman: Disclosure[] = trackDisclosures(sim.bot, 's0');
    const act = scriptedHuman(sim.human, 's1');
    for (let t = 0; t < 600_000 && sim.human.getState().turn.number < 12; t += 300) {
      act();
      await vi.advanceTimersByTimeAsync(300);
    }
    expect(sim.deliveries.length).toBeGreaterThan(300);
    const humanToBot = leakScan({ observed: await observed(sim, sim.bot, 'peer-sparring', true), owner: { state: sim.human.engine.confirmedState(), secrets: sim.human.secrets() }, disclosed: toBot });
    expect(humanToBot.tokens).toEqual([]);
    expect(humanToBot.pairs).toEqual([]);
    const botToHuman = leakScan({ observed: await observed(sim, sim.human, 'peer-human', false), owner: { state: sim.bot.engine.confirmedState(), secrets: sim.bot.secrets() }, disclosed: toHuman });
    expect(botToHuman.tokens).toEqual([]);
    expect(botToHuman.pairs).toEqual([]);
  }, 60_000);

  it("BotView never holds the human's hidden cards or the bot's library order", async () => {
    const sim = await newGame(32);
    sims.push(sim);
    const runner = runnerOf(sim.game.handle)!;
    const act = scriptedHuman(sim.human, 's1');
    let views = 0;
    for (let t = 0; t < 600_000 && sim.human.getState().turn.number < 12; t += 300) {
      act();
      await vi.advanceTimersByTimeAsync(300);
      const view = runner.view();
      const text = canonicalJson(view);
      views++;
      // The human's hidden cards: no identity of a hidden human card in the view, neither by id nor paired.
      const hs = sim.human.secrets();
      const hst = sim.human.engine.confirmedState();
      for (const [id, s] of Object.entries(hs.identities)) {
        const c = hst.cards[id];
        if (c && c.identity === undefined) expect(scanPairs([view], [{ pair: [id, s.card.sid], why: 'mapping' }])).toEqual([]);
        expect(text).not.toContain(s.salt);
      }
      // The bot's library: neither its ids nor its order.
      const lib = sim.bot.secrets().libraryOrder;
      for (const id of lib) expect(text).not.toContain(id);
      expect(view.library).toBe(lib.length);
      expect(view.hand.map((c) => c.id).every((id) => sim.bot.secrets().hand.includes(id))).toBe(true);
    }
    expect(views).toBeGreaterThan(100);
  }, 60_000);
});
