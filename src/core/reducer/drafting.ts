/**
 * Dispatch of the draft actions to their format's reducer, and the lobby settings (DESIGN "Specification: card data,
 * packs and draft formats", Draft formats; "Pre-game: draft, sealed and deck building", Lobby settings). Contracts:
 * M2-C. The format reducers are M2-P2's (core/reducer/pass.ts) and M2-P3's (core/reducer/open.ts); nobody else
 * edits this file within M2.
 */
import type { ActionOf } from '../actions';
import { hostSeat, lobbyProblem } from '../stage';
import type { DraftFormat, LobbySettings } from '../types';
import type { Draft } from './draft';
import * as open from './open';
import * as pass from './pass';
import { reject } from './util';

/** Formats whose packs travel hidden from drafter to drafter (core/reducer/pass.ts); the rest are the open formats (core/reducer/open.ts). */
const HIDDEN_PACK_FORMATS: ReadonlySet<DraftFormat> = new Set<DraftFormat>(['pass', 'sealed', 'teamDraft', 'teamSealed']);

/** Whether the current draft (if any) is one of the hidden-pack formats; with no draft the pass reducer explains. */
function hiddenPacks(d: Draft): boolean {
  const f = d.draft?.settings.format;
  return f === undefined || HIDDEN_PACK_FORMATS.has(f);
}

export function packOpen(d: Draft, a: ActionOf<'packOpen'>): void {
  if (hiddenPacks(d)) pass.packOpen(d, a);
  else open.packOpen(d, a);
}

export function pick(d: Draft, a: ActionOf<'pick'>): void {
  if (hiddenPacks(d)) pass.pick(d, a);
  else open.pick(d, a);
}

export function packPass(d: Draft, a: ActionOf<'packPass'>): void {
  pass.packPass(d, a);
}

export function draftTimeout(d: Draft, a: ActionOf<'draftTimeout'>): void {
  pass.draftTimeout(d, a);
}

export function pileLook(d: Draft, a: ActionOf<'pileLook'>): void {
  open.pileLook(d, a);
}

export function gridTake(d: Draft, a: ActionOf<'gridTake'>): void {
  open.gridTake(d, a);
}

/**
 * `lobbySet`: the host replaces the lobby settings while the table is in the lobby (DESIGN "Pre-game", Lobby settings;
 * "Specification: card data, packs and draft formats", Evening stages: the host advances from lobby). Settings are
 * checked structurally (core/stage.ts lobbyProblem) and stored as a fresh copy.
 */
export function lobbySet(d: Draft, a: ActionOf<'lobbySet'>): void {
  if (d.base.stage !== 'lobby') reject('lobby settings change only in the lobby');
  const host = hostSeat(d.base);
  if (host === null || a.by !== host) reject('only the host changes the lobby settings');
  const problem = lobbyProblem(a.lobby);
  if (problem !== null) reject(problem);
  d.setLobby(structuredClone(a.lobby) as LobbySettings);
}
