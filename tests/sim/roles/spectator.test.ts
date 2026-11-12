/**
 * PLAN M3-P5 Spectators over real sessions on a simulated network (CLAUDE.md: every protocol feature gets a
 * simulated-network test with delay, drop, reordering and peer loss). Two players play the M1-P8 script
 * (tests/sim/session/script.ts) while spectators watch (DESIGN "Players, seats and formats", Spectators: "A spectator
 * joins by the same link without taking a chair, sees only public zones, can chat and ping, and cannot move cards. A
 * player may reveal their hand to a named spectator"; "Specification: network protocol and secrecy", Sequencing 1:
 * "Spectators are never sequencer", 3: the sequencer checks that the actor's role allows the action).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Action } from '../../../src/core/actions';
import type { LoopbackOptions } from '../../../src/net/loopback';
import { revealHandDrafts, shownToMe } from '../../../src/ui/lobby/spectate';
import { closeAll, converged, dump, FAKE_TIMERS, hashOf, net, open, settle, until, waitConverged, type Browser } from '../session/harness';
import { playScript, type Played } from '../session/script';
import { closeWatchers, watch, watching, type Watcher } from './harness';

vi.mock('../../../src/net/identity', async () => (await import('../net/fake-identity')).fakeIdentityModule);

const FAULTS: LoopbackOptions = { delay: { min: 0, max: 400 }, drop: 0.05, faultyChannels: ['act', 'ctl', 'pres'] };

let browsers: Browser[] = [];
let watchers: Watcher[] = [];
beforeEach(() => {
  vi.useFakeTimers(FAKE_TIMERS);
});
afterEach(() => {
  closeWatchers(watchers);
  closeAll(browsers);
  browsers = [];
  watchers = [];
  vi.useRealTimers();
});

/** The players' converged hash, once every spectator in `ws` holds the same state too. */
async function allConverged(p: Played, ws: readonly Watcher[], what = 'players and spectators to converge'): Promise<string> {
  await until(() => converged([p.a, p.b]) && ws.every((w) => watching(w, hashOf(p.a.engine.confirmedState()))), 30_000, what);
  return hashOf(p.a.engine.confirmedState());
}

/** Spectator Dee (lowest peer id in the room) waits in the room before anyone sits; Cy joins after the script. */
async function table(seed: number, options: LoopbackOptions = FAULTS): Promise<{ p: Played; dee: Watcher; cy: Watcher; network: ReturnType<typeof net> }> {
  const network = net({ seed, ...options });
  const dee = await watch(network, 'dee', 'peer-0', 'Dee');
  watchers.push(dee);
  const p = await playScript(network, browsers);
  const cy = await watch(network, 'cy', 'peer-c', 'Cy');
  watchers.push(cy);
  await allConverged(p, [dee, cy]);
  return { p, dee, cy, network };
}

