/**
 * The post-game audit (DESIGN "Multiplayer architecture", Hidden information 6: "At game end each browser can publish
 * its nonces and order history. Peers replay them and confirm that every draw came from the committed order";
 * "Specification: network protocol and secrecy", Secret shuffle: "The audit replays every record against the public log
 * and checks that each drawn id was on top"; PLAN Milestone 5, owner decisions: "Audit: automatic at game end").
 * Contracts: M5-C. Implementer: M5-P2 (this file's functions, ui/audit/*, the session's publishing at game end).
 *
 * Shape of the protocol (DECISIONS [M5-C]):
 * - When a game ends (the sequenced `stageSet` that leaves 'match' after "Next game" or "New draft", or the evening
 *   ending; M5-P2 decides how an evening end is signalled), every seated browser proposes one public action
 *   `auditPublish {bundle}` (core/actions.ts) carrying its AuditBundle for that game. It is sequenced like any action,
 *   so every peer holds the same bundles in the same log order, persists them with the log and gets them on catch-up.
 * - Every peer verifies every bundle against the public log with the pure `verifyAudit` and shows one AuditVerdict per
 *   seat in the log and in the audit panel. All peers compute the same verdicts from the same log.
 * - A seat with no bundle (left early, storage lost) is 'unverifiable' with reason 'recordsMissing', shown neutrally as
 *   "could not be checked: records missing", never as a mismatch. 'mismatch' is reserved for records that exist and
 *   disagree with the public log.
 *
 * Secrecy: a bundle carries opaque instance ids, nonces and orders only. It never carries a card identity (`CardRef`)
 * or a commitment salt: `PublishedAuditRecord` drops `ReissueRecord.retired`, and draft `PackRecord`s are not
 * published (their cards are identities). The bundle is published only after the game it covers has ended.
 */
import type { Action } from './actions';
import { nonceHash } from './commit';
import { zoneId } from './ids';
import { bundleShapeProblem } from './reducer/audit';
import { reduce } from './reducer/index';
import { orderHash, shuffleOutcome, shufflePeerNonces, shuffleSeed } from './rng';
import type { AuditRecord, InstanceId, ReorderRecord, SecretStore, SeatId, ShuffleId, ShuffleRecord, TableState, ZoneId } from './types';

/** The span of one finished game in the shared log (DESIGN "Multiplayer architecture", Audit: "at game end"). Added by M5-C. */
export interface AuditGame {
  /** `TableState.games` after the game started (1 for the first game of the evening). */
  game: number;
  /** Seq of the first action of the game (the `stageSet` into 'match'). */
  fromSeq: number;
  /** Seq of the action that ended it (the `stageSet` out of 'match'), or the last seq when the evening ended mid-match. */
  toSeq: number;
}

/** The public form of a re-issue of opaque ids (DESIGN "Table model", Hidden cards): the old id of the card now at `order[i]`, without the retired identities. Added by M5-C. */
export interface PublishedReissue {
  before: InstanceId[];
}

/** A secret shuffle's audit record as published (DESIGN "Specification: network protocol and secrecy", Secret shuffle step 5): core/types.ts ShuffleRecord without identities. Added by M5-C. */
export interface PublishedShuffle {
  kind: 'shuffle';
  sid: ShuffleId;
  zone: ZoneId;
  ownerNonce: string;
  /** Peer nonces in seat order, as the owner folded them into the seed. */
  peerNonces: string[];
  /** Resulting order, index 0 = top. */
  order: InstanceId[];
  reissue?: PublishedReissue;
}

/** A private reorder's audit record as published (DESIGN "Specification: network protocol and secrecy": "A private reorder … is recorded the same way"): core/types.ts ReorderRecord without identities. Added by M5-C. */
export interface PublishedReorder {
  kind: 'reorder';
  zone: ZoneId;
  count: number;
  /** The nonce hashed into the public `reorder.orderHash`. */
  nonce: string;
  /** Full order after the reorder, index 0 = top. */
  order: InstanceId[];
  reissue?: PublishedReissue;
}

/** One published audit record (DESIGN "Multiplayer architecture", Audit: "nonces and order history"). Added by M5-C. */
export type PublishedAuditRecord = PublishedShuffle | PublishedReorder;

/**
 * What one browser publishes at game end (DESIGN "Multiplayer architecture", Audit; PLAN M5-P2: "publish nonces and
 * order history"). Plain JSON (it travels inside the `auditPublish` action). Added by M5-C.
 */
