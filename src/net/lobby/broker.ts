/**
 * The broker: one pure state machine per browser (matchmaking.md 2.5; contracts.md Part G "Matchmaking" item 1).
 * `step(state, event) -> { state, send, effects }`. No clock (every event carries `now`, the browser's own clock), no
 * randomness (hold nonces arrive with the `held` event, retry jitter is a hash of tid and counter), no crypto: the
 * room verifies ticket and hold signatures before an event reaches the broker, and signs this browser's holds on the
 * `hold` effect.
 *
 * Rules (2.5): anchors (the smallest tid of a group) offer the best group; a member collects offers for 200 ms, passes
 * those it cannot take with the reason, holds the smallest match id and passes `busy` on the rest; one hold at a time;
 * a hold completes with signed holds from every member (then the 20-second ready check) or lapses after 3 s; `ready`
 * from all members forms the match and every member derives the same room. Replaced rule 8: after a `window` pass the
 * anchor may offer the same member set again from the next row boundary of any member's wait, at most 5 s later; after
 * `unreachable` only when a link changes. A member judges an offer with 2 s of slack on the others' wait.
 */
import { sha256TextBytes } from '../../core/sha256';
import type { QueueId } from '../../core/types';
import type { LobbyMessage, PassReason, Ticket } from './messages';
import { bestGroup, compatible, deriveRoom, groupSize, JUDGE_SLACK_MS, midOf, nextBoundary, queueParts, ratingFor, splitTeams, type Candidate } from './pairing';

export const COLLECT_MS = 200;
export const HOLD_TTL_MS = 3_000;
export const CHECK_MS = 20_000;
export const CHECK_GRACE_MS = 2_000;
export const WINDOW_RETRY_MAX_MS = 5_000;

export type BrokerPhase = 'watching' | 'seeking' | 'collecting' | 'held' | 'check' | 'moving';
export type BeatState = 'watching' | 'seeking' | 'held' | 'check';

export interface OfferMember {
  tid: string;
  rev: number;
  team?: 0 | 1;
}

/** An offer as a member keeps it. */
export interface HeldOffer {
  mid: string;
  queue: QueueId;
  members: OfferMember[];
  anchor: string;
}

/** What this browser knows of another lobby member. */
export interface BrokerPeer {
  /** The verified ticket while it seeks, else null. */
  ticket: Ticket | null;
  /** When it started waiting, on this browser's clock (now − waitedMs at receipt; the earliest estimate wins). */
  since: number | null;
  state: BeatState;
  links: string[];
}

/** A member set the anchor does not offer again for now (replaced rule 8). */
export interface OfferBlock {
  key: string;
  members: string[];
  reason: 'window' | 'unreachable';
  /** Window: offering is allowed again from this time. Unreachable: null (until a link changes). */
  until: number | null;
}

/** A formed match: every member derives the same one. */
export interface FormedMatch {
  mid: string;
  queue: QueueId;
  /** The members as offered (anchor's order) with team for 2hg. */
  members: OfferMember[];
  /** Member tids in seat order. */
  order: string[];
  roomId: string;
  roomKey: string;
  /** Every member's verified ticket (this browser's own included). */
  tickets: Record<string, Ticket>;
}

export interface BrokerState {
  tid: string;
  peerId: string;
  proto: number;
  phase: BrokerPhase;
  ticket: Ticket | null;
  since: number | null;
  /** The tids this browser is connected to. */
  links: string[];
  peers: Record<string, BrokerPeer>;
  offers: HeldOffer[];
  collectUntil: number | null;
  hold: { offer: HeldOffer; nonces: Record<string, string>; until: number } | null;
  check: { offer: HeldOffer; nonces: Record<string, string>; deadline: number; ready: string[]; accepted: boolean } | null;
  formed: FormedMatch | null;
  counter: number;
  retryAt: number;
  blocks: OfferBlock[];
  /**
   * Holds, readies and passes that arrived before this browser reached that match id (reordering). Only those from the
   * offer's members count once it arrives; the rest are dropped.
   */
  early: Record<string, { holds: Record<string, string>; ready: string[]; passes?: string[] }>;
  /** Match ids that were passed: a late offer of one is answered `stale`. */
  dead: string[];
  /** This broker's random salt in its match ids (from the room): ids of a new lobby connection never repeat old ones. */
  salt: string;
}

