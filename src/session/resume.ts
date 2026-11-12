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
import { commitFor } from '../core/commit';
import { zoneId } from '../core/ids';
import { blockingHolder, hasPassed, participants, roundPassed, waitingOn } from '../core/reducer/confirm';
import { explain, reduce } from '../core/reducer/index';
import { ownDeckCards, recoveryLibrarySize, recoveryRemainder } from '../core/recovery';
import type { CardRef, InstanceId, RoundId, SecretIdentity, SecretStore, SeatId, ShuffleId, TableState } from '../core/types';
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
  /**
   * Finish a recovery whose `recoverCommit` is sequenced but whose shuffle or draws are still owed (`recoveryOwed`),
   * e.g. after a reload in between: the secret shuffle of the new library, then the draws up to the agreed hand.
   * Resolves at once when nothing is owed; rejects when the draws stop short of the agreed hand.
   */
  finishRecovery(): Promise<void>;
  /** The rest of an own recovery that `recoverCommit` started and this browser has not finished, or null. */
  recoveryOwed(): RecoveryOwed | null;
  /** Whether a `recover` or `finishRecovery` call of this page is still running. */
  recovering(): boolean;
}

/**
 * What a recovery still owes after its `recoverCommit` (the reducer clears `Seat.recovering` there): kept in the
 * page's local storage (session/nonces.ts, kind 'recovery') from just before the commit is proposed until the agreed
 * hand is drawn, so a reload in between still shuffles the new library and draws the hand.
 */
export interface RecoveryOwed {
  /** One id the own `recoverCommit` created: the commit is sequenced once the seat's commitment lists it. */
  id: InstanceId;
  /** The hand count the table agreed to. */
  hand: number;
  /** The recovery's secret shuffle of the new library, once proposed. */
  shuffle: ShuffleId | null;
}

/** A RecoveryOwed from its stored text, or null when it is missing or malformed. */
export function parseRecoveryOwed(text: string | null): RecoveryOwed | null {
  if (text === null) return null;
  try {
    const v = JSON.parse(text) as Partial<RecoveryOwed> | null;
    if (!v || typeof v.id !== 'string' || v.id === '' || !Number.isInteger(v.hand) || (v.hand as number) < 0) return null;
    if (v.shuffle !== null && typeof v.shuffle !== 'string') return null;
    return { id: v.id, hand: v.hand as number, shuffle: v.shuffle };
  } catch {
    return null;
  }
}

/**
 * Whether `owed` is still owed on `state` for `seat`: its `recoverCommit` is sequenced (the seat's commitment lists the
 * id), no newer recovery is open, and this browser holds every card of its library (otherwise the save is lost again
 * and a new recovery replaces this one).
 */
export function owedOn(state: TableState, secrets: SecretStore, seat: SeatId, owed: RecoveryOwed | null): boolean {
  if (!owed || !Object.hasOwn(state.seats, seat) || state.seats[seat]!.recovering) return false;
  if (!(state.commitments[seat]?.instanceIds ?? []).includes(owed.id)) return false;
  return lostHiddenCards(state, secrets, seat).library.length === 0;
}

/** An identity and salt that `a`, by `seat`, published for one of its cards (a `reveal`, a `flip` with `ref` and `salt`). */
function published(a: Action, seat: SeatId): { id: InstanceId; ref: CardRef; salt: string } | null {
  if (a.type === 'reveal' && a.by === seat) return { id: a.instanceId, ref: a.ref, salt: a.salt };
  if (a.type === 'flip' && a.by === seat && a.ref !== undefined && a.salt !== undefined) return { id: a.card, ref: a.ref, salt: a.salt };
  return null;
}

/**
 * The ids of `seat`'s cards whose identity the sequenced `log` published (every `reveal` and every `flip` with `ref`
 * and `salt` of the seat). A browser that lost its save can hold such a card again (`identitiesFromLog`), so holding
 * one says nothing about whether its save survived (`recoveryStatus`).
 */