export interface AuditBundle {
  /** The publishing seat; equals the action's `by`. */
  seat: SeatId;
  game: AuditGame;
  /** The seat's shuffle and reorder records of this game, in the order they were made. */
  records: PublishedAuditRecord[];
  /**
   * Set when this browser knows some records of the game are gone (local save lost and restored through the recovery
   * path, PLAN M5 owner decisions: "storage lost"). The records it still has are checked; the rest are unverifiable.
   */
  incomplete?: true;
}

/** Overall result for one seat (PLAN Milestone 5, owner decisions: verified, mismatch, could not be checked). Added by M5-C. */
export type AuditStatus = 'verified' | 'mismatch' | 'unverifiable';

/** What disagreed (DESIGN "Specification: network protocol and secrecy", Secret shuffle 1–5 and draws). Added by M5-C. */
export type AuditMismatchKind =
  /** SHA-256(ownerNonce) is not the `shuffleCommit.h`. */
  | 'commit'
  /** The record's peer nonces are not the sequenced `shuffleNonce`s in seat order. */
  | 'nonces'
  /** Replaying the seed over the zone's sorted ids does not give the recorded order. */
  | 'order'
  /** The recorded order and nonce do not hash to the public `shuffleDone.orderHash` or `reorder.orderHash`. */
  | 'orderHash'
  /** A `draw` named an id that was not on top of the recorded order. */
  | 'draw'
  /** A re-issue does not map the public old ids onto the new ones. */
  | 'reissue'
  /** A public shuffle or reorder of the seat has no record although the bundle claims to be complete. */
  | 'unrecorded'
  /** The bundle is not well formed or names another seat or game. */
  | 'malformed';

/** One disagreement between a seat's records and the public log (PLAN M5-P2: "show … any mismatch"). Added by M5-C. */
export interface AuditMismatch {
  kind: AuditMismatchKind;
  /** Seq of the public action it concerns, null when none. */
  seq: number | null;
  /** The shuffle id or zone it concerns, when there is one. */
  ref?: ShuffleId | ZoneId;
  /** One plain sentence for the audit panel. */
  detail: string;
}

/** Why a seat could not be checked (PLAN Milestone 5, owner decisions: "left early, storage lost"). Added by M5-C. */
export type AuditUnverifiableReason = 'recordsMissing';

/** The audit's verdict on one seat for one game (PLAN M5-P2: "a per-player verdict and any mismatch"). Added by M5-C. */
export type AuditVerdict =
  | {
      seat: SeatId;
      game: number;
      status: 'verified';
      shuffles: number;
      /** Draws checked against a committed order. */
      draws: number;
      /**
       * Every draw from the seat's library in the game (M5 review): more than `draws` when some came while the order was
       * not committed (before the first shuffle, after a mulligan or an unplaced arrival); the panel then says
       * "k of n draws checked" without the ✓.
       */
      drawn: number;
    }
  | { seat: SeatId; game: number; status: 'mismatch'; mismatches: AuditMismatch[] }
  | {
      seat: SeatId;
      game: number;
      status: 'unverifiable';
      reason: AuditUnverifiableReason;
      /** E.g. "3 of 5 shuffles checked; the rest could not be checked". */
      detail: string;
      /** Records that existed and agreed. */
      checked: number;
    };

/** The words the log and the audit panel use per status (PLAN Milestone 5, owner decisions: "could not be checked: records missing"). Added by M5-C. */
export const AUDIT_STATUS_TEXT: Readonly<Record<AuditStatus, string>> = {
  verified: 'verified',
  mismatch: 'mismatch',
  unverifiable: 'could not be checked: records missing',
};

/**
 * Everything `verifyAudit` needs (DESIGN "Specification: network protocol and secrecy": "The audit replays every
 * record against the public log"). Added by M5-C.
 */
export interface AuditInput {
  /** The seat under audit. */
  seat: SeatId;
  game: AuditGame;
  /** The seat's sequenced `auditPublish` bundle for this game, or null when none arrived. */
  bundle: AuditBundle | null;
  /** The shared state just before `game.fromSeq` (the replay starts there). */
  start: TableState;
  /** The sequenced public actions `game.fromSeq` … `game.toSeq`, ascending, no gaps. */
  log: readonly Action[];
}


