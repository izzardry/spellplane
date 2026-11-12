/**
 * Helpers of the M1-P7 resume and recovery simulations: real networked sessions (session/net.ts) on a LoopbackNetwork
 * under fake timers, through tests/sim/session/harness.ts.
 */
import { canonicalJson } from '../../../src/core/hash';
import { sha256Sync } from '../../../src/core/sha256';
import type { SeatId, TableState } from '../../../src/core/types';
import { memoryNonces } from '../../../src/session/nonces';
import { ROOM, settle, type Browser, type NetTable } from '../session/harness';

/**
 * The hash of a seat's hand as its owner holds it: the hand's opaque ids in the owner's order with their identities
 * (DESIGN "Data model and protocol", SecretStore). Same hand hash = same cards in the same order under the same ids.
 */
export function handHash(s: NetTable): string {
  const sec = s.secrets();
  return sha256Sync(canonicalJson(sec.hand.map((id) => [id, sec.identities[id] ?? null])));
}

/** The hash of the own library order with identities (the private part a reload must keep too). */
export function libraryHash(s: NetTable): string {
  const sec = s.secrets();
  return sha256Sync(canonicalJson(sec.libraryOrder.map((id) => [id, sec.identities[id] ?? null])));
}

/** The seat's non-token cards in public zones (what a recovery keeps on the table). */
export function publicCards(st: TableState, seat: SeatId): number {
  return Object.values(st.cards).filter((c) => c.owner === seat && c.isToken !== true && st.zones[c.zone]?.visibility === 'public').length;
}

/** The seat's non-token cards anywhere (its deck size while nothing was lost). */
export function deckCards(st: TableState, seat: SeatId): number {
  return Object.values(st.cards).filter((c) => c.owner === seat && c.isToken !== true).length;
}

/**
 * This browser loses its save of the room (cleared storage, DESIGN "Multiplayer architecture", Resume and failure
 * handling): the page is gone, the table record, log and secret store of the room are deleted, and so are the open-round
 * nonces of its local storage. The browser keeps its key pair (it rejoins its chair by key pair).
 */
export async function loseSave(b: Browser): Promise<void> {
  if (b.session) {
    await settle(b.session.whenSaved());
    b.session.leave();
    b.session = null;
  }
  await settle(b.stores.tables.deleteTable(ROOM));
  b.nonces = memoryNonces();
}