export function ownPublishedIds(log: readonly Action[], seat: SeatId): Set<InstanceId> {
  const out = new Set<InstanceId>();
  for (const a of log) {
    const p = published(a, seat);
    if (p) out.add(p.id);
  }
  return out;
}

/**
 * Identities of own cards this browser does not hold, recovered from the sequenced log (DESIGN "Multiplayer
 * architecture", Resume): every `reveal` and every `flip` with `ref` and `salt` of the seat published a card's identity
 * and salt. Only cards still on the table under that id, in a public zone or in the seat's hand, are taken, and only
 * when the identity matches the seat's commitment, so a browser that lost its save holds its public cards again (a
 * bounce re-issues the hand as usual). A card back in the library (or another hidden zone) is not taken: the lost-save
 * recovery replaces those zones, and it must stay on offer (`recoveryStatus`). Reveals that a catch-up from a snapshot
 * skipped cannot be recovered.
 */
export function identitiesFromLog(log: readonly Action[], state: TableState, seat: SeatId, known: Readonly<Record<InstanceId, SecretIdentity>>): Record<InstanceId, SecretIdentity> {
  const commits = new Set(state.commitments[seat]?.commits ?? []);
  const out: Record<InstanceId, SecretIdentity> = {};
  if (commits.size === 0) return out;
  const hand = zoneId('hand', seat);
  for (const a of log) {
    const p = published(a, seat);
    if (!p) continue;
    const { id, ref, salt } = p;
    if (Object.hasOwn(known, id) || Object.hasOwn(out, id) || !Object.hasOwn(state.cards, id)) continue;
    const c = state.cards[id]!;
    if (c.owner !== seat || c.isToken === true) continue;
    if (c.zone !== hand && state.zones[c.zone]?.visibility !== 'public') continue;
    if (!ref || typeof ref.sid !== 'string' || typeof salt !== 'string' || !commits.has(commitFor(id, ref, salt))) continue;
    out[id] = { card: ref.foil === true ? { sid: ref.sid, foil: true } : { sid: ref.sid }, salt };
  }
  return out;
}

/** Whether `session` can run the lost-save recovery (the networked session can; the solo table has nobody to agree). */
export function canRecover(session: TableSession): session is TableSession & SessionRecovery {
  const s = session as Partial<SessionRecovery>;
  return typeof s.recover === 'function' && typeof s.recovering === 'function' && typeof s.finishRecovery === 'function' && typeof s.recoveryOwed === 'function';
}

/** Whether `zone` is one of `seat`'s own hidden zones (hand, library, sideboard, pack...): `recover` discards them. */
function ownHiddenZone(state: TableState, seat: SeatId, zone: string): boolean {
  if (!Object.hasOwn(state.zones, zone)) return false;
  const z = state.zones[zone]!;
  return z.visibility !== 'public' && z.owner === seat;
}

/**
 * The seat's cards in its hidden zones whose identity this browser does not hold: its lost save. `other` lists those
 * in the seat's other hidden zones (sideboard, pack), which `recover` discards too.
 */
export function lostHiddenCards(state: TableState, secrets: SecretStore, seat: SeatId): { hand: InstanceId[]; library: InstanceId[]; other: InstanceId[] } {
  const missing = (z: string): InstanceId[] => (Object.hasOwn(state.zones, z) ? state.zones[z]!.ids.filter((id) => !Object.hasOwn(secrets.identities, id)) : []);
  const hand = zoneId('hand', seat);
  const library = zoneId('library', seat);
  const other: InstanceId[] = [];
  for (const z of Object.keys(state.zones).sort()) if (z !== hand && z !== library && ownHiddenZone(state, seat, z)) other.push(...missing(z));
  return { hand: missing(hand), library: missing(library), other };
}

