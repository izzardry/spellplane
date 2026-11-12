/**
 * Resume and the lost-save recovery, the session's side (PLAN M1-P7; DESIGN "Multiplayer architecture", Resume and
 * failure handling). Implementer: M1-P7.
 *
 * - Reload and reopen are M1-P8's path (session/persist.ts saves, session/net.ts `loadSaved` restores from the own
 *   save, the engine's `deferTo` reconciles to the copy with the highest seq, as net/sync.ts `chooseResume` states).
 *   Nothing here saves or restores.
 * - "If a player loses their local save (cleared storage, different device), their hidden zones are gone. The
 *   recovery path is public and logged: the player re-imports the deck, the table subtracts every card of theirs that
 *   is currently public, and the remainder is committed and shuffled as a new library with a fresh hand count agreed
 *   by the table." This module tells the HUD whether this browser lost its hidden cards and where an open recovery
 *   stands (`recoveryStatus`), checks a re-imported deck before anything is proposed (`recoveryProblem`), and names the
 *   session's driver (`SessionRecovery`, implemented by session/net.ts): `recover {hand, round}`, the M1-P3
 *   confirmation round, `recoverCommit` with exactly `recoveryLibrarySize` fresh ids, M1-P2's secret shuffle and the
 *   draws for the agreed hand.
 */
import type { Action } from '../core/actions';
import { zoneId } from '../core/ids';
import { blockingHolder, hasPassed, participants, roundPassed, waitingOn } from '../core/reducer/confirm';
import { explain, reduce } from '../core/reducer/index';
import { ownDeckCards, recoveryLibrarySize, recoveryRemainder } from '../core/recovery';
import type { CardRef, InstanceId, RoundId, SecretStore, SeatId, TableState } from '../core/types';
import type { DeckImport, TableSession } from './types';

/** The lost-save recovery a networked session runs (DESIGN "Multiplayer architecture", Resume and failure handling). */
export interface SessionRecovery {
  /**
   * Recover the own hidden zones after this browser lost its save: propose `recover {hand, round}` (unless the same
   * count is already proposed in the current round), wait until the table agreed in that confirmation round (silence
   * passes, a hold objects), then commit the re-imported deck minus the seat's public cards as the new library
   * (`recoverCommit`), shuffle it with the other seats' nonces and draw `hand` cards. Rejects, with nothing proposed,
   * when the deck cannot be the one played (`recoveryProblem`); rejects when the proposal is replaced by another one
   * or another round starts before the table agreed (propose again).
   */
  recover(deck: DeckImport, hand: number): Promise<void>;
  /** Whether a `recover` call of this page is still running. */
  recovering(): boolean;
}

/** Whether `session` can run the lost-save recovery (the networked session can; the solo table has nobody to agree). */
export function canRecover(session: TableSession): session is TableSession & SessionRecovery {
  const s = session as Partial<SessionRecovery>;
  return typeof s.recover === 'function' && typeof s.recovering === 'function';
}

/** The seat's cards in its hidden zones (hand, library) whose identity this browser does not hold: its lost save. */
export function lostHiddenCards(state: TableState, secrets: SecretStore, seat: SeatId): { hand: InstanceId[]; library: InstanceId[] } {
  const missing = (kind: string): InstanceId[] => {
    const z = zoneId(kind, seat);
    if (!Object.hasOwn(state.zones, z)) return [];
    return state.zones[z]!.ids.filter((id) => !Object.hasOwn(secrets.identities, id));
  };
  return { hand: missing('hand'), library: missing('library') };
}

/** Where the own recovery stands, as the HUD shows it (ui/recovery). */
export interface RecoveryStatus {
  /**
   * 'none': nothing lost and no recovery open; 'lost': hidden cards of this seat whose identities this browser does
   * not hold; 'proposed': `recover` is sequenced and its round waits for the table (or was replaced by another
   * round); 'agreed': the table passed the round, `recoverCommit` may follow.
   */
  phase: 'none' | 'lost' | 'proposed' | 'agreed';
  /** Lost cards still on the table in the own hand and library (before `recover` discards them). */
  lost: { hand: number; library: number };
  /** The deck size: the seat's non-token cards now, or as `recover` counted them. */
  deckSize: number;
  /** The seat's non-token cards on the table that `recover` keeps (public zones). */
  publicCards: number;
  /** The largest fresh hand the deck allows (deck size minus public cards). */
  maxHand: number;
  /** The proposed hand count, or the hand size the table last saw (a suggestion). */
  hand: number;
  /** The library the recovery commits before the draws (`recoveryLibrarySize`), once proposed. */
  librarySize: number | null;
  /** The recovery's confirmation round, once proposed. */
  round: RecoveryRound | null;
}

export interface RecoveryRound {
  id: RoundId;
  /** Whether it is still the table's current round (a newer round replaced it otherwise: propose again). */
  current: boolean;
  /** Seats that answer it, in seat order. */
  seats: SeatId[];
  /** Seats that passed (OK or timed out). */
  passed: SeatId[];
  /** Seats it still waits for. */
  waiting: SeatId[];
  /** A present seat holding the round (an objection), or null. */
  holder: SeatId | null;
  /** The table agreed. */
  agreed: boolean;
}