export type BrokerEvent =
  | { kind: 'tick'; now: number }
  /** Start seeking, or replace the ticket (widen). `waitedMs` only counts when the search starts. */
  | { kind: 'seek'; now: number; ticket: Ticket; waitedMs?: number }
  | { kind: 'cancel'; now: number }
  /** This browser's connections changed. */
  | { kind: 'links'; now: number; links: string[] }
  | { kind: 'peerGone'; now: number; tid: string }
  /** A validated, verified lobby message from `from` (ticket bound to `from`, hold signature checked). */
  | { kind: 'message'; now: number; from: string; msg: LobbyMessage }
  /** The room signed and sent this browser's hold for `mid` with `nonce`. */
  | { kind: 'held'; now: number; mid: string; nonce: string }
  | { kind: 'answer'; now: number; accept: boolean };

export interface Outgoing {
  to: string;
  msg: LobbyMessage;
}

export type BrokerEffect =
  /** Sign `holdText(mid, tid, peerId)` with a fresh nonce, send `hold` to `to`, then step `held`. */
  | { kind: 'hold'; mid: string; to: string[] }
  | { kind: 'check'; mid: string }
  | { kind: 'formed'; match: FormedMatch }
  /** Another member declined or let the check lapse: back in the queue, waiting time kept. `name`: who, when known. */
  | { kind: 'returned'; reason: 'declined' | 'lapsed'; name?: string }
  /** This browser declined or let the check lapse: the search stopped. */
  | { kind: 'stopped'; reason: 'declined' | 'lapsed' };

export interface StepResult {
  state: BrokerState;
  send: Outgoing[];
  effects: BrokerEffect[];
}

/** A fresh broker for this browser's lobby connection. */
export function createBroker(self: { tid: string; peerId: string; proto: number; salt?: string }): BrokerState {
  return {
    ...self,
    salt: self.salt ?? '',
    phase: 'watching',
    ticket: null,
    since: null,
    links: [],
    peers: {},
    offers: [],
    collectUntil: null,
    hold: null,
    check: null,
    formed: null,
    counter: 0,
    retryAt: 0,
    blocks: [],
    early: {},
    dead: [],
  };
}

/** What this browser's beat says about it. */
export function beatState(s: BrokerState): BeatState {
  if (s.phase === 'held') return 'held';
  if (s.phase === 'check' || s.phase === 'moving') return 'check';
  if (s.phase === 'seeking' || s.phase === 'collecting') return 'seeking';
  return 'watching';
}

/** Own waiting time. */
export function waitedOf(s: BrokerState, now: number): number {
  return s.since === null ? 0 : Math.max(0, now - s.since);
}

/** Retry jitter of 300 to 1500 ms (matchmaking.md 2.5 constants), derived from tid and counter. */
export function retryDelay(tid: string, counter: number): number {
  const b = sha256TextBytes(`${tid}|${counter}`);
  return 300 + (((b[0]! << 8) | b[1]!) % 1201);
}

const MAX_DEAD = 128;
const MAX_EARLY = 64;

class Stepper {
  readonly send: Outgoing[] = [];
  readonly effects: BrokerEffect[] = [];
  constructor(
    public s: BrokerState,
    readonly now: number,
  ) {}

