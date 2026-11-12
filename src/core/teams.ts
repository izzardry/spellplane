/**
 * Teams, formats and spectators (DESIGN "Players, seats and formats": formats, Two-Headed Giant, Spectators;
 * "Data model and protocol": `teams?: Record<TeamId, SeatId[]>`, `turn.active: SeatId | TeamId`). Contracts: M3-C.
 *
 * The shared shapes already exist since M0: `Team` (core/types.ts) holds a Two-Headed Giant team's seats, its ONE
 * shared life total and its counters, and `TurnState.active` names a team id when the format has teams, so the turn
 * and phase marker is shared by both teammates. This module adds the format facts (seats and teams per format), the
 * spectator id, the reveal targets and small pure selectors over them.
 *
 * Owners: M3-P2 (Two-Headed Giant: team reveal target, teammate hand, team draft) owns this file; M3-P1 owns
 * `TABLE_FORMAT_SEATS`/`TABLE_FORMAT_TEAMS` use in the `formatSet` reducer (core/reducer/format.ts); M3-P5 owns the spectator part.
 * Pure: no DOM, clock, randomness or network.
 */
import type { DraftState, Format, SeatId, TableState, Team, TeamId } from './types';
import { seatIdOf } from './ids';

/** Seats per format (DESIGN "Players, seats and formats", Seats column: 2, 3, 4, 2 + 2). */
export const TABLE_FORMAT_SEATS: Readonly<Record<Format, number>> = { '1v1': 2, ffa3: 3, ffa4: 4, '2hg': 4 };

/**
 * The teams of a format by seat index, or null for a format without teams (DESIGN "Players, seats and formats":
 * Two-Headed Giant is "2 + 2", teammates side by side on one long edge; "Specification: geometry, layout and motion",
 * Tables and seats: seat angles 0°, 0°, 180°, 180°). Team i gets id `teamIdOf(i)`; DECISIONS [M3-C].
 */
export const TABLE_FORMAT_TEAMS: Readonly<Record<Format, readonly (readonly number[])[] | null>> = {
  '1v1': null,
  ffa3: null,
  ffa4: null,
  '2hg': [
    [0, 1],
    [2, 3],
  ],
};

/** Team id for a team index, as the `formatSet` reducer and the lobby create them: 't0', 't1' (DESIGN "Players, seats and formats", Two-Headed Giant). */
export function teamIdOf(index: number): TeamId {
  return `t${index}`;
}

/** Whether a format plays in teams with shared life and turn (DESIGN "Players, seats and formats": Life and Turn marker columns). */
export function isTeamFormat(format: Format): boolean {
  return TABLE_FORMAT_TEAMS[format] !== null;
}

/** The seat ids of each team of a format, team index order (DESIGN "Players, seats and formats", Two-Headed Giant); [] without teams. */
export function formatTeamSeats(format: Format): SeatId[][] {
  return (TABLE_FORMAT_TEAMS[format] ?? []).map((t) => t.map(seatIdOf));
}

const own = <T>(rec: Readonly<Record<string, T>>, key: string): T | undefined => (Object.hasOwn(rec, key) ? rec[key] : undefined);

/** The team of a seat, or null (DESIGN "Players, seats and formats", Two-Headed Giant). */
export function teamOf(state: TableState, seat: SeatId): Team | null {
  const t = own(state.seats, seat)?.team;
  return t === undefined ? null : (own(state.teams, t) ?? null);
}

/** The other seats of a seat's team, seat order; [] without a team (DESIGN "Players, seats and formats": each teammate's hand is visible live to the other). */
export function teammatesOf(state: TableState, seat: SeatId): SeatId[] {
  return (teamOf(state, seat)?.seats ?? []).filter((s) => s !== seat);
}

/** Whether two seats play on the same team (DESIGN "Players, seats and formats", Two-Headed Giant). */
export function sameTeam(state: TableState, a: SeatId, b: SeatId): boolean {
  const t = teamOf(state, a);
  return t !== null && t.seats.includes(b);
}

