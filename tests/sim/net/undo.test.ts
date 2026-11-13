/**
 * PLAN M5-P6 undo edge cases on real networked sessions (session/net.ts over the engine, LoopbackNetwork, fake timers).
 * DESIGN "Turn flow and confirmation", Undo: "Ctrl+Z reverts the player's own most recent actions, one at a time, and
 * every undo is shown in the log. Undoing a draw puts the card back on top of the library and says so. Shuffles,
 * reveals, dice and coin results cannot be undone. There is no table-wide rewind." DESIGN "Card manipulation": a
 * gesture over a selection is one action per card with a shared group, undone as one step (CLAUDE.md).
 *
 * The edge cases: undo of a grouped gesture (one step, all or nothing), undo of draws vs shuffles, undo of an action
 * another player already built on (refused, never their change silently taken back), undo after a reload (the stack is
 * rebuilt from the stored log), and undo across a sequencer change.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Action } from '../../../src/core/actions';
import type { InstanceId } from '../../../src/core/types';
import { browser, closeAll, FAKE_TIMERS, fixtureDeck, net, open, settle, until, waitConverged, type Browser, type NetTable } from '../session/harness';
import { isLand } from '../session/script';

vi.mock('../../../src/net/identity', async () => (await import('./fake-identity')).fakeIdentityModule);

let browsers: Browser[] = [];
beforeEach(() => {
  vi.useFakeTimers(FAKE_TIMERS);
});
afterEach(() => {
  closeAll(browsers);
  browsers = [];
  vi.useRealTimers();
});

const warnings = (s: NetTable): string[] => s.log().flatMap((e) => (e.kind === 'system' ? [e.text] : []));
const undos = (s: NetTable): Action[] => s.log().flatMap((e) => (e.kind === 'action' && e.action.type === 'undo' ? [e.action] : []));

interface Table {
  network: ReturnType<typeof net>;
  B: Browser[];
  s: NetTable[];
}

/** `n` players at one table, each Ready with a fixture deck, shuffled, seven cards drawn. */
async function table(n: 2 | 3, seed: number, faults: { delay?: { min: number; max: number }; drop?: number } = {}): Promise<Table> {
  const network = net({ seed, ...faults });
  const names = ['anna', 'ben', 'cleo'];
  const B: Browser[] = [];
  for (let i = 0; i < n; i++) B.push(await browser(names[i]!, `peer-${names[i]!.slice(0, 1)}`, names[i]![0]!.toUpperCase() + names[i]!.slice(1), i * 2));
  browsers.push(...B);
  const opts = n === 3 ? { format: 'ffa3' as const } : {};
  const s: NetTable[] = [];
  for (const b of B) s.push(await open(network, b, {}, opts));
  await waitConverged(s, 'seated');
  for (const [i, x] of s.entries()) await settle(x.importDeck(await fixtureDeck(i % 2 === 0 ? 'gw-m19-60.txt' : 'ur-m19-60.mtga.txt')), 30_000, 'ready');
  await settle(Promise.all(s.map((x) => x.shuffle())), 60_000, 'the shuffles');
  for (const x of s) await settle(x.draw(7));
  await waitConverged(s, 'opening hands');
  return { network, B, s };
}

/** Put `n` lands from `x`'s hand onto its battlefield (drawing until it has them), each turned up. */
async function lands(t: Table, x: NetTable, n: number): Promise<InstanceId[]> {
  const sid = (id: InstanceId): string => x.secrets().identities[id]!.card.sid;
  for (let i = 0; i < 30 && x.secrets().hand.filter((id) => isLand(sid(id))).length < n; i++) await settle(x.draw(1));
  const out = x.secrets().hand.filter((id) => isLand(sid(id))).slice(0, n);
  out.forEach((id, k) => x.dispatch({ type: 'move', card: id, to: `battlefield:${x.seat}`, pose: { x: 70 * k, y: x.seat === 's0' ? -200 : 200, rot: 0 } }));
  await until(() => out.every((id) => t.s.every((y) => y.engine.confirmedState().cards[id]?.identity !== undefined)), 30_000, 'the lands turned up');
  await waitConverged(t.s);
  return out;
}