// ---------------------------------------------------------------------------------------------------------------------
// Implementation (M5-P2)
// ---------------------------------------------------------------------------------------------------------------------

const sameList = (a: readonly string[], b: readonly string[]): boolean => a.length === b.length && a.every((v, i) => v === b[i]);
const sorted = (ids: readonly string[]): string[] => [...ids].sort((x, y) => (x < y ? -1 : x > y ? 1 : 0));
/** Whether `order` lists exactly the ids of `ids` (a hidden zone's sorted id set), each once. */
const listsCards = (order: readonly string[], ids: readonly string[]): boolean => sameList(sorted(order), sorted(ids));
/** An opaque id as the audit panel shows it: long enough to tell cards apart, short enough to read. */
export function shortId(id: string): string {
  return id.length > 10 ? `${id.slice(0, 8)}…` : id;
}

function own<T>(rec: Readonly<Record<string, T>>, key: string): T | undefined {
  return Object.hasOwn(rec, key) ? rec[key] : undefined;
}

/** How many cards of `before` changed place in `after` (both list the same ids): the length minus the longest run that kept its relative order. */
function movedCards(before: readonly string[], after: readonly string[]): number {
  const at = new Map(before.map((id, i) => [id, i] as const));
  const tails: number[] = [];
  for (const id of after) {
    const p = at.get(id) ?? -1;
    let lo = 0;
    let hi = tails.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (tails[mid]! < p) lo = mid + 1;
      else hi = mid;
    }
    tails[lo] = p;
  }
  return after.length - tails.length;
}

/** The first position at which two orders differ, as "position 3 should hold A but holds B". */
function firstDifference(expected: readonly string[], actual: readonly string[]): string {
  const n = Math.max(expected.length, actual.length);
  for (let i = 0; i < n; i++) {
    if (expected[i] !== actual[i]) return `position ${i + 1} should hold ${expected[i] === undefined ? 'no card' : shortId(expected[i]!)} but holds ${actual[i] === undefined ? 'no card' : shortId(actual[i]!)}`;
  }
  return 'the orders are the same';
}

/**
 * The finished games in a sequenced log (DESIGN "Specification: card data, packs and draft formats", Evening stages:
 * `build → match → build → match …`), oldest first: each runs from a `stageSet` into 'match' to the next `stageSet` out
 * of it ("Next game" to the builder, "New draft" or the end of the evening to the lobby). `log` starts at the table's
 * first action, so the n-th match is game n (`TableState.games`); a match still being played is not listed. Pure.
 * Implementer: M5-P2. Added by M5-C.
 */
export function auditGames(log: readonly Action[]): AuditGame[] {
  const out: AuditGame[] = [];
  let open: { game: number; fromSeq: number } | null = null;
  let count = 0;
  let last = 0;
  for (const a of log) {
    const seq = a.seq ?? last + 1;
    last = seq;
    if (a.type !== 'stageSet') continue;
    if (open === null && a.stage === 'match') open = { game: ++count, fromSeq: seq };
    else if (open !== null && a.stage !== 'match') {
      out.push({ ...open, toSeq: seq });
      open = null;
    }
  }
  return out;
}

/**
 * The seats a game's audit covers (PLAN M5-P2: "a per-player verdict"): every seat that held a deck commitment during
 * the game (Ready before it, or a `ready` or lost-save `recoverCommit` within it), in seat order. A seat without a deck
 * made no shuffle or draw to check. Pure. Added by M5-P2.
 */
export function auditSeats(start: TableState, log: readonly Action[]): SeatId[] {
  const seats = new Set<SeatId>(Object.keys(start.commitments));
  for (const a of log) if (a.type === 'ready' || a.type === 'recoverCommit') seats.add(a.by);
  const index = (s: SeatId): number => own(start.seats, s)?.index ?? Number.MAX_SAFE_INTEGER;
  return [...seats].sort((a, b) => index(a) - index(b) || (a < b ? -1 : a > b ? 1 : 0));
}

function publishedShuffle(r: ShuffleRecord): PublishedShuffle {
  return {
    kind: 'shuffle',
    sid: r.sid,
    zone: r.zone,
    ownerNonce: r.ownerNonce,
    peerNonces: [...r.peerNonces],
    order: [...r.order],
    ...(r.reissue ? { reissue: { before: [...r.reissue.before] } } : {}),
  };
}

