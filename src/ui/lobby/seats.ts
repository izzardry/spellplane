/**
 * Chair and seat-colour rules of the lobby (DESIGN "Players, seats and formats", Seats: the table from above with
 * empty chairs, players click a chair and pick a seat colour; Identity: nickname plus key pair; "Specification:
 * card data, packs and draft formats", Evening stages: the host advances from the lobby). Pure functions over the
 * shared TableState, so every browser draws the same chairs. Implementer: M1-P5.
 */
import type { SeatColourIndex, SeatId, TableState } from '../../core/types';

/** Seat colours a theme provides (DESIGN "Themes and rendering": eight seat colours). */
export const SEAT_COLOURS = 8;
/** Longest nickname the lobby accepts (the reducer allows 64; 24 keeps avatars and log lines readable). */
export const NICKNAME_MAX = 24;

/** One chair as the lobby draws it. */
export interface Chair {
  seat: SeatId;
  index: number;
  /** '' for a free chair. */
  name: string;
  colour: SeatColourIndex;
  occupied: boolean;
  /** Held by this browser's key pair. */
  mine: boolean;
  ready: boolean;
  away: boolean;
  /** Identity peer id of the holder, if any. */
  peer: string | null;
}

/** A seat somebody has taken: it has a holder's peer id or a name (DESIGN "Players, seats and formats"). */
export function isOccupied(state: TableState, seat: SeatId): boolean {
  const s = state.seats[seat];
  return !!s && (s.peer !== undefined || s.name.trim() !== '');
}

/** The chairs in seat-index order. */
export function chairs(state: TableState, selfPeer: string): Chair[] {
  return Object.values(state.seats)
    .sort((a, b) => a.index - b.index)
    .map((s) => {
      const occupied = isOccupied(state, s.id);
      return {
        seat: s.id,
        index: s.index,
        name: occupied ? s.name : '',
        colour: s.colour,
        occupied,
        mine: s.peer !== undefined && s.peer === selfPeer,
        ready: occupied && s.ready,
        away: occupied && !!s.away,
        peer: s.peer ?? null,
      };
    });
}

/** The chair this key pair holds, or null. */
export function seatOf(state: TableState, peer: string): SeatId | null {
  return Object.values(state.seats).find((s) => s.peer !== undefined && s.peer === peer)?.id ?? null;
}

/** The free chair with the lowest index, or null when the table is full. */
export function firstFreeChair(state: TableState): SeatId | null {
  return (
    Object.values(state.seats)
      .sort((a, b) => a.index - b.index)
      .find((s) => !isOccupied(state, s.id))?.id ?? null
  );
}

/**
 * Whether this browser may sit in `seat` now: the chair must exist, be free (or already its own), the game must still
 * be in the lobby, and a player who pressed Ready stays put (the deck commitment and library belong to the chair).
 */
export function chairChoice(state: TableState, seat: SeatId, selfPeer: string): { ok: true } | { ok: false; reason: string } {
  const s = state.seats[seat];
  if (!s) return { ok: false, reason: 'There is no such chair.' };
  if (state.stage !== 'lobby') return { ok: false, reason: 'The game has started.' };
  const mine = seatOf(state, selfPeer);
  if (mine === seat) return { ok: true };
  if (isOccupied(state, seat)) return { ok: false, reason: `${s.name || 'Someone'} sits here.` };
  if (mine && state.seats[mine]?.ready) return { ok: false, reason: 'You are ready; your deck is locked to your chair.' };
  return { ok: true };
}

/**
 * Seat colours are unique at a table, so cursors, lines, pings and log names stay apart (M1-P5 decision). The
 * colour `colour` is taken when another occupied seat uses it.
 */
export function colourTakenBy(state: TableState, colour: SeatColourIndex, forSeat: SeatId | null): SeatId | null {
  for (const s of Object.values(state.seats)) {
    if (s.id !== forSeat && isOccupied(state, s.id) && s.colour === colour) return s.id;
  }
  return null;
}

