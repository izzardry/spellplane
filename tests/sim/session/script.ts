/**
 * The scripted two-seat game of the M1-P8 acceptance and leak tests (DESIGN "Multiplayer architecture", Hidden
 * information; "Specification: network protocol and secrecy"): both take chairs, both Ready with a fixture deck, both
 * shuffle with each other's nonces and draw seven, A mulligans and bottoms a card, A scries one to the bottom, A plays
 * a land and casts a spell (each revealed first), A shows a hand card to B only, A plays a card face down, A rolls a
 * die (commit and reveal by both), A returns its land to the hand (fresh hand ids), B draws and plays a land.
 */
import { expect } from 'vitest';
import type { InstanceId } from '../../../src/core/types';
import type { LoopbackNetwork } from '../../../src/net/loopback';
import type { Disclosure } from '../../leak/leak';
import { browser, fixtureDeck, open, settle, trackDisclosures, typeOf, until, waitConverged, type Browser, type NetTable } from './harness';

export const isLand = (sid: string): boolean => /\bLand\b/.test(typeOf(sid));

export interface Played {
  A: Browser;
  B: Browser;
  a: NetTable;
  b: NetTable;
  /** What A deliberately showed B (A's side). */
  shownToB: Disclosure[];
  land: InstanceId;
  spell: InstanceId;
  shown: InstanceId;
  faceDown: InstanceId;
  roll: number;
  hash: string;
}

/** Play the script on `network`; `browsers` receives the browsers as they are created (for cleanup). */
export async function playScript(network: LoopbackNetwork, browsers: Browser[]): Promise<Played> {
  const A = await browser('anna', 'peer-a', 'Anna', 2);
  const B = await browser('ben', 'peer-b', 'Ben', 5);
  browsers.push(A, B);
  const a = await open(network, A);
  const b = await open(network, B);
  await waitConverged([a, b], 'both seated');
  const shownToB = trackDisclosures(a, 's1');

  await settle(a.importDeck(await fixtureDeck('gw-m19-60.txt')), 30_000, 'A ready');
  await settle(b.importDeck(await fixtureDeck('ur-m19-60.mtga.txt')), 30_000, 'B ready');
  await settle(Promise.all([a.shuffle(), b.shuffle()]), 60_000, 'both shuffles');
  await settle(a.draw(7));
  await settle(b.draw(7));
  await waitConverged([a, b], 'opening hands');

  await settle(a.mulligan(), 60_000, 'the mulligan');
  a.dispatch({ type: 'toZone', card: a.secrets().hand[0]!, to: 'library:s0', position: 'bottom' });
  const [seen] = await settle(a.lookAt('library:s0', 1));
  a.dispatch({ type: 'toZone', card: seen!.id, to: 'library:s0', position: 'bottom' });
  expect(a.secrets().libraryOrder.at(-1)).toBe(seen!.id);
  await waitConverged([a, b], 'the scry');

  const sidOf = (id: InstanceId): string => a.secrets().identities[id]!.card.sid;
  const hand = (): InstanceId[] => a.secrets().hand;
  for (let i = 0; i < 20 && (!hand().some((id) => isLand(sidOf(id))) || hand().filter((id) => !isLand(sidOf(id))).length < 3); i++) await settle(a.draw(1));
  const land = hand().find((id) => isLand(sidOf(id)))!;
  const [spell, shown, faceDown] = hand().filter((id) => !isLand(sidOf(id))) as [InstanceId, InstanceId, InstanceId];

  a.dispatch({ type: 'move', card: land, to: 'battlefield:s0', pose: { x: 0, y: -200, rot: 0 } });
  a.dispatch({ type: 'stackPush', item: 'si-1', kind: 'spell', card: spell, controller: 's0' });
  a.dispatch({ type: 'revealTo', instanceId: shown, seats: ['s1'] });
  a.playFaceDown(faceDown, 'battlefield:s0', { x: 70, y: -200, rot: 0 });
  await waitConverged([a, b], 'the plays');
  await until(() => Object.hasOwn(b.secrets().received, shown), 10_000, 'B to receive the targeted reveal');

  const roll = await settle(a.roll('die', 6), 60_000, 'the roll');
  await waitConverged([a, b], 'the roll');

  a.dispatch({ type: 'toZone', card: land, to: 'hand:s0', position: 'any' });
  await until(() => a.engine.confirmedState().cards[land] === undefined && a.engine.pending().length === 0, 20_000, 'the re-issue of A’s hand');
  await settle(b.draw(1));
  const bLand = b.secrets().hand.find((id) => isLand(b.secrets().identities[id]!.card.sid)) ?? b.secrets().hand[0]!;
  b.dispatch({ type: 'move', card: bLand, to: 'battlefield:s1', pose: { x: 0, y: 200, rot: 180 } });

  const hash = await waitConverged([a, b], 'the end of the script');
  await settle(Promise.all([a.whenSaved(), b.whenSaved()]));
  return { A, B, a, b, shownToB, land, spell, shown, faceDown, roll, hash };
}