/**
 * The seats whose turn it is: the active seat, or both seats of the active team (DESIGN "Players, seats and formats":
 * one shared turn and phase marker per team; "Chat and voice", Turn mic: "In Two-Headed Giant the active team's mics
 * open"). Seat order.
 */
export function activeSeats(state: TableState): SeatId[] {
  const active = state.turn.active;
  const team = own(state.teams, active);
  if (team) return [...team.seats];
  return own(state.seats, active) ? [active] : [];
}

/** Whether it is `seat`'s turn, alone or with its team (DESIGN "Chat and voice", Turn mic). */
export function isSeatActive(state: TableState, seat: SeatId): boolean {
  return activeSeats(state).includes(seat);
}

// ---------------------------------------------------------------------------------------------------------------------
// Spectators (DESIGN "Players, seats and formats", Spectators: join by the same link without taking a chair, see only
// public zones, chat and ping, cannot move cards; a player may reveal their hand to a named spectator).
// ---------------------------------------------------------------------------------------------------------------------

/**
 * A spectator's id, `v:<peerId>` (peer id = first 16 hex of SHA-256 of the public key) (DESIGN "Players, seats and
 * formats", Spectators). It is the `by` of a spectator's actions (chat, ping) and the target of a reveal to a named
 * spectator; it is never a key of `TableState.seats` and owns no zone. DECISIONS [M3-C].
 */
export type SpectatorId = string;

/** Prefix of every spectator id (DESIGN "Players, seats and formats", Spectators). */
export const SPECTATOR_ID_PREFIX = 'v:';

/** The spectator id of a peer (DESIGN "Players, seats and formats", Spectators). */
export function spectatorIdOf(peerId: string): SpectatorId {
  return `${SPECTATOR_ID_PREFIX}${peerId}`;
}

/** Whether an id names a spectator rather than a seat (DESIGN "Players, seats and formats", Spectators). */
export function isSpectatorId(id: string): id is SpectatorId {
  return id.startsWith(SPECTATOR_ID_PREFIX) && id.length > SPECTATOR_ID_PREFIX.length;
}

/** The peer id inside a spectator id, or null when it is not one (DESIGN "Players, seats and formats", Spectators). */
export function peerOfSpectator(id: string): string | null {
  return isSpectatorId(id) ? id.slice(SPECTATOR_ID_PREFIX.length) : null;
}

// ---------------------------------------------------------------------------------------------------------------------
// Reveal targets (DESIGN "Multiplayer architecture", Hidden information 5: "Showing a card to one player or to a
// teammate sends the card id and salt on that pair's channel only"; "Players, seats and formats", Spectators).
// ---------------------------------------------------------------------------------------------------------------------

/**
 * Whom a targeted reveal goes to (DESIGN "Multiplayer architecture", Targeted reveal; "Players, seats and formats":
 * Two-Headed Giant team reveal, reveal to a named spectator). A team target expands to that team's seats except the
 * revealer; the public `revealTo` action then lists the seats (and `spectators`), never the team.
 */
export type RevealTarget = { kind: 'seat'; seat: SeatId } | { kind: 'team'; team: TeamId } | { kind: 'spectator'; spectator: SpectatorId };

/**
 * The seats and spectators a reveal by `by` to `target` reaches (DESIGN "Multiplayer architecture", Targeted reveal).
 * Unknown seats and teams yield none; the revealer itself is never listed. Seat order within a team.
 */
