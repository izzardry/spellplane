/**
 * Leak test of the computer opponent (contracts.md Part A; computer.md 12.1; PLAN M8-P6 Leak): with the shared scanner
 * tapped on the LocalNetwork, nothing of the human's hand or library reaches Sparring's session (messages, state, log,
 * secrets, its save) and the reverse; Sparring's view never holds the human's hidden cards, nor the identities or order
 * of its own library.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readCard, unknownCard } from '../../../src/bot/cards';
import type { BotCard, BotView } from '../../../src/bot/types';
import { canonicalJson } from '../../../src/core/hash';
import type { SecretStore, TableState } from '../../../src/core/types';
import { runnerOf } from '../../../src/session/computer';
import type { NetTable } from '../../../src/session/net';
import { leakScan, type Disclosure } from '../../leak/leak';
import { trackDisclosures } from '../session/harness';
import { cards, FAKE_TIMERS, newGame, scriptedHuman, type Sim } from './harness';

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

/**
 * What a BotView leaks of the human's hidden cards, in the form a view would leak them (a BotCard carries an instance id
 * and a name, never a Scryfall id or a salt): any instance id of the human's hand or library, and any card entry of a
 * human card whose identity is not public in the human's confirmed state that is not the unknown card.
 */
function viewLeaks(view: BotView, human: { state: TableState; secrets: SecretStore }): string[] {
  const out: string[] = [];
  const text = canonicalJson(view);
  const hidden = [...human.secrets.hand.map((id) => ['hand', id] as const), ...human.secrets.libraryOrder.map((id) => ['library', id] as const)];
  for (const [where, id] of hidden) if (text.includes(id)) out.push(`${where} card ${id}`);
  const entries: (BotCard & { unknown?: true })[] = [...view.hand, ...view.mine, ...view.theirs];
  for (const entry of entries) {
    const c = human.state.cards[entry.id];
    if (!c || c.owner === view.me || c.identity !== undefined) continue;
    if (entry.name !== unknownCard(entry.id).name || entry.unknown !== true) out.push(`hidden card ${entry.id} read as ${entry.name}`);
  }
  for (const [id, s] of Object.entries(human.secrets.identities)) {
    if (human.state.cards[id]?.identity !== undefined) continue;
    if (text.includes(s.salt) || text.includes(s.card.sid)) out.push(`identity of ${id}`);
  }
  return out;
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
      // The human's hidden cards: neither the ids of its hand and library nor a named entry for a card hidden from Sparring.
      expect(viewLeaks(view, { state: sim.human.engine.confirmedState(), secrets: sim.human.secrets() })).toEqual([]);
      // The bot's library: neither its ids nor its order.
      const lib = sim.bot.secrets().libraryOrder;
      for (const id of lib) expect(text).not.toContain(id);
      expect(view.library).toBe(lib.length);
      expect(view.hand.map((c) => c.id).every((id) => sim.bot.secrets().hand.includes(id))).toBe(true);
    }
    expect(views).toBeGreaterThan(100);
  }, 60_000);

  it("the BotView check catches a view that holds the human's hand", async () => {
    const sim = await newGame(32);
    sims.push(sim);
    const view = runnerOf(sim.game.handle)!.view();
    const human = { state: sim.human.engine.confirmedState(), secrets: sim.human.secrets() };
    expect(viewLeaks(view, human)).toEqual([]);
    expect(human.secrets.hand).toHaveLength(7);
    // The leak a buggy view would make: the human's hand read as cards (instance id and name, as BotCards carry them).
    const leaked: BotCard[] = human.secrets.hand.map((id) => readCard(id, cards().peek(human.secrets.identities[id]!.card.sid)));
    expect(leaked.every((c) => c.name !== '' && c.name !== unknownCard(c.id).name)).toBe(true);
    expect(viewLeaks({ ...view, hand: [...view.hand, ...leaked] }, human)).toHaveLength(14);
    // A hidden card of the human shown on Sparring's side of the view under its name, without the id of the hand.
    const named = { ...leaked[0]!, id: 'x-other', tapped: false, pose: { x: 0, y: 0, rot: 0 }, displaced: false, owned: false };
    const stateWith = { ...human.state, cards: { ...human.state.cards, 'x-other': { ...human.state.cards[human.secrets.hand[0]!]!, id: 'x-other', zone: 'battlefield:s0' } } };
    expect(viewLeaks({ ...view, theirs: [...view.theirs, named] }, { ...human, state: stateWith })).toEqual([`hidden card x-other read as ${leaked[0]!.name}`]);
  }, 60_000);
});