function publishedReorder(r: ReorderRecord): PublishedReorder {
  return {
    kind: 'reorder',
    zone: r.zone,
    count: r.count,
    nonce: r.nonce,
    order: [...r.order],
    ...(r.reissue ? { reissue: { before: [...r.reissue.before] } } : {}),
  };
}

/**
 * The bundle this browser publishes for `game` (DESIGN "Multiplayer architecture", Hidden information 6: "its nonces
 * and order history"): for every own `shuffleDone` and `reorder` sequenced within the game's span (`log` may be the
 * whole log; actions outside the span are ignored), the matching own audit record (a shuffle by its id, a reorder by
 * its zone and order hash), stripped to its public form: no retired identity of a re-issue, no draft pack. Records of
 * proposals that were refused, and of other games, are left out. When an own public shuffle or reorder has no record
 * (the save was lost and the table recovered, or storage was cleared), the bundle says `incomplete`, and the records it
 * still has are checked. Pack-seed rounds (purpose 'pack') are the draft's, not the game's, and are skipped. Pure.
 * Implementer: M5-P2. Added by M5-C.
 */
export function buildAuditBundle(secrets: SecretStore, game: AuditGame, log: readonly Action[]): AuditBundle {
  const seat = secrets.seat;
  const used = new Set<AuditRecord>();
  const packs = new Set<ShuffleId>();
  for (const a of log) if (a.type === 'shuffleCommit' && a.purpose === 'pack') packs.add(a.sid);
  const records: PublishedAuditRecord[] = [];
  let missing = false;
  for (const a of log) {
    if (a.seq === undefined || a.seq < game.fromSeq || a.seq > game.toSeq || a.by !== seat) continue;
    if (a.type === 'shuffleDone') {
      if (packs.has(a.sid)) continue;
      const rec = secrets.audit.find((r): r is ShuffleRecord => r.kind === 'shuffle' && r.sid === a.sid && !used.has(r));
      if (!rec) {
        missing = true;
        continue;
      }
      used.add(rec);
      records.push(publishedShuffle(rec));
    } else if (a.type === 'reorder') {
      const rec = secrets.audit.find((r): r is ReorderRecord => r.kind === 'reorder' && r.zone === a.zone && !used.has(r) && orderHash(r.order, r.nonce) === a.orderHash);
      if (!rec) {
        missing = true;
        continue;
      }
      used.add(rec);
      records.push(publishedReorder(rec));
    }
  }
  return { seat, game: { game: game.game, fromSeq: game.fromSeq, toSeq: game.toSeq }, records, ...(missing ? { incomplete: true as const } : {}) };
}

/**
 * The library order the audit follows through a public action that is not the seat's own shuffle or reorder: cards
 * that left drop out; a single card the seat itself put into its library (`toZone`, or the undo of a draw) goes to the
 * bottom when the action says 'bottom' and on top otherwise ('top' or 'any'), as the owner's browser places it
 * (session/effects.ts placementOf; DECISIONS [M5-review]: an 'any' must not stop the order being followed). Any other
 * arrival (a mulligan, another seat's move, several cards at once) leaves the order uncommitted: null until the next
 * shuffle or reorder, and draws in between are not checked (the verdict then says how many were).
 */
function followLibrary(order: InstanceId[], prior: TableState, next: TableState, a: Action, lib: ZoneId, seat: SeatId): InstanceId[] | null {
  const now = new Set(own(next.zones, lib)?.ids ?? []);
  const was = new Set(own(prior.zones, lib)?.ids ?? []);
  const kept = order.filter((id) => now.has(id));
  const arrived = [...now].filter((id) => !was.has(id));
  if (arrived.length === 0) return kept;
  const placed = a.type === 'undo' ? a.inverse : a;
  if (a.by === seat && arrived.length === 1 && placed.type === 'toZone' && placed.card === arrived[0] && placed.to === lib) {
    return placed.position === 'bottom' ? [...kept, placed.card] : [placed.card, ...kept];
  }
  return null;
}

/**
 * Why a private reorder of `count` cards of the library could not have given `after` from the committed `before`
 * (DESIGN "Specification: network protocol and secrecy", private reorder; DECISIONS [M5-review]), or null when it
 * could. The honest client sends `count` 1 and moves one card (scry or surveil to the top or bottom, a card put on
 * top or at the bottom after a search, an undo putting a card back): at most one card changes place. A reorder of
 * more cards claims "the top `count`, looked at and rearranged": every card below them keeps its position (no card
 * from deeper in the library reaches the top), and every card that changed place was looked at before (`seen`: the
 * seat's logged looks at its library since its last shuffle), so a reorder of the whole library is not a shuffle.
 */