/** The own recovery as the HUD shows it (pure; `state` is the session's view). */
export function recoveryStatus(state: TableState, secrets: SecretStore, seat: SeatId): RecoveryStatus {
  const s = Object.hasOwn(state.seats, seat) ? state.seats[seat]! : undefined;
  const own = ownDeckCards(Object.values(state.cards), seat);
  const lost = lostHiddenCards(state, secrets, seat);
  const lostCount = { hand: lost.hand.length, library: lost.library.length };
  const hiddenKinds = new Set(['hand', 'library'].map((k) => zoneId(k, seat)));
  const publicCards = own.filter((c) => !hiddenKinds.has(c.zone)).length;
  const r = s?.recovering;
  if (!r) {
    const deckSize = own.length;
    const handNow = Object.hasOwn(state.zones, zoneId('hand', seat)) ? state.zones[zoneId('hand', seat)]!.ids.length : 0;
    return {
      phase: lostCount.hand + lostCount.library > 0 ? 'lost' : 'none',
      lost: lostCount,
      deckSize,
      publicCards,
      maxHand: Math.max(0, deckSize - publicCards),
      hand: handNow,
      librarySize: null,
      round: null,
    };
  }
  const current = state.confirm?.id === r.round;
  const roundView: RecoveryRound = current
    ? (() => {
        const confirm = state.confirm!;
        const seats = participants(state, confirm);
        return {
          id: r.round,
          current,
          seats,
          passed: seats.filter((x) => hasPassed(state, x)),
          waiting: waitingOn(state),
          holder: blockingHolder(state),
          agreed: roundPassed(state),
        };
      })()
    : { id: r.round, current, seats: [], passed: [], waiting: [], holder: null, agreed: false };
  return {
    phase: roundView.agreed ? 'agreed' : 'proposed',
    lost: lostCount,
    deckSize: r.deckSize,
    publicCards,
    maxHand: Math.max(0, r.deckSize - publicCards),
    hand: r.hand,
    librarySize: recoveryLibrarySize(state, seat),
    round: roundView,
  };
}

/** A `recover` as the reducer would see it next on `state`, for checks that must not propose anything. */
function dryRecover(state: TableState, seat: SeatId, hand: number): { next: TableState; refused: string | null } {
  const a = { type: 'recover', hand, round: '__dry-recovery', by: seat, cid: '__dry', seq: state.seq + 1 } as Action;
  const why = explain(state, a);
  return why === null ? { next: reduce(state, a), refused: null } : { next: state, refused: why };
}

/**
 * Why the re-imported `deck` cannot recover `seat` with a fresh hand of `hand` on `state`, or null when it can: the
 * reducer refuses the count (more than deck size minus public cards), the deck lacks a card of the seat that is public
 * on the table, or it is too small for the library `recoverCommit` must commit (DESIGN "Multiplayer architecture",
 * Resume: "the table subtracts every card of theirs that is currently public, and the remainder is committed").
 */
export function recoveryProblem(state: TableState, seat: SeatId, deck: readonly CardRef[], hand: number): string | null {
  if (!Number.isInteger(hand) || hand < 0) return 'The hand count must be a whole number of cards';
  if (!Array.isArray(deck) || deck.length === 0) return 'The re-imported deck has no main-deck cards';
  for (const c of deck) if (!c || typeof c.sid !== 'string' || c.sid === '') return 'Every card needs a Scryfall id';
  const dry = dryRecover(state, seat, hand);
  if (dry.refused !== null) {
    const status = recoveryStatus(state, emptyFor(seat), seat);
    return /hand/.test(dry.refused) ? `A fresh hand can hold at most ${status.maxHand} cards (deck ${status.deckSize}, ${status.publicCards} on the table)` : dry.refused;
  }
  const size = recoveryLibrarySize(dry.next, seat) ?? 0;
  if (recoveryRemainder(deck, dry.next, seat) !== null) return null;
  const key = (r: CardRef): string => `${r.sid}|${r.foil === true ? 'f' : 'n'}`;
  const left = new Map<string, number>();
  for (const c of deck) left.set(key(c), (left.get(key(c)) ?? 0) + 1);
  for (const c of ownDeckCards(Object.values(dry.next.cards), seat)) {
    if (!c.identity) continue;
    const n = left.get(key(c.identity)) ?? 0;
    if (n === 0) return 'The re-imported deck lacks a card of yours that is on the table: it is not the deck you played';
    left.set(key(c.identity), n - 1);
  }
  return `The re-imported deck has ${deck.length} cards; the table needs ${size} for your library besides your cards on the table`;
}

function emptyFor(seat: SeatId): SecretStore {
  return { seat, identities: {}, libraryOrder: [], hand: [], audit: [], received: {} };
}
