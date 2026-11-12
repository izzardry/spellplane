/**
 * Fixtures for the Two-Headed Giant tests (PLAN M3-P2): a Magic table in the '2hg' format with teams t0 = s0 + s1 and
 * t1 = s2 + s3 (core/teams.ts TABLE_FORMAT_TEAMS), entered into the draft stage with core/drafting.ts
 * `createDraftState`, as the stage machine does; everything after that goes through actions.
 */
import { nonceHash, type RevealedCard } from '../../../src/core/commit';
import { createDraftState } from '../../../src/core/drafting';
import { createTable } from '../../../src/core/reducer';
import { orderHash } from '../../../src/core/rng';
import { formatTeamSeats, teamIdOf } from '../../../src/core/teams';
import type { DraftFormatSettings, LobbySettings, SeatId, TableState } from '../../../src/core/types';
import { mtg } from '../../../src/games/index';
import { act, ok, packOpenFields } from '../draft/open/helpers';

export const NAMES = ['Anna', 'Ben', 'Cleo', 'Dan'];

/** A seated Two-Headed Giant table in the lobby: Anna and Ben are team t0, Cleo and Dan team t1. */
export function teamTable(): TableState {
  const teamOfSeat = new Map<number, string>();
  formatTeamSeats('2hg').forEach((seats, t) => seats.forEach((s) => teamOfSeat.set(Number(s.slice(1)), teamIdOf(t))));
  return createTable({ game: mtg, format: '2hg', seats: NAMES.map((name, i) => ({ name, colour: i, team: teamOfSeat.get(i)!, peer: `p${i}` })) });
}

/** The Two-Headed Giant table in the draft stage of `draft`. */
export function teamDraftTable(draft: DraftFormatSettings, sets: string[] = ['M19'], pickTimer = false): TableState {
  const t = teamTable();
  const lobby: LobbySettings = { draft, sets, pickTimer };
  return { ...t, stage: 'draft', lobby, draft: createDraftState(t, lobby, 0)! };
}

let packCounter = 0;

/** `n` pack cards with unique opaque ids and distinct identities. */
export function cards(n: number, tag = `t${++packCounter}`): RevealedCard[] {
  return Array.from({ length: n }, (_, i) => ({ instanceId: `id-${tag}-${String(i).padStart(2, '0')}`, ref: { sid: `sid-${tag}-${i}` }, salt: `salt-${tag}-${i}` }));
}

let sidCounter = 0;

/** A sealed pack-seed round of `seat` with a nonce from every other seated player (a free chair gives none). */
export function sealPackSeed(state: TableState, seat: SeatId): { state: TableState; sid: string } {
  const sid = `${seat}-tseed${++sidCounter}`;
  const nonce = `nonce-${sid}`;
  let s = ok(state, act('shuffleCommit', { sid, zone: `pack:${seat}`, h: nonceHash(nonce), purpose: 'pack' }, seat));
  for (const other of Object.values(s.seats)) if (other.id !== seat && other.name.trim() !== '') s = ok(s, act('shuffleNonce', { sid, nonce: `peer-${other.id}-${sid}` }, other.id));
  s = ok(s, act('shuffleDone', { sid, orderHash: orderHash([], nonce) }, seat));
  return { state: s, sid };
}

/** Seal a pack seed for `seat` and open `list` face down as pack `number`; returns the state and the pack id. */
export function open(state: TableState, seat: SeatId, list: readonly RevealedCard[], number: number, set = 'M19'): { state: TableState; packId: string } {
  const sealed = sealPackSeed(state, seat);
  const packId = `pack-${sealed.sid}`;
  return { state: ok(sealed.state, act('packOpen', packOpenFields(packId, list, sealed.sid, number, set, 'down'), seat)), packId };
}