function reorderProblem(before: readonly InstanceId[], after: readonly InstanceId[], count: number, seen: ReadonlySet<InstanceId>): string | null {
  const k = Math.max(0, count);
  const moved = movedCards(before, after);
  if (k >= 1 && moved <= 1) return null;
  if (k <= 1) return `a reorder of ${k} ${k === 1 ? 'card' : 'cards'} moved ${moved} cards of the library.`;
  const was = new Map(before.map((id, i) => [id, i] as const));
  const up = after.slice(0, k).findIndex((id) => (was.get(id) ?? -1) >= k);
  if (up >= 0) {
    const id = after[up]!;
    return `a reorder of the top ${k} cards put ${shortId(id)}, which lay at position ${was.get(id)! + 1}, at position ${up + 1}.`;
  }
  if (!sameList(before.slice(k), after.slice(k))) return `a reorder of the top ${k} cards changed the library below them: ${firstDifference(before, after)}.`;
  const unseen = before.slice(0, k).filter((id, i) => after[i] !== id && !seen.has(id)).length;
  if (unseen > 0) return `a reorder of the top ${k} cards rearranged ${unseen} ${unseen === 1 ? 'card' : 'cards'} nobody had looked at (the player's looks at the library since the shuffle show fewer).`;
  return null;
}

/** Ordinal words for the panel's draw numbers. */
function nth(n: number): string {
  const s = n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th';
  return `${n}${s}`;
}

/**
 * Verify one seat's bundle against the public log (DESIGN "Specification: network protocol and secrecy", Secret
 * shuffle 1-5, private reorder: "The audit replays every record against the public log and checks that each drawn id
 * was on top"). Replays `log` from `start` through the reducer (an entry the reducer refuses changes nothing) and, for
 * the seat under audit:
 * - every own `shuffleDone`: the record's owner nonce opens the `shuffleCommit` hash ('commit'); its peer nonces are the
 *   sequenced `shuffleNonce`s in seat order ('nonces'); Fisher-Yates over the zone's sorted ids from
 *   `SHA-256(ownerNonce + peer nonces)` gives the recorded order, and a re-issue's old ids map onto the new ones as the
 *   seed orders them ('order', 'reissue'); the recorded order and nonce hash to the public `orderHash` ('orderHash');
 * - every own `reorder`: the record lists the zone's cards and hashes to the public `orderHash`; a reorder of the
 *   library moves one card or rearranges only its top `count` cards, those the seat looked at (`reorderProblem`), and
 *   a re-issue renames the cards in place;
 * - every `draw` from the seat's library while its order is committed: the drawn id is the top of that order ('draw',
 *   with the expected and the drawn id). The order is committed from a shuffle or reorder on, and followed through
 *   draws, cards leaving, and single cards the seat itself put into the library (at the bottom for 'bottom', else on
 *   top); it is unknown (draws unchecked) after a mulligan or any other arrival until the next shuffle or reorder.
 * A public shuffle or reorder without a record is 'unrecorded' (a mismatch) unless the bundle says it is incomplete;
 * then it is unchecked, and so is everything when no bundle arrived. The verdict: 'mismatch' when any record exists and
 * disagrees, else 'unverifiable' (reason 'recordsMissing') when records are missing, else 'verified' with the numbers
 * of shuffles and draws checked and of all draws. Pure, deterministic and total. Implementer: M5-P2. Added by M5-C.
 */
export function verifyAudit(input: AuditInput): AuditVerdict {
  try {
    return verify(input);
  } catch (e) {
    const detail = `The records could not be replayed: ${e instanceof Error ? e.message : String(e)}`;
    return { seat: input.seat, game: input.game.game, status: 'mismatch', mismatches: [{ kind: 'malformed', seq: null, detail }] };
  }
}

