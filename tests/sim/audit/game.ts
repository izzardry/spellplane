/**
 * The scripted game of the audit simulations (PLAN M5-P2): Anna (s0) and Ben (s1) on a LoopbackNetwork, real networked
 * sessions under fake timers, constructed fixture decks. The game covers every record the audit replays (DESIGN
 * "Specification: network protocol and secrecy", Secret shuffle, private reorder, draws):
 * - both shuffle with each other's nonces and draw seven; Anna mulligans (hand into the library, shuffle, seven);
 * - Anna puts a hand card at the bottom of her library and scries one card to the bottom (a private reorder);
 * - Ben draws, undoes the draw (the card goes back on top) and draws again;
 * - Anna plays a land, returns it to her hand (her hand gets fresh ids: a reorder with a re-issue), plays a land again
 *   and puts it on top of her library, then shuffles (fresh library ids: a shuffle with a re-issue) and draws two;
 * - Anna searches her library and puts a card from deep inside on top (a private reorder of one card), draws it.
 * `beforeEnd` runs before the game ends; `endGame` ends it with "Next game" (Anna asks, Ben confirms).
 */
import { expect } from 'vitest';
import type { InstanceId, SeatId } from '../../../src/core/types';
import type { LoopbackNetwork } from '../../../src/net/loopback';
import { both, seatedPair, stageIs, type Evening } from '../flow/evening';
import { fixtureDeck, settle, typeOf, until, waitConverged, type Browser, type NetTable } from '../session/harness';

export const isLand = (sid: string): boolean => /\bLand\b/.test(typeOf(sid));

export interface Game extends Evening {
  a: NetTable;
  b: NetTable;
}

/** Seat both, Ready with the fixture decks, start the match, shuffle and draw the opening hands. */
export async function startGame(network: LoopbackNetwork, browsers: Browser[]): Promise<Game> {
  const e = await seatedPair(network, browsers);
  const [a, b] = both(e) as [NetTable, NetTable];
  a.evening!.setLobby({ draft: null, sets: ['M19'], pickTimer: false });
  await settle(a.importDeck(await fixtureDeck('gw-m19-60.txt')), 30_000, 'Anna ready');
  await settle(b.importDeck(await fixtureDeck('ur-m19-60.mtga.txt')), 30_000, 'Ben ready');
  a.evening!.start();
  await stageIs(e, 'match');
  await settle(Promise.all([a.shuffle(), b.shuffle()]), 60_000, 'both shuffles');
  await settle(a.draw(7));
  await settle(b.draw(7));
  await waitConverged([a, b], 'opening hands');
  return { ...e, a, b };
}

const landIn = (s: NetTable): InstanceId | undefined => s.secrets().hand.find((id) => isLand(s.secrets().identities[id]!.card.sid));

/** The middle of the game (see the module comment). */
export async function playMiddle(g: Game): Promise<void> {
  const { a, b } = g;
  await settle(a.mulligan(), 60_000, 'the mulligan');
  a.dispatch({ type: 'toZone', card: a.secrets().hand[0]!, to: 'library:s0', position: 'bottom' });
  const [seen] = await settle(a.lookAt('library:s0', 1));
  a.dispatch({ type: 'toZone', card: seen!.id, to: 'library:s0', position: 'bottom' });
  expect(a.secrets().libraryOrder.at(-1)).toBe(seen!.id);
  await waitConverged([a, b], 'the scry');

  await settle(b.draw(1));
  await waitConverged([a, b], 'Ben’s draw');
  const drawn = b.secrets().hand.at(-1)!;
  expect(b.undo()).toBe(true);
  await waitConverged([a, b], 'the undone draw');
  expect(b.secrets().libraryOrder[0]).toBe(drawn);
  await settle(b.draw(1));
  await waitConverged([a, b], 'Ben’s draw again');

  for (let i = 0; i < 20 && landIn(a) === undefined; i++) await settle(a.draw(1));
  const land = landIn(a)!;
  a.dispatch({ type: 'move', card: land, to: 'battlefield:s0', pose: { x: 0, y: -200, rot: 0 } });
  await waitConverged([a, b], 'the land');
  a.dispatch({ type: 'toZone', card: land, to: 'hand:s0', position: 'any' });
  await until(() => a.engine.confirmedState().cards[land] === undefined && a.engine.pending().length === 0, 20_000, 'the re-issue of Anna’s hand');
  await waitConverged([a, b], 'the hand re-issue');
  const again = landIn(a)!;
  a.dispatch({ type: 'move', card: again, to: 'battlefield:s0', pose: { x: 0, y: -200, rot: 0 } });
  await waitConverged([a, b], 'the land again');
  a.dispatch({ type: 'toZone', card: again, to: 'library:s0', position: 'top' });
  await waitConverged([a, b], 'the land on top');
  await settle(a.shuffle(), 60_000, 'Anna’s second shuffle');
  await waitConverged([a, b], 'the second shuffle');
  await settle(a.draw(2));

  const size = a.secrets().libraryOrder.length;
  const all = await settle(a.lookAt('library:s0', size));
  expect(all).toHaveLength(size);
  const deep = all[Math.floor(size / 2)]!.id;
  a.dispatch({ type: 'toZone', card: deep, to: 'library:s0', position: 'top' });
  expect(a.secrets().libraryOrder[0]).toBe(deep);
  await settle(a.draw(1));
  await waitConverged([a, b], 'the end of the middle');
  await settle(Promise.all([a.whenSaved(), b.whenSaved()]));
}

/** "Next game": `asker` proposes, the other confirms; the table goes back to the builder. */
export async function endGame(g: Game, asker: SeatId = 's0'): Promise<void> {
  const [ask, other] = asker === 's0' ? [g.a, g.b] : [g.b, g.a];
  const proposal = ask.evening!.propose('nextGame');
  await until(() => other.engine.confirmedState().confirm?.label === 'Next game?', 10_000, 'the proposal');
  other.dispatch({ type: 'respond', round: other.engine.confirmedState().confirm!.id, seat: other.seat, response: 'ok' });
  expect(await settle(proposal, 30_000, 'the next game')).toBe(true);
  await stageIs(g, 'build');
}

/** Wait until `sessions` all hold a verdict for every seat of `game`. */
export async function verdictsIn(sessions: readonly NetTable[], game = 1, seats = 2, maxMs = 60_000): Promise<void> {
  await until(() => sessions.every((s) => s.audit!.verdicts().filter((v) => v.game === game).length === seats), maxMs, `the verdicts of game ${game}`);
}

/** The verdict on `seat` in `game` as `s` computed it. */
export function verdictOf(s: NetTable, seat: SeatId, game = 1) {
  return s.audit!.verdicts().find((v) => v.seat === seat && v.game === game) ?? null;
}