  to(tids: readonly string[], msg: LobbyMessage): void {
    for (const t of tids) if (t !== this.s.tid) this.send.push({ to: t, msg });
  }
  pass(offer: HeldOffer, reason: PassReason): void {
    this.to(
      offer.members.map((m) => m.tid),
      { v: 1, t: 'pass', mid: offer.mid, reason },
    );
    this.kill(offer.mid);
  }
  kill(mid: string): void {
    if (!this.s.dead.includes(mid)) this.s.dead = [...this.s.dead, mid].slice(-MAX_DEAD);
    delete this.s.early[mid];
  }
  retry(): void {
    this.s.retryAt = this.now + retryDelay(this.s.tid, this.s.counter + this.s.dead.length);
  }
  toSeeking(): void {
    this.s.phase = this.s.ticket ? 'seeking' : 'watching';
    this.s.hold = null;
    this.s.check = null;
    this.s.offers = [];
    this.s.collectUntil = null;
    this.retry();
  }
  toWatching(): void {
    this.s.phase = 'watching';
    this.s.ticket = null;
    this.s.since = null;
    this.s.hold = null;
    this.s.check = null;
    this.s.offers = [];
    this.s.collectUntil = null;
  }
  /** Linked: each side connected to the other as far as this browser knows. */
  linked(a: string, b: string): boolean {
    // A peer this browser hears from is connected to it (beats go only over open connections); a beat's own list may
    // arrive out of order, so a pair with this browser is judged by this browser's own links.
    if (a === this.s.tid) return this.s.links.includes(b) && this.s.peers[b] !== undefined;
    if (b === this.s.tid) return this.s.links.includes(a) && this.s.peers[a] !== undefined;
    const linksOf = (t: string): readonly string[] => (t === this.s.tid ? this.s.links : (this.s.peers[t]?.links ?? []));
    return linksOf(a).includes(b) && linksOf(b).includes(a);
  }
  waitOf(tid: string): number {
    if (tid === this.s.tid) return waitedOf(this.s, this.now);
    const since = this.s.peers[tid]?.since;
    return since === null || since === undefined ? 0 : Math.max(0, this.now - since);
  }
  blockKey(queue: QueueId, members: readonly string[]): string {
    return `${queue}|${[...members].sort().join(',')}`;
  }
  blocked(queue: QueueId, members: readonly string[]): boolean {
    const key = this.blockKey(queue, members);
    return this.s.blocks.some((b) => b.key === key && (b.until === null || this.now < b.until));
  }
  clearBlocks(pred: (b: OfferBlock) => boolean): void {
    this.s.blocks = this.s.blocks.filter((b) => !pred(b));
  }
  /** Why this browser cannot take `offer`, or null when it can. */
  problem(offer: HeldOffer): PassReason | null {
    const me = this.s.ticket;
    if (!me || !offer.members.some((m) => m.tid === this.s.tid)) return 'stale';
    // The queue's table size, distinct members, and in 2hg two teams of two (no team field otherwise).
    if (offer.members.length !== groupSize(offer.queue) || new Set(offer.members.map((m) => m.tid)).size !== offer.members.length) return 'stale';
    if (queueParts(offer.queue).format === '2hg') {
      if (offer.members.filter((m) => m.team === 0).length !== 2 || offer.members.filter((m) => m.team === 1).length !== 2) return 'stale';
    } else if (offer.members.some((m) => m.team !== undefined)) return 'stale';
    if (!me.queues.includes(offer.queue)) return 'window';
    for (const m of offer.members) {
      if (m.tid === this.s.tid) {
        if (m.rev !== me.rev) return 'stale';
        continue;
      }
      const p = this.s.peers[m.tid];
      if (!p || !p.ticket || p.ticket.rev !== m.rev) return 'stale';
    }
    for (const m of offer.members) if (m.tid !== this.s.tid && !this.s.links.includes(m.tid)) return 'unreachable';
    const mine: Candidate = me;
    const myWait = this.waitOf(this.s.tid);
    for (const m of offer.members) {
      if (m.tid === this.s.tid) continue;
      const other = this.s.peers[m.tid]!.ticket!;
      if (!compatible(mine, other, offer.queue, myWait, this.waitOf(m.tid) + JUDGE_SLACK_MS)) return 'window';
    }
    return null;
  }
  addOffer(offer: HeldOffer): void {
    if (this.s.offers.some((o) => o.mid === offer.mid)) return;
    this.s.offers = [...this.s.offers, offer];
    if (this.s.phase === 'seeking') {
      this.s.phase = 'collecting';
      this.s.collectUntil = this.now + COLLECT_MS;
    }
  }
  decide(): void {
    const offers = [...this.s.offers].sort((a, b) => (a.mid < b.mid ? -1 : a.mid > b.mid ? 1 : 0));
    this.s.offers = [];
    this.s.collectUntil = null;
    let chosen: HeldOffer | null = null;
    for (const o of offers) {
      if (this.s.dead.includes(o.mid)) continue;
      const why = this.problem(o);
      if (why !== null) {
        if (o.anchor === this.s.tid && (why === 'window' || why === 'unreachable')) this.block(o, why);
        this.pass(o, why);
      } else if (chosen === null) chosen = o;
      else this.pass(o, 'busy');
    }
    if (chosen === null) {
      this.s.phase = this.s.ticket ? 'seeking' : 'watching';
      this.retry();
      return;
    }
    const early = this.s.early[chosen.mid];
    delete this.s.early[chosen.mid];
    this.s.phase = 'held';
    // Only the offer's members' early holds count: a stray hold for a predictable match id never joins the room secret.
    const isMember = (t: string): boolean => chosen.members.some((m) => m.tid === t);
    const nonces: Record<string, string> = {};
    for (const [t, n] of Object.entries(early?.holds ?? {})) if (isMember(t)) nonces[t] = n;
    this.s.hold = { offer: chosen, nonces, until: this.now + HOLD_TTL_MS };
    if (early && early.ready.length > 0) this.s.early[chosen.mid] = { holds: {}, ready: early.ready };
    this.effects.push({ kind: 'hold', mid: chosen.mid, to: chosen.members.map((m) => m.tid).filter((t) => t !== this.s.tid) });
  }
  block(offer: HeldOffer, reason: 'window' | 'unreachable'): void {
    const members = offer.members.map((m) => m.tid);
    const key = this.blockKey(offer.queue, members);
    let until: number | null = null;
    if (reason === 'window') {
      until = this.now + WINDOW_RETRY_MAX_MS;
      for (const t of members) {
        const w = this.waitOf(t);
        const b = nextBoundary(w);
        if (b !== null) until = Math.min(until, this.now + (b - w));
      }
    }
    this.s.blocks = [...this.s.blocks.filter((b) => b.key !== key), { key, members: [...members].sort(), reason, until }];
  }
  completeHold(): void {
    const h = this.s.hold;
    if (!h) return;
    if (!h.offer.members.every((m) => Object.hasOwn(h.nonces, m.tid))) return;
    const early = this.s.early[h.offer.mid];
    delete this.s.early[h.offer.mid];
    this.s.hold = null;
    this.s.phase = 'check';
    this.s.check = { offer: h.offer, nonces: h.nonces, deadline: this.now + CHECK_MS, ready: (early?.ready ?? []).filter((t) => h.offer.members.some((m) => m.tid === t)), accepted: false };
    this.effects.push({ kind: 'check', mid: h.offer.mid });
  }
  maybeFormed(): void {
    const c = this.s.check;
    if (!c || !c.accepted || !c.offer.members.every((m) => c.ready.includes(m.tid))) return;
    // The room comes from the members' nonces only (2.5 Room derivation), whatever else a nonce map might hold.
    const nonces: Record<string, string> = {};
    for (const m of c.offer.members) nonces[m.tid] = c.nonces[m.tid]!;
    const tickets: Record<string, Ticket> = {};
    for (const m of c.offer.members) {
      const t = m.tid === this.s.tid ? this.s.ticket : this.s.peers[m.tid]?.ticket;
      if (t) tickets[m.tid] = t;
    }
    if (Object.keys(tickets).length !== c.offer.members.length) {
      // A member's ticket is gone (it stopped seeking): no match, back in the queue.
      this.memberOut(c.offer.mid, 'stale');
      return;
    }
    const room = deriveRoom(c.offer.mid, nonces);
    // A 2hg plan seats team 0 first (2.5 Room derivation), each team in derived order.
    let order = room.order;
    if (queueParts(c.offer.queue).format === '2hg') {
      const team = (t: string): number => c.offer.members.find((m) => m.tid === t)?.team ?? 0;
      order = [...order.filter((t) => team(t) === 0), ...order.filter((t) => team(t) === 1)];
    }
    const formed: FormedMatch = { mid: c.offer.mid, queue: c.offer.queue, members: c.offer.members, order, roomId: room.roomId, roomKey: room.roomKey, tickets };
    this.s.formed = formed;
    this.s.check = null;
    this.s.phase = 'moving';
    this.effects.push({ kind: 'formed', match: formed });
  }
  /** A member of the current hold or check is out (pass, unseek, gone); `who` is that member when known. */
  memberOut(mid: string, reason: PassReason | 'gone', who?: string): void {
    if (this.s.hold && this.s.hold.offer.mid === mid) {
      const o = this.s.hold.offer;
      this.kill(mid);
      this.toSeeking();
      if (o.anchor === this.s.tid && (reason === 'window' || reason === 'unreachable')) this.block(o, reason);
      return;
    }
    if (this.s.check && this.s.check.offer.mid === mid) {
      const name = who === undefined ? undefined : this.s.peers[who]?.ticket?.name;
      this.kill(mid);
      this.toSeeking();
      this.effects.push({ kind: 'returned', reason: reason === 'declined' ? 'declined' : 'lapsed', ...(name ? { name } : {}) });
      return;
    }
    const o = this.s.offers.find((x) => x.mid === mid);
    if (o) {
      this.s.offers = this.s.offers.filter((x) => x.mid !== mid);
      if (o.anchor === this.s.tid && (reason === 'window' || reason === 'unreachable')) this.block(o, reason);
    }
    this.kill(mid);
  }
  anchorOffer(): void {
    const me = this.s.ticket;
    if (!me || this.s.phase !== 'seeking' || this.now < this.s.retryAt) return;
    const myWait = this.waitOf(this.s.tid);
    const others = Object.entries(this.s.peers)
      .filter(([tid, p]) => tid > this.s.tid && p.ticket !== null && p.since !== null && p.state !== 'held' && p.state !== 'check')
      .map(([tid, p]) => ({ c: p.ticket as Candidate, waitMs: this.waitOf(tid) }));
    for (const queue of me.queues) {
      const g = bestGroup({ c: me, waitMs: myWait }, others, queue, (a, b) => this.linked(a, b), (members) => this.blocked(queue, members));
      if (!g) continue;
      this.s.counter++;
      const mid = midOf(queue, g.members, this.s.tid, this.s.counter, this.s.salt);
      const ticketOf = (t: string): Ticket => (t === this.s.tid ? me : this.s.peers[t]!.ticket!);
      let teams: Record<string, 0 | 1> | null = null;
      if (queueParts(queue).format === '2hg') teams = splitTeams(g.members.map((t) => ({ tid: t, rating: ratingFor(ticketOf(t), queue) ?? 0 })));
      const members: OfferMember[] = g.members.map((t) => ({ tid: t, rev: ticketOf(t).rev, ...(teams ? { team: teams[t]! } : {}) }));
      const offer: HeldOffer = { mid, queue, members, anchor: this.s.tid };
      this.to(g.members, { v: 1, t: 'offer', mid, queue, members });
      this.addOffer(offer);
      return;
    }
  }
  tick(): void {
    const s = this.s;
    if (s.phase === 'collecting' && s.collectUntil !== null && this.now >= s.collectUntil) this.decide();
    if (s.phase === 'held' && s.hold && this.now >= s.hold.until) {
      const o = s.hold.offer;
      this.pass(o, 'stale');
      this.toSeeking();
    }
    if (s.phase === 'check' && s.check) {
      const c = s.check;
      if (!c.accepted && this.now >= c.deadline) {
        this.pass(c.offer, 'declined');
        this.toWatching();
        this.effects.push({ kind: 'stopped', reason: 'lapsed' });
      } else if (c.accepted && this.now >= c.deadline + CHECK_GRACE_MS) {
        this.pass(c.offer, 'stale');
        this.toSeeking();
        this.effects.push({ kind: 'returned', reason: 'lapsed' });
      }
    }
    if (s.phase === 'seeking') this.anchorOffer();
  }
  message(from: string, msg: LobbyMessage): void {
    const s = this.s;
    if (from === s.tid) return;
    const peer = (s.peers[from] ??= { ticket: null, since: null, state: 'watching', links: [] });
    switch (msg.t) {
      case 'seek': {
        if (msg.ticket.tid !== from) return;
        const old = peer.ticket;
        const est = this.now - msg.waitedMs;
        peer.since = old === null || peer.since === null ? est : Math.min(peer.since, est);
        peer.ticket = msg.ticket;
        if (peer.state === 'watching') peer.state = 'seeking';
        if (!old || old.rev !== msg.ticket.rev) this.clearBlocks((b) => b.members.includes(from));
        return;
      }
      case 'unseek': {
        this.out(from);
        peer.ticket = null;
        peer.since = null;
        peer.state = 'watching';
        return;
      }
      case 'beat': {
        const linksChanged = peer.links.join(',') !== [...msg.links].sort().join(',');
        peer.links = [...msg.links].sort();
        peer.state = msg.state;
        if (peer.ticket && msg.state !== 'watching' && peer.since !== null) peer.since = Math.min(peer.since, this.now - msg.waitedMs);
        if (linksChanged) this.clearBlocks((b) => b.reason === 'unreachable' && b.members.includes(from));
        return;
      }
      case 'offer': {
        const members = msg.members;
        if (!members.some((m) => m.tid === from) || !members.some((m) => m.tid === s.tid)) return;
        // An offer this browser already passed (a late copy, or a reused id): `stale` again, so its anchor moves on at once.
        if (s.dead.includes(msg.mid)) {
          this.to([from], { v: 1, t: 'pass', mid: msg.mid, reason: 'stale' });
          return;
        }
        const offer: HeldOffer = { mid: msg.mid, queue: msg.queue, members, anchor: from };
        // A member passed it before it reached this browser (reordering): it is over. Passes from anyone else are dropped.
        const early = s.early[msg.mid];
        if (early?.passes?.some((t) => members.some((m) => m.tid === t))) {
          this.kill(msg.mid);
          return;
        }
        if (early?.passes) {
          delete early.passes;
          if (Object.keys(early.holds).length === 0 && early.ready.length === 0) delete s.early[msg.mid];
        }
        if (s.phase === 'seeking' || s.phase === 'collecting') this.addOffer(offer);
        else if (s.hold?.offer.mid === msg.mid || s.check?.offer.mid === msg.mid) return;
        else this.pass(offer, s.phase === 'watching' ? 'stale' : 'busy');
        return;
      }
      case 'hold': {
        if (s.hold && s.hold.offer.mid === msg.mid) {
          if (s.hold.offer.members.some((m) => m.tid === from)) {
            s.hold.nonces = { ...s.hold.nonces, [from]: msg.nonce };
            this.completeHold();
          }
          return;
        }
        if (s.check?.offer.mid === msg.mid || s.dead.includes(msg.mid)) return;
        if (!s.early[msg.mid] && Object.keys(s.early).length >= MAX_EARLY) return;
        const e = (s.early[msg.mid] ??= { holds: {}, ready: [] });
        e.holds[from] = msg.nonce;
        return;
      }
      case 'pass': {
        const inPlay = s.hold?.offer.mid === msg.mid || s.check?.offer.mid === msg.mid || s.offers.some((o) => o.mid === msg.mid);
        if (!inPlay) {
          // Not (yet) an offer here: keep it until the offer arrives, where only a member's pass counts. Never kill an
          // unknown id on anyone's word (a stray pass would silence the real offer).
          if (s.dead.includes(msg.mid)) return;
          if (!s.early[msg.mid] && Object.keys(s.early).length >= MAX_EARLY) return;
          const e = (s.early[msg.mid] ??= { holds: {}, ready: [] });
          if (!(e.passes ?? []).includes(from)) e.passes = [...(e.passes ?? []), from];
          return;
        }
        const offer = s.hold?.offer.mid === msg.mid ? s.hold.offer : s.check?.offer.mid === msg.mid ? s.check.offer : s.offers.find((o) => o.mid === msg.mid);
        if (!offer?.members.some((m) => m.tid === from)) return;
        this.memberOut(msg.mid, msg.reason, from);
        return;
      }
      case 'ready': {
        if (s.check && s.check.offer.mid === msg.mid) {
          if (s.check.offer.members.some((m) => m.tid === from) && !s.check.ready.includes(from)) s.check.ready = [...s.check.ready, from];
          this.maybeFormed();
          return;
        }
        if (s.dead.includes(msg.mid)) return;
        if (!s.early[msg.mid] && Object.keys(s.early).length >= MAX_EARLY) return;
        const e = (s.early[msg.mid] ??= { holds: {}, ready: [] });
        if (!e.ready.includes(from)) e.ready.push(from);
        return;
      }
    }
  }
  /** A peer stopped seeking or left: whatever it was part of here ends. */
  out(tid: string): void {
    const s = this.s;
    if (s.hold && s.hold.offer.members.some((m) => m.tid === tid)) this.memberOut(s.hold.offer.mid, 'stale', tid);
    else if (s.check && s.check.offer.members.some((m) => m.tid === tid)) this.memberOut(s.check.offer.mid, 'declined', tid);
    for (const o of s.offers.filter((x) => x.members.some((m) => m.tid === tid))) this.memberOut(o.mid, 'stale', tid);
  }
}