describe('undo of draws vs shuffles', () => {
  it('undoing a draw puts the card back on top of the library and the log shows the undo', async () => {
    const t = await table(2, 1);
    const [a, b] = t.s as [NetTable, NetTable];
    const top = a.secrets().libraryOrder[0]!;
    await settle(a.draw(1));
    await waitConverged(t.s);
    expect(a.secrets().hand).toContain(top);
    expect(a.undo()).toBe(true);
    await waitConverged(t.s);
    expect(a.secrets().libraryOrder[0]).toBe(top);
    expect(a.secrets().hand).not.toContain(top);
    expect(b.engine.confirmedState().zones['library:s0']!.ids).toContain(top);
    const drawn = a.log().flatMap((e) => (e.kind === 'action' && e.action.type === 'draw' && e.action.instanceId === top ? [e.action] : []));
    expect(undos(b).map((u) => (u.type === 'undo' ? u.of : ''))).toContain(drawn.at(-1)!.cid);
    // And the next draw takes that same card again.
    await settle(a.draw(1));
    expect(a.secrets().hand).toContain(top);
  });

  it('a shuffle cannot be undone, nor anything before it; a draw after it can', async () => {
    const t = await table(2, 2);
    const [a] = t.s as [NetTable];
    await settle(a.draw(1));
    const drawn = a.secrets().hand.at(-1)!;
    await settle(a.shuffle(), 60_000, 'the shuffle');
    await waitConverged(t.s);
    expect(a.canUndo()).toBe(false);
    expect(a.undo()).toBe(false);
    expect(a.secrets().hand).toContain(drawn);
    const top = a.secrets().libraryOrder[0]!;
    await settle(a.draw(1));
    expect(a.canUndo()).toBe(true);
    expect(a.undo()).toBe(true);
    await waitConverged(t.s);
    expect(a.secrets().libraryOrder[0]).toBe(top);
    expect(a.canUndo()).toBe(false);
  });
});

describe('undo of a grouped gesture', () => {
  it('a gesture over a selection is undone as one step, every card at once', async () => {
    const t = await table(2, 3);
    const [a, b] = t.s as [NetTable, NetTable];
    const [l1, l2, l3] = await lands(t, a, 3);
    for (const id of [l1!, l2!, l3!]) a.dispatch({ type: 'tap', card: id, tapped: true, group: 'g-tap' });
    await waitConverged(t.s);
    expect(a.undo()).toBe(true);
    await waitConverged(t.s);
    for (const id of [l1!, l2!, l3!]) expect(b.engine.confirmedState().cards[id]!.tapped).toBe(false);
    // One undo step: the three undo actions share one group.
    const last = undos(a).slice(-3);
    expect(last).toHaveLength(3);
    expect(new Set(last.map((u) => u.group)).size).toBe(1);
    expect(last[0]!.group).toBeDefined();
  });

  it('a gesture another player built on in part is refused whole: no card of it is taken back', async () => {
    const t = await table(2, 4);
    const [a, b] = t.s as [NetTable, NetTable];
    const [l1, l2] = await lands(t, a, 2);
    for (const [k, id] of [l1!, l2!].entries()) a.dispatch({ type: 'move', card: id, to: 'battlefield:s0', pose: { x: 300 + 70 * k, y: -100, rot: 0 }, group: 'g-drag' });
    await waitConverged(t.s);
    b.dispatch({ type: 'counter', card: l2!, kind: '+1/+1', delta: 1 });
    await waitConverged(t.s);
    const before = a.engine.confirmedState();
    expect(a.undo()).toBe(false);
    expect(warnings(a).at(-1)).toMatch(/^Cannot undo: Ben has acted on .+ since$/);
    await vi.advanceTimersByTimeAsync(500);
    expect(a.engine.confirmedState().cards[l1!]!.pose).toEqual(before.cards[l1!]!.pose);
    expect(a.engine.confirmedState().cards[l2!]!.counters).toEqual({ '+1/+1': 1 });
    expect(undos(b)).toEqual([]);
  });
});