// Each test plays the whole M1-P8 script first: real time grows with machine load, not with the fake clock.
describe('M3-P5 spectators on a simulated network', { timeout: 120_000 }, () => {
  it('a spectator joins without a chair, sees the public table and is never the sequencer', async () => {
    const { p, dee, cy } = await table(31);
    for (const w of [dee, cy]) {
      expect(w.session.role).toBe('spectator');
      expect(w.session.seat).toBe(`v:${w.peerId}`);
      expect(w.session.engine.seat()).toBeNull();
      // No chair was taken: the two chairs are the players'.
      const seats = Object.values(w.session.getState().seats);
      expect(seats.map((s) => s.peer).sort()).toEqual(['peer-a', 'peer-b']);
      expect(seats.some((s) => s.peer === w.peerId)).toBe(false);
      // Public only: nothing of its own, nothing received, no hidden identity in its state.
      expect(w.session.secrets()).toMatchObject({ identities: {}, libraryOrder: [], hand: [], received: {} });
      const st = w.session.getState();
      for (const c of Object.values(st.cards)) if (st.zones[c.zone]?.visibility !== 'public') expect(c.identity).toBeUndefined();
      // The sequencer is the lowest seated player, although Dee's peer id sorts first and Dee was in the room first.
      expect(w.session.engine.sequencerId()).toBe('peer-a');
      expect(w.session.engine.isSequencer()).toBe(false);
      // Watching writes nothing to the spectator's IndexedDB.
      expect(await settle(dump(w.stores))).toEqual([]);
    }
    // The players see the spectators as spectators, without a seat.
    expect(p.a.engine.peers().filter((x) => x.role === 'spectator').map((x) => [x.peerId, x.seat]).sort()).toEqual([
      ['peer-0', null],
      ['peer-c', null],
    ]);
  });

  it('a spectator’s dispatches of card actions are rejected by the sequencer (PLAN M3-P5 acceptance)', async () => {
    const { p, dee, cy } = await table(32);
    const before = await allConverged(p, [dee, cy]);
    const st = cy.session.getState();
    const bLand = st.zones['battlefield:s1']!.ids[0]!;
    const aCard = st.zones['battlefield:s0']!.ids.find((id) => st.cards[id]!.identity !== undefined) ?? p.faceDown;
    const tries: Action[] = [
      cy.session.dispatch({ type: 'tap', card: bLand, tapped: true }),
      cy.session.dispatch({ type: 'move', card: aCard, to: 'battlefield:s0', pose: { x: 300, y: -300, rot: 0 } }),
      cy.session.dispatch({ type: 'counter', card: bLand, kind: '+1/+1', delta: 2 }),
      cy.session.dispatch({ type: 'note', card: aCard, text: 'mine now' }),
      cy.session.dispatch({ type: 'life', seat: 's0', delta: -20 }),
      cy.session.dispatch({ type: 'phaseSet', phase: 'end' }),
      cy.session.dispatch({ type: 'createToken', card: 'cy-token', zone: 'battlefield:s1', pose: { x: 0, y: 0, rot: 0 }, label: 'Goblin' }),
      cy.session.playFaceDown(p.faceDown, 'graveyard:s0'),
    ];
    // A modified client that proposes in a seat's name is refused too.
    const forged = { type: 'life', by: 's0', cid: 'cy-forged', seat: 's1', delta: -5 } as Action;
    cy.session.engine.propose(forged);
    tries.push(forged);

    // Each was proposed (its optimistic copy applied on Cy's page) and comes back as a nack from the sequencer.
    await until(() => cy.session.engine.pending().length === 0, 30_000, 'the sequencer to answer Cy');
    const nacks = new Map(cy.session.engine.messages().flatMap((r) => (r.dir === 'in' && r.msg.t === 'nack' ? [[r.msg.cid, r.msg.reason] as const] : [])));
    for (const a of tries) {
      if (a.type === 'move' && a.card === p.faceDown) {
        // Moving another seat's face-down card out of the battlefield does not apply locally (no identity to turn up).
        if (!nacks.has(a.cid)) continue;
      }
      expect(nacks.get(a.cid), `${a.type} ${a.cid}`).toMatch(/spectator/);
    }
    const ownSystem = cy.session.log().filter((e) => e.kind === 'system' && /refused: a spectator/.test(e.text));
    expect(ownSystem.length).toBeGreaterThanOrEqual(tries.length - 1);
    // Nothing changed for anyone: same hash, and no action of Cy's in any log.
    expect(await allConverged(p, [dee, cy])).toBe(before);
    for (const log of [p.a.log(), p.b.log(), cy.session.log(), dee.session.log()]) {
      expect(log.filter((e) => e.kind === 'action' && (e.action.by === cy.session.seat || tries.some((t) => t.cid === e.action.cid)))).toEqual([]);
    }
  });

  it('a spectator chats and pings; every page logs the line with the spectator’s nickname', async () => {
    const { p, dee, cy } = await table(33);
    const st = cy.session.getState();
    const bLand = st.zones['battlefield:s1']!.ids[0]!;
    const line = cy.session.chat('nice [[Shock]]');
    const spec = cy.session.chat('anyone else watching?', 'spectator');
    const team = cy.session.chat('psst', 'team');
    const ping = cy.session.dispatch({ type: 'ping', target: { kind: 'card', id: bLand } });
    await allConverged(p, [dee, cy]);
    expect(team).toMatchObject({ channel: 'spectator' });
    for (const log of [p.a.log(), p.b.log(), dee.session.log(), cy.session.log()]) {
      const mine = log.flatMap((e) => (e.kind === 'action' && e.action.by === 'v:peer-c' ? [e.action] : []));
      expect(mine.map((a) => a.cid).sort()).toEqual([line.cid, spec.cid, team.cid, ping.cid].sort());
      expect(mine.find((a) => a.cid === line.cid)).toMatchObject({ type: 'chat', text: 'nice [[Shock]]', channel: 'table', name: 'Cy' });
      expect(mine.find((a) => a.cid === ping.cid)).toMatchObject({ type: 'ping', target: { kind: 'card', id: bLand } });
    }
  });

  it('when the sequencer leaves, the other player takes over, never a spectator, and spectators keep chatting', async () => {
    const { p, dee, cy } = await table(34);
    p.a.leave();
    await until(() => p.b.engine.isSequencer() && p.b.engine.status() === 'connected', 30_000, 'B to take over');
    await until(() => [dee, cy].every((w) => w.session.engine.sequencerId() === 'peer-b'), 30_000, 'the spectators to follow B');
    const line = dee.session.chat('still here');
    await until(() => p.b.log().some((e) => e.kind === 'action' && e.action.cid === line.cid), 30_000, 'Dee’s line after the handover');
    await until(() => cy.session.log().some((e) => e.kind === 'action' && e.action.cid === line.cid), 30_000, 'Cy to see it');
    // Alone with spectators only, nobody sequences: the last player leaves and a spectator's line waits.
    p.b.leave();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(cy.session.engine.isSequencer()).toBe(false);
    expect(dee.session.engine.isSequencer()).toBe(false);
    // With no sequencer to ask, a card action is refused on the spectator's page at once instead of staying applied.
    const land = cy.session.getState().zones['battlefield:s1']!.ids[0]!;
    const tap = cy.session.dispatch({ type: 'tap', card: land, tapped: true });
    expect(cy.session.engine.pending().map((a) => a.cid)).not.toContain(tap.cid);
    expect(cy.session.getState().cards[land]!.tapped).not.toBe(true);
    expect(cy.session.log().some((e) => e.kind === 'system' && /tap refused: a spectator may chat and ping only/.test(e.text))).toBe(true);
    // A chat line still waits for a player.
    const later = cy.session.chat('anyone?');
    expect(cy.session.engine.pending().map((a) => a.cid)).toContain(later.cid);
  });

  it('what only a seat does is refused with a reason, and a HUD call that does not wait raises nothing', async () => {
    const { cy } = await table(39);
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown): void => void unhandled.push(reason);
    process.on('unhandledRejection', onUnhandled);
    try {
      // As src/ui/commands.ts and Hud.svelte call them: `void session.draw(1)` and so on.
      void cy.session.draw(1);
      void cy.session.shuffle();
      void cy.session.mulligan();
      void cy.session.lookAt('library:s0', 1);
      await expect(cy.session.roll('die', 6)).rejects.toThrow(/Spectators watch/);
      await expect(cy.session.importDeck({ main: [], side: [] } as never)).rejects.toThrow(/Spectators watch/);
      await new Promise<void>((r) => setImmediate(r));
      await new Promise<void>((r) => setImmediate(r));
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
    expect(unhandled).toEqual([]);
    expect(cy.session.log().filter((e) => e.kind === 'system' && /Spectators watch/.test(e.text)).length).toBeGreaterThanOrEqual(6);
  });

  it('a watch page under a seated key pair leaves once it sees that chair, so the player’s page takes it back', async () => {
    const network = net({ seed: 37, ...FAULTS });
    const p = await playScript(network, browsers);
    // A closes the table page and opens the watch link under the same key pair before reopening the table.
    p.a.leave();
    await until(() => p.b.engine.isSequencer(), 30_000, 'B to take over');
    const ghost = await watch(network, 'anna-watch', 'peer-a', 'Anna');
    watchers.push(ghost);
    await until(() => ghost.session.heldChair === 's0', 30_000, 'the watch page to see its chair');
    expect(ghost.session.engine.status()).toBe('closed');
    expect(ghost.session.log().some((e) => e.kind === 'system' && /holds a chair at this table \(Anna\)/.test(e.text))).toBe(true);
    // It acts no more.
    ghost.session.chat('hello?');
    expect(ghost.session.engine.pending()).toEqual([]);
    // A's table page reopens and plays from its chair again; B sees it as that chair's player.
    const a2 = await open(network, p.A);
    await until(
      () => converged([a2, p.b]) && a2.engine.seat() === 's0' && p.b.engine.peers().some((x) => x.peerId === 'peer-a' && x.role === 'player' && x.status === 'connected'),
      30_000,
      'A to be back in its chair',
    );
    a2.dispatch({ type: 'life', seat: 's0', delta: -1 });
    await waitConverged([a2, p.b]);
    expect(p.b.engine.confirmedState().seats.s0!.away).not.toBe(true);
  });

  it('a hand shown while the spectator’s page was away reaches it when it comes back (a reload keeps nothing)', async () => {
    const { p, dee, cy, network } = await table(38);
    const a = p.a;
    const handIds = [...a.engine.confirmedState().zones['hand:s0']!.ids];
    expect(handIds.length).toBeGreaterThan(1);
    cy.session.leave();
    await until(() => !a.engine.peers().some((x) => x.peerId === 'peer-c' && x.status === 'connected'), 30_000, 'Cy to be gone');
    for (const d of revealHandDrafts(a.getState(), 's0', cy.session.seat, 'g-while-away')) a.dispatch(d);
    await waitConverged([a, p.b]);
    const cy2 = await watch(network, 'cy2', 'peer-c', 'Cy');
    watchers.push(cy2);
    await until(() => handIds.every((id) => Object.hasOwn(cy2.session.secrets().received, id)), 30_000, 'Cy’s new page to be shown the hand');
    for (const id of handIds) expect(cy2.session.secrets().received[id]).toEqual({ card: a.secrets().identities[id]!.card, salt: a.secrets().identities[id]!.salt, from: 's0' });
    expect(dee.session.secrets().received).toEqual({});
    // A card played since is public, and no longer sent as a reveal to a page that comes back.
    const played = handIds[0]!;
    a.dispatch({ type: 'move', card: played, to: 'battlefield:s0', pose: { x: 200, y: -200, rot: 0 } });
    await allConverged(p, [dee, cy2]);
    cy2.session.leave();
    await until(() => !a.engine.peers().some((x) => x.peerId === 'peer-c' && x.status === 'connected'), 30_000, 'Cy to be gone again');
    const cy3 = await watch(network, 'cy3', 'peer-c', 'Cy');
    watchers.push(cy3);
    await allConverged(p, [dee, cy3]);
    await until(() => handIds.slice(1).every((id) => Object.hasOwn(cy3.session.secrets().received, id)), 30_000, 'Cy’s third page to be shown the rest');
    const resent = cy3.session.engine.messages().filter((r) => r.dir === 'in' && r.channel === 'prv' && r.msg.t === 'reveal' && r.msg.instanceId === played);
    expect(resent).toEqual([]);
  });

  it('a player shows the hand to a named spectator: that spectator alone gets the identities, verified', async () => {
    const { p, dee, cy } = await table(35);
    const a = p.a;
    const handIds = a.engine.confirmedState().zones['hand:s0']!.ids;
    expect(handIds.length).toBeGreaterThan(1);
    const group = 'g-show-cy';
    for (const d of revealHandDrafts(a.getState(), 's0', cy.session.seat, group)) a.dispatch(d);
    await allConverged(p, [dee, cy]);
    await until(() => handIds.every((id) => Object.hasOwn(cy.session.secrets().received, id)), 30_000, 'Cy to receive A’s hand');
    for (const id of handIds) {
      const mine = a.secrets().identities[id]!;
      expect(cy.session.secrets().received[id]).toEqual({ card: mine.card, salt: mine.salt, from: 's0' });
    }
    expect(cy.session.log().some((e) => e.kind === 'system' && /Integrity/.test(e.text))).toBe(false);
    // The public record names the spectator only; the other spectator and the opponent learn nothing.
    const reveals = p.b.log().flatMap((e) => (e.kind === 'action' && e.action.type === 'revealTo' && e.action.group === group ? [e.action] : []));
    expect(reveals.map((r) => (r.type === 'revealTo' ? [r.seats, r.spectators] : null))).toEqual(handIds.map(() => [[], ['v:peer-c']]));
    expect(dee.session.secrets().received).toEqual({});
    for (const id of handIds) expect(p.b.secrets().received[id]).toBeUndefined();
    // The spectator's view lists the shown cards under A's name.
    const shown = shownToMe(cy.session.getState(), cy.session.secrets());
    expect(shown).toHaveLength(1);
    expect(shown[0]).toMatchObject({ seat: 's0', name: 'Anna' });
    expect(shown[0]!.cards.map((c) => c.id).sort()).toEqual([...handIds].sort());

    // A plays one of the shown cards: it is public now, and no longer a private reveal.
    const played = handIds[0]!;
    a.dispatch({ type: 'move', card: played, to: 'battlefield:s0', pose: { x: 200, y: -200, rot: 0 } });
    await allConverged(p, [dee, cy]);
    await until(() => cy.session.getState().cards[played]?.identity !== undefined, 10_000, 'the played card to turn up');
    expect(cy.session.secrets().received[played]).toBeUndefined();
    // A mulligan shuffles the hand away: whatever Cy saw is no longer a card it can point at.
    await settle(a.mulligan(), 60_000, 'A’s mulligan');
    await allConverged(p, [dee, cy]);
    expect(Object.keys(cy.session.secrets().received).filter((id) => handIds.includes(id) && cy.session.getState().zones['hand:s0']!.ids.includes(id))).toEqual([]);
  });

  it('a reveal to a spectator who left goes nowhere; a reveal naming a seat never reaches a spectator', async () => {
    const { p, dee, cy } = await table(36);
    const a = p.a;
    const [first, second] = a.engine.confirmedState().zones['hand:s0']!.ids as [string, string];
    cy.session.leave();
    await until(() => !a.engine.peers().some((x) => x.peerId === 'peer-c' && x.status === 'connected'), 30_000, 'Cy to be gone');
    a.dispatch({ type: 'revealTo', instanceId: first, seats: [], spectators: ['v:peer-c'] });
    a.dispatch({ type: 'revealTo', instanceId: second, seats: ['s1'] });
    await waitConverged([a, p.b]);
    await until(() => Object.hasOwn(p.b.secrets().received, second), 10_000, 'B to receive its card');
    await until(() => watching(dee, hashOf(a.engine.confirmedState())), 30_000, 'Dee to follow');
    expect(dee.session.secrets().received).toEqual({});
    const toDee = dee.session.engine.messages().filter((r) => r.dir === 'in' && r.channel === 'prv');
    expect(toDee).toEqual([]);
  });
});