export function revealRecipients(state: TableState, by: SeatId, target: RevealTarget): { seats: SeatId[]; spectators: SpectatorId[] } {
  switch (target.kind) {
    case 'seat':
      return { seats: own(state.seats, target.seat) && target.seat !== by ? [target.seat] : [], spectators: [] };
    case 'team':
      return { seats: (own(state.teams, target.team)?.seats ?? []).filter((s) => s !== by), spectators: [] };
    case 'spectator':
      return { seats: [], spectators: isSpectatorId(target.spectator) ? [target.spectator] : [] };
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Two-Headed Giant draft and sealed (DESIGN "Pre-game: draft, sealed and deck building", mode table: Two-Headed Giant
// draft "Teams pick two cards per pack into a shared team pool; 6 packs per team", "Team sees its own packs and pool";
// Two-Headed Giant sealed "8 packs per team, shared pool"; "Specification: card data, packs and draft formats", Draft
// formats: "A team shares each pack and pool; the team picks 2 cards per pass; passing goes team to team, alternating
// direction per round … After 3 rounds"). Added by M3-P2; read by core/reducer/pass.ts and draft/team.ts.
//
// The drafter is the team (DraftState.drafters lists team ids). Every teammate opens packs for the team: in a draft
// each member opens one pack per round until the team has opened its `packs` (6 packs and two members: 3 rounds), in
// sealed member j opens the team's packs j, j + m, j + 2m, … (m members). DECISIONS [M3-P2].
// ---------------------------------------------------------------------------------------------------------------------

/** The seated members of team `team` in seat order: the seats whose `team` it is and that hold a player. */
export function teamMembers(state: TableState, team: TeamId): SeatId[] {
  return Object.values(state.seats)
    .filter((s) => s.team === team && s.name.trim() !== '')
    .sort((a, b) => a.index - b.index)
    .map((s) => s.id);
}

/**
 * The drafting members of team `team` in a Two-Headed Giant draft or sealed (`draft`), in seat order: the seats of the
 * team that hold a player or that opened a pack of this draft. A player who leaves the chair after opening a pack keeps
 * the place, so the member count and each member's opening duties and set slots stay as they were (the draft waits for
 * the chair, as a pass draft waits for a drafter). DECISIONS [M3-P2].
 */
export function draftMembers(state: TableState, draft: DraftState, team: TeamId): SeatId[] {
  const openers = new Set<SeatId>();
  for (const p of Object.values(draft.packs)) openers.add(p.opener);
  return Object.values(state.seats)
    .filter((s) => s.team === team && (s.name.trim() !== '' || openers.has(s.id)))
    .sort((a, b) => a.index - b.index)
    .map((s) => s.id);
}

/** The team a seat drafts for, or null (a seat without a team, or a team that is not drafting). */
export function draftTeamOf(state: TableState, seat: SeatId): TeamId | null {
  const t = own(state.seats, seat)?.team;
  if (t === undefined) return null;
  const d = state.draft;
  return d !== undefined && d.drafters.includes(t) ? t : null;
}

/** Rounds of a Two-Headed Giant draft of `packs` packs per team with `members` members: each member opens one pack per round. */
export function teamDraftRounds(packs: number, members: number): number {
  return members <= 0 ? 0 : Math.ceil(packs / members);
}

/** Whether member `j` (index in `draftMembers`) of a team of `members` opens a pack in round `round` (the team's `packs` are not all open yet). */
export function opensInRound(packs: number, members: number, j: number, round: number): boolean {
  return j >= 0 && j < members && round >= 0 && round * members + j < packs;
}

/**
 * The team pack index of the pack member `j` of `members` opens in round `round` of a Two-Headed Giant draft:
 * round · members + j. The lobby's set list is per team pack ("set per pack", "6 packs per team"), as in sealed.
 */
export function teamDraftPackIndex(members: number, j: number, round: number): number {
  return round * members + j;
}

/** How many packs a Two-Headed Giant draft's round `round` holds over all teams (`members` per team, in team order). */
export function packsInRound(packs: number, members: readonly number[], round: number): number {
  let n = 0;
  for (const m of members) for (let j = 0; j < m; j++) if (opensInRound(packs, m, j, round)) n++;
  return n;
}

/** The team pack numbers member `j` of `members` opens in Two-Headed Giant sealed, in order: j, j + m, j + 2m, … below `packs`. */
export function teamSealedNumbers(packs: number, members: number, j: number): number[] {
  const out: number[] = [];
  if (j < 0 || j >= members) return out;
  for (let n = j; n < packs; n += members) out.push(n);
  return out;
}
