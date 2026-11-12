/**
 * Pure draft rules shared by the reducer, the draft drivers and the HUD (DESIGN "Specification: card data, packs and
 * draft formats", Draft formats and pick timer; "Pre-game: draft, sealed and deck building"). Contracts: M2-C, which
 * implements the formulas the design states outright (pick timer, pass direction, set per pack, the initial draft
 * state). Stubs name their package: M2-P2 (pass draft and sealed: deadlines), M2-P3 (Rochester snake order).
 */
import { seatsInOrder } from './selectors';
import type { Deadline, DrafterId, DraftState, LobbySettings, SeatId, SetCode, TableState } from './types';

/** Pick timer constants (DESIGN "Specification: card data, packs and draft formats": 45 s for the first pick of a pack, 3 s less per pick, 10 s floor). */
export const PICK_TIMER = { firstMs: 45_000, stepMs: 3_000, floorMs: 10_000 } as const;

/** Pick timer length for a pack from which `picks` picks were already taken (DESIGN "Specification: card data, packs and draft formats", pick timer). */
export function pickTimerMs(picks: number): number {
  return Math.max(PICK_TIMER.floorMs, PICK_TIMER.firstMs - PICK_TIMER.stepMs * Math.max(0, Math.floor(picks)));
}

/** Pass direction of a round (DESIGN "Specification: card data, packs and draft formats": left for odd rounds, right for even rounds, counting from 1). */
export type PassDirection = 'left' | 'right';

/** Direction of 0-based round `round`: left, right, left, … (DESIGN "Pre-game", Booster draft: "direction alternates left, right, left"). */
export function passDirection(round: number): PassDirection {
  return round % 2 === 0 ? 'left' : 'right';
}

/**
 * The drafter a pack goes to from `from` in round `round` (DESIGN "Specification: card data, packs and draft formats":
 * "left" means to the next seat clockwise, i.e. the next higher seat index, wrapping). `drafters` is in seat order
 * (DraftState.drafters). Throws when `from` is not a drafter.
 */
export function passTarget(drafters: readonly DrafterId[], from: DrafterId, round: number): DrafterId {
  const i = drafters.indexOf(from);
  if (i < 0) throw new RangeError(`${from} is not drafting`);
  const n = drafters.length;
  const step = passDirection(round) === 'left' ? 1 : n - 1;
  return drafters[(i + step) % n]!;
}

/** The set of pack number `number` (0-based): `sets[number]`, or the last entry when the list is shorter (core/types.ts LobbySettings.sets). */
export function setForPack(sets: readonly SetCode[], number: number): SetCode {
  if (sets.length === 0) throw new RangeError('no set chosen');
  return sets[Math.min(Math.max(0, number), sets.length - 1)]!;
}

/** Seats that hold a player, in seat order (a chair with a name; DESIGN "Players, seats and formats", Seats). */
export function seatedInOrder(state: TableState): SeatId[] {
  return seatsInOrder(state).filter((id) => state.seats[id]!.name.trim() !== '');
}

/** The drafters of a table: teams (in order of their first seat) for the Two-Headed Giant formats, else the seated seats (DESIGN "Pre-game"). */
export function draftersOf(state: TableState, team: boolean): DrafterId[] {
  const seated = seatedInOrder(state);
  if (!team) return seated;
  const out: DrafterId[] = [];
  for (const s of seated) {
    const t = state.seats[s]!.team;
    if (t !== undefined && !out.includes(t)) out.push(t);
  }
  return out;
}

/**
 * The public draft state at the start of a draft (DESIGN "Specification: card data, packs and draft formats", Draft
 * formats, Setup column): no packs yet, empty queues and pools, round 0, the first drafter as Rochester opener, Winston
 * active seat and dealer, and grid first player. Null when the lobby plays constructed. The stage machine (M2-P7)
 * calls it on lobby → draft; the format reducers (M2-P2, M2-P3) fill it from there.
 */
export function createDraftState(state: TableState, lobby: LobbySettings, startSeq: number): DraftState | null {
  const settings = lobby.draft;
  if (settings === null) return null;
  const team = settings.format === 'teamDraft' || settings.format === 'teamSealed';
  const drafters = draftersOf(state, team);
  const queues: Record<DrafterId, string[]> = {};
  const pools: Record<DrafterId, number> = {};
  for (const d of drafters) {
    queues[d] = [];
    pools[d] = 0;
  }
  const first = seatedInOrder(state)[0] ?? '';
  const draft: DraftState = {
    settings: { ...settings },
    sets: [...lobby.sets],
    pickTimer: lobby.pickTimer,
    drafters,
    round: 0,
    packs: {},
    queues,
    pools,
    startSeq,
    done: false,
  };
  if (settings.format === 'rochester') draft.rochester = { pack: null, opener: first, turn: 0, opened: 0 };
  if (settings.format === 'winston') draft.winston = { stack: 0, piles: [0, 0, 0], active: first, pile: 0, dealer: first };
  if (settings.format === 'grid') draft.grid = { index: 0, cells: [], first, taken: [] };
  return draft;
}

/**
 * Rochester pick order for one pack (DESIGN "Specification: card data, packs and draft formats", Rochester: "snake order
 * starting with the opener: 1, 2, …, S, S, …, 2, 1, repeating"): one full cycle of 2·S seat ids starting at `opener`
 * and going left. Implementer: M2-P3.
 */
export function rochesterOrder(seats: readonly SeatId[], opener: SeatId): SeatId[] {
  const start = seats.indexOf(opener);
  if (start < 0) throw new RangeError(`${opener} is not drafting`);
  const n = seats.length;
  const there = Array.from({ length: n }, (_, i) => seats[(start + i) % n]!);
  return [...there, ...[...there].reverse()];
}

/**
 * The pick-timer deadlines of `state` (DESIGN "Specification: card data, packs and draft formats", pick timer;
 * "Specification: network protocol and secrecy", Timers): for each pack at the front of a queue while the draft's
 * pick timer is on, `pickTimerMs(pack.picks)` after `pack.sinceSeq`, emitting `draftTimeout`. Implementer: M2-P2
 * (returns none until then).
 */
export function draftDeadlines(_state: TableState): Deadline[] {
  return [];
}