/** Where the own recovery stands, as the HUD shows it (ui/recovery). */
export interface RecoveryStatus {
  /**
   * 'none': nothing lost and no recovery open; 'lost': this browser lost its save of the seat's hidden zones (hidden
   * cards whose identities it does not hold, and no card of the library it holds other than ones the log published);
   * 'proposed': `recover` is
   * sequenced and its round waits for the table (or was replaced by another round); 'agreed': the table passed the
   * round, `recoverCommit` may follow; 'committed': `recoverCommit` is sequenced, the shuffle of the new library or
   * the draws of the agreed hand are still owed (`SessionRecovery.finishRecovery`).
   */
  phase: 'none' | 'lost' | 'proposed' | 'agreed' | 'committed';
  /**
   * Own cards in the hand, the library and the seat's other hidden zones (sideboard, pack) whose identity this browser
   * does not hold (before `recover` discards them).
   */
  lost: { hand: number; library: number; other: number };
  /** The deck size: the seat's non-token cards now, or as `recover` counted them. */
  deckSize: number;
  /** The seat's non-token cards on the table that `recover` keeps (every zone but the seat's own hidden zones). */
  publicCards: number;
  /** The largest fresh hand the deck allows (deck size minus public cards). */
  maxHand: number;
  /** The proposed or agreed hand count, or the hand size the table last saw (a suggestion). */
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

/**
 * The own recovery as the HUD shows it (pure; `state` is the session's view, `owed` the session's `recoveryOwed()`,
 * `published` the ids whose identity the seat's own log entries published, `ownPublishedIds`).
 * A hidden card this browser cannot name while it holds cards of its library (a public card back in the hand whose
 * salt a catch-up from a snapshot skipped) is counted in `lost` but is not a lost save: no recovery is offered that
 * would discard the hidden cards it holds. A library card whose identity the log published does not count as held: a
 * browser that lost its save can name it again from the log (`identitiesFromLog`), so it says nothing about the save.
 */
export function recoveryStatus(
  state: TableState,
  secrets: SecretStore,
  seat: SeatId,
  owed: RecoveryOwed | null = null,
  published: ReadonlySet<InstanceId> = new Set(),
): RecoveryStatus {
  const s = Object.hasOwn(state.seats, seat) ? state.seats[seat]! : undefined;
  const own = ownDeckCards(Object.values(state.cards), seat);
  const lost = lostHiddenCards(state, secrets, seat);
  const lostCount = { hand: lost.hand.length, library: lost.library.length, other: lost.other.length };
  const publicCards = own.filter((c) => !ownHiddenZone(state, seat, c.zone)).length;
  const r = s?.recovering;
  if (!r) {
    const deckSize = own.length;
    const handNow = Object.hasOwn(state.zones, zoneId('hand', seat)) ? state.zones[zoneId('hand', seat)]!.ids.length : 0;
    if (owedOn(state, secrets, seat, owed)) {
      return { phase: 'committed', lost: lostCount, deckSize, publicCards, maxHand: Math.max(0, deckSize - publicCards), hand: owed!.hand, librarySize: null, round: null };
    }
    const library = Object.hasOwn(state.zones, zoneId('library', seat)) ? state.zones[zoneId('library', seat)]!.ids : [];
    const holdsLibrary = library.some((id) => Object.hasOwn(secrets.identities, id) && !published.has(id));
    return {
      // The other hidden zones are counted, not a trigger: what an own pack or sideboard holds may not be in `identities`.
      phase: lostCount.hand + lostCount.library > 0 && !holdsLibrary ? 'lost' : 'none',
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
  const status = recoveryStatus(state, emptyFor(seat), seat);
  if (hand > status.maxHand) return `A fresh hand can hold at most ${status.maxHand} cards (deck ${status.deckSize}, ${status.publicCards} on the table)`;
  const dry = dryRecover(state, seat, hand);
  if (dry.refused !== null) return dry.refused;
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
