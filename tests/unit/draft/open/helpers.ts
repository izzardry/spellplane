/**
 * Fixtures for the open-format reducer tests (PLAN M2-P3). Tables are Magic tables (games/mtg, which has the `pack`
 * zone the pack-seed rounds run on) entered into the draft stage with core/drafting.ts `createDraftState`, as the
 * stage machine does; everything after that goes through actions.
 */
import { expect } from 'vitest';
import type { Action, ActionOf, ActionType } from '../../../../src/core/actions';
import { makeCommitments, nonceHash, type RevealedCard } from '../../../../src/core/commit';
import { createDraftState } from '../../../../src/core/drafting';
import { createTable, explain, reduce } from '../../../../src/core/reducer';
import { orderHash } from '../../../../src/core/rng';
import type { DraftFormatSettings, DraftState, Format, LobbySettings, SeatId, TableState } from '../../../../src/core/types';
import { mtg } from '../../../../src/games/index';

let cid = 0;

export function act<T extends ActionType>(type: T, fields: Omit<ActionOf<T>, 'type' | 'by' | 'cid'>, by: SeatId): ActionOf<T> {
  return { type, by, cid: `o${++cid}`, ...fields } as unknown as ActionOf<T>;
}

/** Apply an action that must apply (fails with the reducer's reason otherwise). */
export function ok(state: TableState, action: Action): TableState {
  expect(explain(state, action), `${action.type} by ${action.by} should apply`).toBeNull();
  return reduce(state, action);
}

/** An action that must not apply: same state back, and the reason matches. */
export function no(state: TableState, action: Action, reason?: RegExp): string {
  expect(reduce(state, action), `${action.type} by ${action.by} should not apply`).toBe(state);
  const why = explain(state, action);
  expect(why).not.toBeNull();
  if (reason) expect(why).toMatch(reason);
  return why ?? '';
}

/** Whether the action applies (no assertion). */
export function applies(state: TableState, action: Action): boolean {
  return explain(state, action) === null;
}

const NAMES = ['Anna', 'Ben', 'Cleo', 'Dan'];
const FORMATS: Record<number, Format> = { 2: '1v1', 3: 'ffa3', 4: 'ffa4' };

/** A table of `seats` seats in the draft stage of `draft` (seat ids s0..s3). */
export function draftTable(seats: number, draft: DraftFormatSettings, sets: string[] = ['M19']): TableState {
  const t = createTable({ game: mtg, format: FORMATS[seats]!, seats: NAMES.slice(0, seats).map((name, i) => ({ name, colour: i })) });
  const lobby: LobbySettings = { draft, sets, pickTimer: false };
  const d = createDraftState(t, lobby, 0);
  return { ...t, stage: 'draft', lobby, draft: d! };
}

export function draftOf(state: TableState): DraftState {
  expect(state.draft).toBeDefined();
  return state.draft!;
}

let sidCounter = 0;

/** Run a pack-seed round (shuffleCommit with purpose 'pack' on the own pack zone, every other seat's nonce, shuffleDone); returns the state and the round id. */
export function sealPackSeed(state: TableState, seat: SeatId): { state: TableState; sid: string } {
  const sid = `${seat}-seed${++sidCounter}`;
  const nonce = `nonce-${sid}`;
  let s = ok(state, act('shuffleCommit', { sid, zone: `pack:${seat}`, h: nonceHash(nonce), purpose: 'pack' }, seat));
  for (const other of Object.keys(s.seats)) if (other !== seat) s = ok(s, act('shuffleNonce', { sid, nonce: `peer-${other}-${sid}` }, other));
  s = ok(s, act('shuffleDone', { sid, orderHash: orderHash([], nonce) }, seat));
  return { state: s, sid };
}

let packCounter = 0;

/** `n` pack cards with unique opaque ids (not sorted in pack order) and distinct identities. */
export function packCards(n: number, tag = `p${++packCounter}`): RevealedCard[] {
  return Array.from({ length: n }, (_, i) => ({ instanceId: `id-${tag}-${String((i * 7) % n).padStart(2, '0')}-${i}`, ref: { sid: `sid-${tag}-${i}` }, salt: `salt-${tag}-${i}` }));
}

/** The `packOpen` fields of `cards` (sorted ids and commitments; face up with the cards when `face` is 'up'). */
export function packOpenFields(packId: string, cards: readonly RevealedCard[], sid: string, number: number, set: string, face: 'up' | 'down'): Omit<ActionOf<'packOpen'>, 'type' | 'by' | 'cid'> {
  return {
    packId,
    commits: makeCommitments(cards),
    count: cards.length,
    instanceIds: cards.map((c) => c.instanceId).sort(),
    sid,
    number,
    set,
    ...(face === 'up' ? { public: true, cards: cards.map((c) => ({ ...c })) } : {}),
  };
}

/** Seal a pack seed for `seat` and open `cards` as pack `number`. */
export function openPack(state: TableState, seat: SeatId, cards: readonly RevealedCard[], number: number, face: 'up' | 'down', set = 'M19'): TableState {
  const sealed = sealPackSeed(state, seat);
  return ok(sealed.state, act('packOpen', packOpenFields(`pack-${sealed.sid}`, cards, sealed.sid, number, set, face), seat));
}

/** Seeded PRNG for scripted choices. */
export function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