describe('undo of an action another player already built on', () => {
  it('is refused with a log line naming the player, and their change stays', async () => {
    const t = await table(2, 5);
    const [a, b] = t.s as [NetTable, NetTable];
    const [land] = await lands(t, a, 1);
    // Ben taps Anna's land, then Anna tries to take her play back.
    b.dispatch({ type: 'tap', card: land!, tapped: true });
    await waitConverged(t.s);
    expect(a.undo()).toBe(false);
    expect(warnings(a).at(-1)).toMatch(/^Cannot undo: Ben has acted on .+ since$/);
    await waitConverged(t.s);
    expect(b.engine.confirmedState().cards[land!]).toMatchObject({ zone: 'battlefield:s0', tapped: true });
    expect(undos(b)).toEqual([]);
    // The step stays where it is: Ctrl+Z keeps saying so instead of skipping to an older action.
    expect(a.canUndo()).toBe(true);
    expect(a.undo()).toBe(false);
  });

  it('another player acting elsewhere does not block the undo', async () => {
    const t = await table(2, 6);
    const [a, b] = t.s as [NetTable, NetTable];
    const [mine] = await lands(t, a, 1);
    const [theirs] = await lands(t, b, 1);
    a.dispatch({ type: 'tap', card: mine!, tapped: true });
    await waitConverged(t.s);
    b.dispatch({ type: 'tap', card: theirs!, tapped: true });
    b.dispatch({ type: 'life', seat: 's0', delta: -3 });
    await waitConverged(t.s);
    expect(a.undo()).toBe(true);
    await waitConverged(t.s);
    expect(b.engine.confirmedState().cards[mine!]!.tapped).toBe(false);
    expect(b.engine.confirmedState().cards[theirs!]!.tapped).toBe(true);
    expect(b.engine.confirmedState().seats.s0!.life).toBe(17);
  });

  it('an own later action on the same card does not count: it is undone first, then the earlier one', async () => {
    const t = await table(2, 7);
    const [a, b] = t.s as [NetTable, NetTable];
    const [land] = await lands(t, a, 1);
    a.dispatch({ type: 'tap', card: land!, tapped: true });
    a.dispatch({ type: 'counter', card: land!, kind: 'charge', delta: 1 });
    await waitConverged(t.s);
    expect(a.undo()).toBe(true);
    expect(a.undo()).toBe(true);
    await waitConverged(t.s);
    expect(b.engine.confirmedState().cards[land!]).toMatchObject({ tapped: false, counters: {} });
  });
});

