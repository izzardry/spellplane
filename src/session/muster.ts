/**
 * The muster rule and the rejoin controls (persistence.md sections 5 to 7; contracts.md Part G "Rejoin").
 * Implementer: M8-P5.
 *
 * `musterStatus` is a pure function of the confirmed state, the own seat and head, the connected verified peers with
 * their heads, `knownHead`, and two facts of this page: it stayed live since it joined (rule 1), and the table decided
 * to play on (rule 4). A browser is live when
 *
 * 1. it stayed: it has been live since it joined and has not reloaded;
 * 2. it holds the same seq and hash as a connected peer whose head says live;
 * 3. everyone who was there is back: every occupied seat the state does not mark away is connected and in step with
 *    this copy, and no peer ever reported a newer head (`knownHead`, newest by (play, seq, peerId));
 * 4. the table decided (`playOn` applied; it clears `knownHead` and marks the missing seats away, so rule 3 holds).
 *
 * In the lobby stage every browser is live: before the game starts there is nothing a stale copy could damage.
 */
import type { SeatId, TableState } from '../core/types';
import { newerHead } from '../net/engine';
import type { PeerHead } from '../net/types';
import type { KnownHead, MusterSeat, MusterStatus, SessionMuster, TableSession } from './types';

/** One connected peer as the muster rule reads it. */
export interface MusterPeer {
  peerId: string;
  status: 'handshake' | 'connected' | 'away';
  head?: PeerHead | undefined;
}

/** Everything the muster rule reads. */
export interface MusterInput {
  /** The confirmed state. */
  state: TableState;
  /** The own seat, null for a browser without one (a claimant). */
  me: SeatId | null;
  myPeerId?: string;
  /** This copy's head: seq, play count and the hash of the confirmed state. */
  mine: { seq: number; play: number; h: string };
  peers: readonly MusterPeer[];
  knownHead: KnownHead | null;
  /** Live since it joined and not reloaded (rule 1). */
  stayed: boolean;
  /** The table decided to play on since this page opened (rule 4). */
  decided?: boolean;
}

function inStep(head: PeerHead | undefined, mine: MusterInput['mine']): boolean {
  return head !== undefined && head.seq === mine.seq && head.h === mine.h;
}

/** Whether `known` is a newer copy than this one (contracts.md Part G item 2: newest by (play, seq, peerId)). */
export function knownIsNewer(known: KnownHead | null, mine: { seq: number; play: number }): boolean {
  if (known === null) return false;
  if (known.play !== mine.play) return known.play > mine.play;
  return known.seq > mine.seq;
}

/**
 * The muster verdict (persistence.md section 5). Pure. Called with a state and a seat only (M8-C's signature), it is the
 * verdict of a browser that stayed: live.
 */
export function musterStatus(arg: MusterInput | TableState, seat: SeatId | null = null): MusterStatus {
  const input: MusterInput = 'mine' in arg ? arg : { state: arg, me: seat, mine: { seq: arg.seq, play: 0, h: '' }, peers: [], knownHead: null, stayed: true };
  const { state, me, mine, peers, knownHead } = input;
  const connected = peers.filter((p) => p.status === 'connected' && p.peerId !== '');
  const byPeer = new Map(connected.map((p) => [p.peerId, p]));
  const occupied = Object.values(state.seats)
    .filter((s) => s.peer !== undefined)
    .sort((a, b) => a.index - b.index);
  const seats: MusterSeat[] = occupied.map((s) => {
    const meSeat = s.id === me;
    if (meSeat) return { seat: s.id, name: s.name, me: true, state: 'here' };
    const p = byPeer.get(s.peer!);
    const raw = peers.find((x) => x.peerId === s.peer && x.status !== 'away');
    let st: MusterSeat['state'];
    // A browser that stayed does not hash its copy for every change (session/net.ts): a connected peer is here.
    if (p && (inStep(p.head, mine) || (input.stayed && p.head !== undefined))) st = 'here';
    else if (p || raw) st = 'connecting';
    else st = s.away === true ? 'leftBefore' : 'away';
    return { seat: s.id, name: s.name, me: false, state: st };
  });
  const newer = knownIsNewer(knownHead, mine);
  const verdict = (live: boolean, rule: MusterStatus['rule'], waitingFor: SeatId[], playOnHere = false): MusterStatus => ({
    live,
    rule,
    waitingFor,
    seats,
    knownHead,
    playOnHere,
  });
  if (state.stage === 'lobby') return verdict(true, 3, []);
  if (input.stayed) return verdict(true, 1, []);
  if (connected.some((p) => p.head?.live === true && inStep(p.head, mine))) return verdict(true, 2, []);
  // Rule 3: every occupied seat not marked away is here and in step, and so is every connected seated peer.
  const missing = occupied.filter((s) => s.id !== me && s.away !== true && !inStep(byPeer.get(s.peer!)?.head, mine)).map((s) => s.id);
  const seatedPeers = new Set(occupied.map((s) => s.peer));
  const strayOut = connected.some((p) => seatedPeers.has(p.peerId) && !inStep(p.head, mine));
  if (missing.length === 0 && !strayOut && !newer) return verdict(true, input.decided === true ? 4 : 3, []);
  const waiting = [...missing];
  if (newer && knownHead!.seat !== null && !waiting.includes(knownHead!.seat) && knownHead!.seat !== me) waiting.push(knownHead!.seat);
  // PLAY ON WITH THIS TABLE: rule 3 fails only because of knownHead (contracts.md Part G item 4).
  const playOnHere = missing.length === 0 && !strayOut && newer;
  return verdict(false, null, waiting, playOnHere);
}

/** The muster of a session that has none (a solo or computer table): always live. */
export function alwaysLive(state: TableState, me: SeatId | null): MusterStatus {
  return musterStatus(state, me);
}

/** A session that carries rejoin controls (session/net.ts NetTable). */
export interface MusterHost {
  readonly muster?: SessionMuster;
}

/** The rejoin controls of a session: the networked session's own, else a solo one that is always live. */
export function createSessionMuster(session: TableSession): SessionMuster {
  const own = (session as TableSession & MusterHost).muster;
  if (own) return own;
  return {
    muster: () => alwaysLive(session.getState(), session.seat),
    subscribe: (listener) => session.subscribe(() => listener(alwaysLive(session.getState(), session.seat))),
    playOn: () => Promise.resolve(),
    invite: () => Promise.reject(new Error('This table has no seats to bring back.')),
    takeInviteBack: () => Promise.resolve(),
    saveState: () => 'saved',
  };
}

/** The newest of two known heads (or the first when they tie). */
export function newestKnown(a: KnownHead | null, b: KnownHead | null): KnownHead | null {
  if (a === null) return b;
  if (b === null) return a;
  return newerHead({ play: b.play, seq: b.seq, peerId: b.peer }, { play: a.play, seq: a.seq, peerId: a.peer }) > 0 ? b : a;
}