/** Colours `forSeat` may pick, ascending. */
export function freeColours(state: TableState, forSeat: SeatId | null): SeatColourIndex[] {
  const out: SeatColourIndex[] = [];
  for (let c = 0; c < SEAT_COLOURS; c++) if (colourTakenBy(state, c, forSeat) === null) out.push(c);
  return out;
}

/** The preferred colour when it is free for `forSeat`, else the lowest free one (the preferred one if none is free). */
export function pickColour(state: TableState, forSeat: SeatId | null, preferred: SeatColourIndex): SeatColourIndex {
  const valid = Number.isInteger(preferred) && preferred >= 0 && preferred < SEAT_COLOURS ? preferred : 0;
  const free = freeColours(state, forSeat);
  return free.includes(valid) ? valid : (free[0] ?? valid);
}

/**
 * Two players who picked the same colour at once: the seat with the higher index gives way and moves to a free colour
 * (deterministic, so both browsers agree on who changes). Returns the colour `seat` should switch to, or null.
 */
export function colourClash(state: TableState, seat: SeatId): SeatColourIndex | null {
  const me = state.seats[seat];
  if (!me || !isOccupied(state, seat)) return null;
  const clash = Object.values(state.seats).some((s) => s.id !== seat && isOccupied(state, s.id) && s.colour === me.colour && s.index < me.index);
  if (!clash) return null;
  const free = freeColours(state, seat).filter((c) => colourTakenBy(state, c, seat) === null && c !== me.colour);
  return free[0] ?? null;
}

/** A trimmed nickname, whitespace runs collapsed and control characters removed. */
export function normaliseNickname(name: string): string {
  // eslint-disable-next-line no-control-regex
  return name.replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim();
}

/** Why a nickname cannot be used, or null when it can. */
export function nicknameProblem(name: string): string | null {
  const n = normaliseNickname(name);
  if (n === '') return 'Enter a nickname.';
  if ([...n].length > NICKNAME_MAX) return `Use at most ${NICKNAME_MAX} characters.`;
  return null;
}

/** Seated players and how many of them pressed Ready. */
export function readiness(state: TableState): { seated: number; ready: number; allReady: boolean } {
  const seated = Object.values(state.seats).filter((s) => isOccupied(state, s.id));
  const ready = seated.filter((s) => s.ready).length;
  return { seated: seated.length, ready, allReady: seated.length > 0 && ready === seated.length };
}

/**
 * The host: the present seated player with the lowest seat index, the same rule that picks the sequencer (DESIGN
 * "Specification: network protocol and secrecy", Sequencing 1). `present` tells whether a seat's holder is connected
 * (this browser counts as connected).
 */
export function hostSeat(state: TableState, present: (seat: SeatId) => boolean): SeatId | null {
  return (
    Object.values(state.seats)
      .sort((a, b) => a.index - b.index)
      .find((s) => isOccupied(state, s.id) && !s.away && present(s.id))?.id ?? null
  );
}

/**
 * Whether `seat` may start the game: it is the host, the table is in the lobby, every chair of the format is taken
 * and every seated player is Ready (DESIGN "Specification: card data, packs and draft formats", Evening stages).
 */
export function startProblem(state: TableState, seat: SeatId | null, host: SeatId | null): string | null {
  if (state.stage !== 'lobby') return 'The game has started.';
  const { seated, allReady } = readiness(state);
  const chairsTotal = Object.keys(state.seats).length;
  if (seated < chairsTotal) return chairsTotal - seated === 1 ? 'Waiting for one more player.' : `Waiting for ${chairsTotal - seated} more players.`;
  if (!allReady) return 'Waiting for everyone to press Ready.';
  if (!seat || seat !== host) return `Waiting for ${(host && state.seats[host]?.name) || 'the host'} to start the game.`;
  return null;
}

/**
 * Chairs in the order the lobby draws them around the table, rotated so the viewer's own chair is at the bottom
 * (DESIGN "Players, seats and formats": every viewer sees their own seat at the bottom). Returns the rotation in
 * degrees that brings `viewerAngle` to 0.
 */
export function viewRotation(viewerAngle: number | null): number {
  if (viewerAngle === null) return 0;
  return (((-viewerAngle % 360) + 360) % 360);
}