describe('undo after a reload', () => {
  it('Ctrl+Z after a reload takes back the own most recent actions from the saved log, one at a time', async () => {
    const t = await table(2, 8);
    const [a, b] = t.s as [NetTable, NetTable];
    const [land] = await lands(t, a, 1);
    a.dispatch({ type: 'tap', card: land!, tapped: true });
    const top = a.secrets().libraryOrder[0]!;
    await settle(a.draw(1));
    await waitConverged(t.s);
    await settle(a.whenSaved());
    a.leave();
    const a2 = await open(t.network, t.B[0]!, { settleMs: 200 });
    await waitConverged([a2, b]);
    expect(a2.canUndo()).toBe(true);
    // The draw first: the card goes back on top of the library.
    expect(a2.undo()).toBe(true);
    await waitConverged([a2, b]);
    expect(a2.secrets().libraryOrder[0]).toBe(top);
    // Then the tap.
    expect(a2.undo()).toBe(true);
    await waitConverged([a2, b]);
    expect(b.engine.confirmedState().cards[land!]!.tapped).toBe(false);
    // Then the play of the land: back to the hand, hidden again (the hand then gets fresh ids, decision M1-P2).
    const sid = a2.secrets().identities[land!]!.card.sid;
    const handSize = a2.secrets().hand.length;
    expect(a2.undo()).toBe(true);
    await until(() => a2.engine.pending().length === 0 && b.engine.confirmedState().cards[land!]?.zone !== 'battlefield:s0', 20_000, 'the land back in the hand');
    await waitConverged([a2, b]);
    expect(b.engine.confirmedState().zones['hand:s0']!.ids).toHaveLength(handSize + 1);
    expect(a2.secrets().hand.some((id) => a2.secrets().identities[id]?.card.sid === sid)).toBe(true);
  });

  it('after a reload, steps undone before it stay undone, and nothing from before a shuffle comes back', async () => {
    const t = await table(2, 9);
    const [a, b] = t.s as [NetTable, NetTable];
    const [l1, l2] = await lands(t, a, 2);
    a.dispatch({ type: 'tap', card: l1!, tapped: true });
    a.dispatch({ type: 'tap', card: l2!, tapped: true });
    await waitConverged(t.s);
    expect(a.undo()).toBe(true);
    await waitConverged(t.s);
    await settle(a.whenSaved());
    a.leave();
    const a2 = await open(t.network, t.B[0]!, { settleMs: 200 });
    await waitConverged([a2, b]);
    // The next step is the tap of l1, not the already undone tap of l2.
    expect(a2.undo()).toBe(true);
    await waitConverged([a2, b]);
    expect(b.engine.confirmedState().cards[l1!]!.tapped).toBe(false);
    expect(b.engine.confirmedState().cards[l2!]!.tapped).toBe(false);
    // A shuffle, a reload: nothing before the shuffle can be undone.
    await settle(a2.shuffle(), 60_000, 'the shuffle');
    await settle(a2.whenSaved());
    a2.leave();
    const a3 = await open(t.network, t.B[0]!, { settleMs: 200 });
    await waitConverged([a3, b]);
    expect(a3.canUndo()).toBe(false);
  });

  it('after a reload, an action another player built on is still refused', async () => {
    const t = await table(2, 10);
    const [a, b] = t.s as [NetTable, NetTable];
    const [land] = await lands(t, a, 1);
    a.dispatch({ type: 'tap', card: land!, tapped: true });
    await waitConverged(t.s);
    b.dispatch({ type: 'counter', card: land!, kind: '+1/+1', delta: 1 });
    await waitConverged(t.s);
    await settle(a.whenSaved());
    a.leave();
    const a2 = await open(t.network, t.B[0]!, { settleMs: 200 });
    await waitConverged([a2, b]);
    expect(a2.undo()).toBe(false);
    expect(warnings(a2).at(-1)).toMatch(/^Cannot undo: Ben has acted on .+ since$/);
  });
});

describe('undo across a sequencer change', () => {
  it('an action the old sequencer stamped is undone through the new one, and every page agrees', async () => {
    const t = await table(3, 11, { delay: { min: 5, max: 60 } });
    const [a, b, c] = t.s as [NetTable, NetTable, NetTable];
    expect(a.engine.isSequencer()).toBe(true);
    const [bl] = await lands(t, b, 1);
    const [cl] = await lands(t, c, 1);
    b.dispatch({ type: 'tap', card: bl!, tapped: true });
    c.dispatch({ type: 'tap', card: cl!, tapped: true });
    await waitConverged(t.s);
    // Anna's page (the sequencer) goes; Ben's takes over (lowest seat still here).
    t.network.kill('peer-a');
    await until(() => b.engine.isSequencer() && c.engine.sequencerId() === b.engine.identity.peerId && c.engine.status() === 'connected', 30_000, 'the handover');
    // Cleo undoes right away, Ben too: both through the new sequencer.
    expect(c.undo()).toBe(true);
    expect(b.undo()).toBe(true);
    await waitConverged([b, c]);
    expect(c.engine.confirmedState().cards[bl!]!.tapped).toBe(false);
    expect(b.engine.confirmedState().cards[cl!]!.tapped).toBe(false);
    expect(undos(b)).toHaveLength(2);
  });

  it('an undo in flight while the sequencer goes is applied exactly once', async () => {
    const t = await table(3, 12, { delay: { min: 20, max: 120 } });
    const [, b, c] = t.s as [NetTable, NetTable, NetTable];
    const [cl] = await lands(t, c, 1);
    c.dispatch({ type: 'counter', card: cl!, kind: 'charge', delta: 1 });
    c.dispatch({ type: 'counter', card: cl!, kind: 'charge', delta: 1 });
    await waitConverged(t.s);
    expect(c.undo()).toBe(true);
    t.network.kill('peer-a');
    await until(() => b.engine.isSequencer() && c.engine.status() === 'connected', 30_000, 'the handover');
    await waitConverged([b, c]);
    expect(b.engine.confirmedState().cards[cl!]!.counters).toEqual({ charge: 1 });
    expect(undos(b)).toHaveLength(1);
  });
});