function clone(s: BrokerState): BrokerState {
  return structuredClone(s);
}

/** One step of the broker. The input state is never changed. */
export function step(state: BrokerState, ev: BrokerEvent): StepResult {
  const st = new Stepper(clone(state), ev.now);
  const s = st.s;
  switch (ev.kind) {
    case 'tick':
      st.tick();
      break;
    case 'seek': {
      if (ev.ticket.tid !== s.tid) break;
      const starting = s.ticket === null;
      s.ticket = ev.ticket;
      if (starting || s.since === null) s.since = ev.now - (ev.waitedMs ?? 0);
      if (s.phase === 'watching') {
        s.phase = 'seeking';
        s.retryAt = ev.now;
      }
      s.blocks = [];
      if (s.phase === 'seeking') st.anchorOffer();
      break;
    }
    case 'cancel': {
      if (s.hold) st.pass(s.hold.offer, 'stale');
      if (s.check) st.pass(s.check.offer, 'declined');
      for (const o of s.offers) if (o.anchor === s.tid) st.pass(o, 'stale');
      if (s.phase !== 'moving') st.toWatching();
      break;
    }
    case 'links': {
      const next = [...ev.links].sort();
      if (next.join(',') !== s.links.join(',')) {
        s.links = next;
        st.clearBlocks((b) => b.reason === 'unreachable');
      }
      if (s.phase === 'seeking') st.anchorOffer();
      break;
    }
    case 'peerGone': {
      st.out(ev.tid);
      delete s.peers[ev.tid];
      s.links = s.links.filter((t) => t !== ev.tid);
      break;
    }
    case 'message':
      st.message(ev.from, ev.msg);
      if (s.phase === 'seeking') st.anchorOffer();
      break;
    case 'held':
      if (s.hold && s.hold.offer.mid === ev.mid) {
        s.hold.nonces = { ...s.hold.nonces, [s.tid]: ev.nonce };
        st.completeHold();
      }
      break;
    case 'answer': {
      const c = s.check;
      if (!c) break;
      if (ev.accept) {
        if (c.accepted) break;
        c.accepted = true;
        if (!c.ready.includes(s.tid)) c.ready = [...c.ready, s.tid];
        st.to(
          c.offer.members.map((m) => m.tid),
          { v: 1, t: 'ready', mid: c.offer.mid },
        );
        st.maybeFormed();
      } else {
        st.pass(c.offer, 'declined');
        st.toWatching();
        st.effects.push({ kind: 'stopped', reason: 'declined' });
      }
      break;
    }
  }
  return { state: st.s, send: st.send, effects: st.effects };
}