function verify(input: AuditInput): AuditVerdict {
  const { seat, game, bundle, start } = input;
  const g = game.game;
  const malformed = (detail: string): AuditVerdict => ({ seat, game: g, status: 'mismatch', mismatches: [{ kind: 'malformed', seq: null, detail }] });
  if (bundle !== null) {
    const shape = bundleShapeProblem(bundle, seat);
    if (shape !== null) return malformed(`The published records are not well formed: ${shape}.`);
    const b = bundle.game;
    if (b.game !== g || b.fromSeq !== game.fromSeq || b.toSeq !== game.toSeq) {
      return malformed(`The records name game ${b.game} (actions ${b.fromSeq}–${b.toSeq}), but game ${g} ran from action ${game.fromSeq} to ${game.toSeq}.`);
    }
  }
  const lib = zoneId('library', seat);
  const records = bundle?.records ?? [];
  const shuffleRecs = new Map<ShuffleId, PublishedShuffle>();
  for (const r of records) if (r.kind === 'shuffle' && !shuffleRecs.has(r.sid)) shuffleRecs.set(r.sid, r);
  const reorderRecs = records.filter((r): r is PublishedReorder => r.kind === 'reorder');
  const usedReorders = new Set<PublishedReorder>();
  const mismatches: AuditMismatch[] = [];
  const incomplete = bundle === null || bundle.incomplete === true;
  /** The seqs of the public shuffles and reorders without a record in an incomplete bundle (shown in the verdict). */
  const missing: number[] = [];
  let checked = 0;
  let shuffles = 0;
  let draws = 0;
  let drawn = 0;
  let order: InstanceId[] | null = null;
  /** Cards of the committed library order the seat looked at since its last shuffle of it (reorderProblem). */
  const seen = new Set<InstanceId>();
  let s = start;

  const unrecorded = (seq: number, ref: ShuffleId | ZoneId, what: string): void => {
    if (incomplete) missing.push(seq);
    else mismatches.push({ kind: 'unrecorded', seq, ref, detail: `${what} (action ${seq}) has no published record.` });
  };

  for (const a of input.log) {
    const seq = a.seq ?? s.seq + 1;
    const prior = s;
    const next = reduce(prior, a);
    if (next === prior) {
      // Refused: the table did not change, and neither does the audit's view of it.
      s = prior.seq === seq ? prior : { ...prior, seq };
      continue;
    }
    s = next;
    const mine = a.by === seat;

    if (mine && a.type === 'shuffleDone') {
      const round = own(prior.shuffles, a.sid);
      if (!round || round.purpose === 'pack') continue;
      const rec = shuffleRecs.get(a.sid);
      if (!rec) {
        unrecorded(seq, a.sid, `The shuffle of ${round.zone}`);
        if (round.zone === lib) order = null;
        continue;
      }
      const found: AuditMismatch[] = [];
      const add = (kind: AuditMismatchKind, detail: string): void => void found.push({ kind, seq, ref: a.sid, detail: `Shuffle of ${round.zone} (action ${seq}): ${detail}` });
      if (nonceHash(rec.ownerNonce) !== round.h) add('commit', `the published owner nonce does not open the commitment made at action ${round.startSeq}.`);
      const peers = shufflePeerNonces(prior, a.sid);
      if (!sameList(peers, rec.peerNonces)) add('nonces', `the record names other peer nonces than the ${peers.length} sequenced for it.`);
      const ids = own(prior.zones, round.zone)?.ids ?? [];
      const after = own(s.zones, round.zone)?.ids ?? [];
      const out = shuffleOutcome(shuffleSeed(rec.ownerNonce, peers), ids, a.reissue?.ids);
      const listed = listsCards(rec.order, after);
      if (!listed) add('order', `the recorded order does not list the ${after.length} cards of the zone.`);
      else if (!sameList(out.order, rec.order)) add('order', `the recorded order does not follow from the seed: ${firstDifference(out.order, rec.order)}.`);
      const hashOk = orderHash(rec.order, rec.ownerNonce) === a.orderHash;
      if (!hashOk) add('orderHash', 'the recorded order and nonce do not hash to the order hash published when the shuffle was done.');
      if (a.reissue !== undefined) {
        if (!rec.reissue) add('reissue', 'the shuffle gave the cards new ids, but the record has no re-issue.');
        else if (!sameList(rec.reissue.before, out.before)) add('reissue', 'the re-issue does not map the old ids onto the new ones as the seed orders them.');
      } else if (rec.reissue) add('reissue', 'the record claims a re-issue the table never saw.');
      mismatches.push(...found);
      if (found.length === 0) {
        checked++;
        shuffles++;
      }
      // Draws are checked against the order the public hash committed to (a stacked order is one mismatch, not one per draw).
      if (round.zone === lib) {
        order = listed && hashOk ? [...rec.order] : null;
        seen.clear();
      }
      continue;
    }

    if (mine && a.type === 'reorder') {
      const candidates = reorderRecs.filter((r) => r.zone === a.zone && !usedReorders.has(r));
      const rec = candidates.find((r) => orderHash(r.order, r.nonce) === a.orderHash) ?? candidates[0];
      if (!rec) {
        unrecorded(seq, a.zone, `The reorder of ${a.zone}`);
        if (a.zone === lib) order = null;
        continue;
      }
      usedReorders.add(rec);
      const found: AuditMismatch[] = [];
      const add = (kind: AuditMismatchKind, detail: string): void => void found.push({ kind, seq, ref: a.zone, detail: `Reorder of ${a.zone} (action ${seq}): ${detail}` });
      const before = own(prior.zones, a.zone)?.ids ?? [];
      const after = own(s.zones, a.zone)?.ids ?? [];
      const listed = listsCards(rec.order, after);
      if (!listed) add('order', `the recorded order does not list the ${after.length} cards of the zone.`);
      const hashOk = orderHash(rec.order, rec.nonce) === a.orderHash;
      if (!hashOk) add('orderHash', 'the recorded order and nonce do not hash to the published order hash.');
      if (a.reissue !== undefined) {
        if (!rec.reissue) add('reissue', 'the cards got new ids, but the record has no re-issue.');
        else if (!listsCards(rec.reissue.before, before)) add('reissue', 'the re-issue does not list the zone’s old ids.');
        // A re-issue renames the cards where they lie: card i of the followed order gets new id i.
        else if (a.zone === lib && order !== null && !sameList(rec.reissue.before, order)) add('reissue', `the re-issue moved cards: ${firstDifference(order, rec.reissue.before)}.`);
      } else {
        if (rec.reissue) add('reissue', 'the record claims a re-issue the table never saw.');
        // One card moves, or only the top `count` cards are rearranged (reorderProblem).
        if (a.zone === lib && order !== null && listed) {
          const problem = reorderProblem(order, rec.order, a.count, seen);
          if (problem !== null) add('order', problem);
        }
      }
      mismatches.push(...found);
      if (found.length === 0) checked++;
      if (a.zone === lib) order = listed && hashOk ? [...rec.order] : null;
      continue;
    }

    if (mine && a.type === 'lookAt' && a.zone === lib && a.card === undefined && order !== null) {
      for (const id of order.slice(0, Math.max(0, a.count))) seen.add(id);
    }

    if (a.type === 'draw' && own(prior.cards, a.instanceId)?.zone === lib) {
      drawn++;
      if (order !== null) {
        if (order[0] === a.instanceId) draws++;
        else {
          const at = order.indexOf(a.instanceId);
          const where = at >= 0 ? `, which lay at position ${at + 1}` : '';
          mismatches.push({
            kind: 'draw',
            seq,
            ref: lib,
            detail: `The ${nth(drawn)} draw of the game (action ${seq}) took ${shortId(a.instanceId)}${where}; the top of the committed library was ${order[0] === undefined ? 'no card' : shortId(order[0])}.`,
          });
        }
      }
    }
    if (order !== null) order = followLibrary(order, prior, s, a, lib, seat);
  }

  if (mismatches.length > 0) return { seat, game: g, status: 'mismatch', mismatches };
  if (bundle === null) return { seat, game: g, status: 'unverifiable', reason: 'recordsMissing', detail: 'No audit records were published (the player left early or lost the save).', checked: 0 };
  if (missing.length > 0) {
    // Which public shuffles and reorders went unrecorded, and how many draws were checked: a selective gap shows.
    const total = checked + missing.length;
    const which = `${missing.length === 1 ? 'action' : 'actions'} ${missing.join(', ')}`;
    const detail = `${checked} of ${total} shuffles and reorders checked; the rest could not be checked (no record of ${which}); ${draws} of ${drawn} ${drawn === 1 ? 'draw' : 'draws'} checked.`;
    return { seat, game: g, status: 'unverifiable', reason: 'recordsMissing', detail, checked };
  }
  return { seat, game: g, status: 'verified', shuffles, draws, drawn };
}
