/**
 * The structural checks of `auditPublish {bundle}` (DESIGN "Multiplayer architecture", Hidden information 6: "At game
 * end each browser can publish its nonces and order history"; PLAN Milestone 5, owner decisions: "Audit: automatic at
 * game end"; core/audit.ts). Implementer: M5-P2.
 *
 * The reducer accepts a bundle only
 * - from a seated seat for itself (`bundle.seat === by`);
 * - for a game that has ended in shared state: the game's number is at most `TableState.games`, and the current game
 *   counts only once the table has left the match. So a bundle (owner nonces, orders) is never sequenced while the
 *   game it covers is still being played;
 * - whose span ends before this action;
 * - in the published shape only: no key beyond those of `AuditBundle`, `PublishedShuffle`, `PublishedReorder` and
 *   `PublishedReissue`, so no identity (`CardRef`), salt or retired identity can ride along; every record names a zone
 *   of the publishing seat.
 * Whether the records agree with the public log is not the reducer's business: every peer decides that with
 * `verifyAudit` (core/audit.ts). The action changes nothing but `seq`. Pure and total.
 */
import type { ActionOf } from '../actions';
import { parseZoneId } from '../ids';
import type { Draft } from './draft';
import { checkId, checkInt, checkString, isObj, reject } from './util';

/** Longest nonce accepted (as the secret shuffle's, core/reducer/secret.ts). */
const MAX_SECRET = 256;
/** Most records in one bundle: far more shuffles and reorders than a game of Magic makes. */
export const MAX_AUDIT_RECORDS = 2000;
/** Most ids in one recorded order (a hidden zone: a library or a hand). */
export const MAX_AUDIT_ORDER = 1000;
/** Most peer nonces of one shuffle (four seats: three peers; headroom). */
const MAX_PEER_NONCES = 16;

function onlyKeys(v: Record<string, unknown>, keys: readonly string[], what: string): void {
  for (const k of Object.keys(v)) if (!keys.includes(k)) reject(`${what} carries an unexpected field ${k}`);
}

function checkIds(v: unknown, what: string): string[] {
  if (!Array.isArray(v) || v.length > MAX_AUDIT_ORDER) reject(`${what} must be a list of at most ${MAX_AUDIT_ORDER} ids`);
  return v.map((id) => checkId(id, 'card'));
}

function checkOrder(v: unknown, what: string): void {
  const ids = checkIds(v, what);
  if (new Set(ids).size !== ids.length) reject(`${what} lists a card twice`);
}

function checkReissue(v: unknown): void {
  if (v === undefined) return;
  if (!isObj(v)) reject('a published re-issue must be an object');
  onlyKeys(v, ['before'], 'a published re-issue');
  checkOrder(v.before, 'a re-issue');
}

function checkZone(v: unknown, seat: string): void {
  const zone = checkId(v, 'zone');
  if (parseZoneId(zone).seat !== seat) reject(`a record of ${seat} names zone ${zone} of another seat`);
}

function checkRecord(r: unknown, seat: string): void {
  if (!isObj(r)) reject('an audit record must be an object');
  if (r.kind === 'shuffle') {
    onlyKeys(r, ['kind', 'sid', 'zone', 'ownerNonce', 'peerNonces', 'order', 'reissue'], 'a shuffle record');
    checkId(r.sid, 'shuffle');
    checkZone(r.zone, seat);
    checkString(r.ownerNonce, 'owner nonce', MAX_SECRET);
    if (!Array.isArray(r.peerNonces) || r.peerNonces.length > MAX_PEER_NONCES) reject('peer nonces must be a short list');
    for (const n of r.peerNonces) checkString(n, 'peer nonce', MAX_SECRET);
    checkOrder(r.order, 'a shuffle order');
    checkReissue(r.reissue);
    return;
  }
  if (r.kind === 'reorder') {
    onlyKeys(r, ['kind', 'zone', 'count', 'nonce', 'order', 'reissue'], 'a reorder record');
    checkZone(r.zone, seat);
    checkInt(r.count, 'count', 0, MAX_AUDIT_ORDER);
    checkString(r.nonce, 'reorder nonce', MAX_SECRET);
    checkOrder(r.order, 'a reorder order');
    checkReissue(r.reissue);
    return;
  }
  reject('an audit record is a shuffle or a reorder');
}

/** Why `bundle` is not a well-formed published bundle of `seat`, or null (shape only; total on untrusted input). */
export function bundleShapeProblem(bundle: unknown, seat: string): string | null {
  try {
    checkBundleShape(bundle, seat);
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

function checkBundleShape(bundle: unknown, seat: string): void {
  if (!isObj(bundle)) reject('an audit bundle must be an object');
  onlyKeys(bundle, ['seat', 'game', 'records', 'incomplete'], 'an audit bundle');
  if (bundle.seat !== seat) reject(`${seat} publishes its own audit records only`);
  const g = bundle.game;
  if (!isObj(g)) reject('an audit bundle names its game');
  onlyKeys(g, ['game', 'fromSeq', 'toSeq'], 'an audit game');
  checkInt(g.game, 'game', 1);
  const from = checkInt(g.fromSeq, 'fromSeq', 1);
  checkInt(g.toSeq, 'toSeq', from);
  if (bundle.incomplete !== undefined && bundle.incomplete !== true) reject('incomplete is true or absent');
  if (!Array.isArray(bundle.records) || bundle.records.length > MAX_AUDIT_RECORDS) reject(`a bundle holds at most ${MAX_AUDIT_RECORDS} records`);
  for (const r of bundle.records) checkRecord(r, seat);
}

/** `auditPublish {bundle}`: a seat's records of a game that has ended (see the module comment). */
export function auditPublish(d: Draft, a: ActionOf<'auditPublish'>): void {
  const by = checkId(a.by, 'seat');
  const seat = d.seats.need(by);
  if (seat.name.trim() === '') reject(`${by} holds no player`);
  checkBundleShape(a.bundle, by);
  const g = a.bundle.game;
  const seq = a.seq ?? d.base.seq + 1;
  const games = d.base.games ?? 0;
  if (g.game > games) reject(`game ${g.game} has not been played`);
  // Never mid-game: the records of the game being played would show its library orders.
  if (g.game === games && d.base.stage === 'match') reject(`game ${g.game} is still being played; its records are published once it ends`);
  if (g.toSeq >= seq) reject('a game is published only after it ended');
}
