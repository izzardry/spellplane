/**
 * The audit ledger of one browser (DESIGN "Multiplayer architecture", Hidden information 6: "At game end each browser
 * can publish its nonces and order history. Peers replay them and confirm that every draw came from the committed
 * order"; PLAN Milestone 5, owner decisions: "Audit: automatic at game end", verdicts in the log and an audit panel,
 * missing records shown neutrally). Implementer: M5-P2.
 *
 * Fed with every sequenced action in log order (with the confirmed state before and after it), the ledger keeps, per
 * game of the evening, the state the game started from, the game's public log, its players and the first sequenced
 * `auditPublish` bundle of each seat. Verdicts come from the pure `verifyAudit` (core/audit.ts), so every peer that
 * holds the same log computes the same verdict for every seat. A seat that has not published is pending while the
 * audit waits for it (every player published, AUDIT_WAIT_MS passed on this browser's clock since the game ended, or
 * the next game started); afterwards it is "could not be checked: records missing", never a mismatch, and a bundle that
 * arrives later still replaces that with its verdict.
 */
import { AUDIT_STATUS_TEXT, auditSeats, verifyAudit, type AuditBundle, type AuditGame, type AuditVerdict } from '../core/audit';
import type { Action } from '../core/actions';
import { explain } from '../core/reducer/index';
import type { InstanceId, SeatId, TableState } from '../core/types';

/** How long a browser waits for the players' bundles after a game ended before it shows the missing ones as "could not be checked". */
export const AUDIT_WAIT_MS = 15_000;

/** One seat's line in the audit panel (PLAN M5-P2: "a per-player verdict and any mismatch"). */
export interface AuditSeatView {
  seat: SeatId;
  /** The seat's name and colour when the game ended. */
  name: string;
  colour: number;
  /** Null while the audit still waits for this seat's records. */
  verdict: AuditVerdict | null;
}

/** One finished game in the audit panel, oldest first. */
export interface AuditGameView {
  game: AuditGame;
  seats: AuditSeatView[];
  /** Every seat has a verdict. */
  done: boolean;
}

/**
 * The audit as a networked session offers it (session/audit.ts `sessionAudit`; the audit panel ui/audit/*; the debug
 * hook's `audit` part). Added by M5-P2.
 */
export interface AuditControls {
  /** Every verdict this page computed, oldest game first, seat order within a game (pending seats are left out). */
  verdicts(): AuditVerdict[];
  /** The bundles this browser published (sequenced), oldest first. */
  published(): AuditBundle[];
  /** The finished games with their seats, oldest first. */
  games(): AuditGameView[];
  /** Called when a verdict or a game changed; returns an unsubscribe function. */
  subscribe(listener: () => void): () => void;
}

/** A finished game as the ledger keeps it. */
export interface LedgerGame {
  game: AuditGame;
  /** The confirmed state just before `game.fromSeq`. */
  start: TableState;
  /** The sequenced actions `fromSeq` … `toSeq`. */
  log: Action[];
  players: SeatId[];
  /** Every instance id a seat committed to during the game (its deck, a recovery). */
  committed: Record<SeatId, InstanceId[]>;
  names: Record<SeatId, { name: string; colour: number }>;
  /** The first sequenced bundle of each seat, with the seq it came at. */
  bundles: Map<SeatId, { bundle: AuditBundle; seq: number }>;
  /** This browser's clock when the game's end was applied (or the entry's time on a replay). */
  endedAt: number;
}

interface OpenGame {
  game: number;
  fromSeq: number;
  start: TableState;
  log: Action[];
  committed: Map<SeatId, Set<InstanceId>>;
}

function collect(into: Map<SeatId, Set<InstanceId>>, st: TableState): void {
  for (const [seat, c] of Object.entries(st.commitments)) {
    const set = into.get(seat) ?? new Set<InstanceId>();
    for (const id of c.instanceIds) set.add(id);
    into.set(seat, set);
  }
}

/** What happened to the ledger with one action. */
export type LedgerEvent = 'none' | 'started' | 'ended' | 'bundle';

/** See the module comment. Pure apart from the clock values it is handed. */
export class AuditLedger {
  private readonly done: LedgerGame[] = [];
  private open: OpenGame | null = null;
  private readonly cache = new Map<string, AuditVerdict>();
  private readonly own: AuditBundle[] = [];

  /** Every finished game, oldest first. */
  finished(): readonly LedgerGame[] {
    return this.done;
  }

  /** Whether a game is being played (the ledger saw it start). */
  playing(): boolean {
    return this.open !== null;
  }

  /** The bundles of `self` the ledger saw sequenced. */
  published(): AuditBundle[] {
    return [...this.own];
  }

  /**
   * One sequenced action with the confirmed state before and after it (`next` as net/sequencer.ts applySequenced
   * gives it). `self` is this browser's seat (its bundles are listed by `published`), `at` its clock.
   */
  apply(a: Action, prior: TableState, next: TableState, at: number, self: SeatId | null): LedgerEvent {
    const seq = a.seq ?? next.seq;
    let event: LedgerEvent = 'none';
    if (this.open) {
      this.open.log.push(a);
      collect(this.open.committed, next);
    }
    if (prior.stage !== 'match' && next.stage === 'match') {
      const committed = new Map<SeatId, Set<InstanceId>>();
      collect(committed, prior);
      this.open = { game: next.games ?? 1, fromSeq: seq, start: prior, log: [a], committed };
      event = 'started';
    } else if (this.open && prior.stage === 'match' && next.stage !== 'match') {
      const o = this.open;
      this.open = null;
      const game: AuditGame = { game: o.game, fromSeq: o.fromSeq, toSeq: seq };
      const names: Record<SeatId, { name: string; colour: number }> = {};
      for (const [id, s] of Object.entries(prior.seats)) names[id] = { name: s.name, colour: s.colour };
      const committed: Record<SeatId, InstanceId[]> = {};
      for (const [seat, ids] of o.committed) committed[seat] = [...ids].sort();
      this.done.push({ game, start: o.start, log: o.log, players: auditSeats(o.start, o.log), committed, names, bundles: new Map(), endedAt: at });
      event = 'ended';
    }
    if (a.type === 'auditPublish' && explain(prior, { ...a, seq } as Action) === null) {
      // A bundle counts for the game whose span it names exactly (one built in an abandoned history names another span).
      const b = a.bundle.game;
      const g = this.done.find((x) => x.game.game === b.game && x.game.fromSeq === b.fromSeq && x.game.toSeq === b.toSeq);
      if (g && !g.bundles.has(a.by)) {
        g.bundles.set(a.by, { bundle: a.bundle, seq });
        if (a.by === self) this.own.push(a.bundle);
        event = 'bundle';
      }
    }
    return event;
  }

  /**
   * The table was caught up from a snapshot or rewound to another history at `fromSeq`, now standing at `state`: games
   * that reach `fromSeq` or later are dropped (their log may have been replaced), and so is a game in progress (its
   * start is no longer known; it is not audited by this browser). Later games are followed as usual.
   */
  rebase(fromSeq: number): void {
    this.open = null;
    for (let i = this.done.length - 1; i >= 0; i--) {
      if (this.done[i]!.game.toSeq >= fromSeq) this.done.splice(i, 1);
    }
    this.cache.clear();
  }

  /** Whether the audit of `g` still waits for a player's records at `now`. */
  waiting(g: LedgerGame, now: number): boolean {
    if (g.players.every((s) => g.bundles.has(s))) return false;
    if (now - g.endedAt >= AUDIT_WAIT_MS) return false;
    // The next game started: whoever has not published by then has left the table.
    return !(this.done.some((x) => x.game.game > g.game.game) || this.open !== null);
  }

  /** The seats of a finished game: its players, then any other seat that published, in seat order. */
  seatsOf(g: LedgerGame): SeatId[] {
    const extra = [...g.bundles.keys()].filter((s) => !g.players.includes(s));
    const index = (s: SeatId): number => g.start.seats[s]?.index ?? Number.MAX_SAFE_INTEGER;
    return [...g.players, ...extra].sort((a, b) => index(a) - index(b) || (a < b ? -1 : a > b ? 1 : 0));
  }

  /** The verdict on `seat` in `g` at `now`, or null while the audit still waits for its records. */
  verdict(g: LedgerGame, seat: SeatId, now: number): AuditVerdict | null {
    const b = g.bundles.get(seat);
    if (!b && this.waiting(g, now)) return null;
    const key = `${g.game.game}|${seat}|${b ? b.seq : 'none'}`;
    let v = this.cache.get(key);
    if (!v) {
      v = verifyAudit({ seat, game: g.game, bundle: b ? b.bundle : null, start: g.start, log: g.log });
      this.cache.set(key, v);
    }
    return v;
  }

  /** The finished games as the panel shows them at `now`. */
  views(now: number): AuditGameView[] {
    return this.done.map((g) => {
      const seats = this.seatsOf(g).map((seat): AuditSeatView => ({
        seat,
        name: g.names[seat]?.name || seat,
        colour: g.names[seat]?.colour ?? 0,
        verdict: this.verdict(g, seat, now),
      }));
      return { game: g.game, seats, done: seats.every((s) => s.verdict !== null) };
    });
  }

  /** Every verdict at `now`, oldest game first, seat order within a game. */
  verdicts(now: number): AuditVerdict[] {
    return this.views(now).flatMap((g) => g.seats.flatMap((s) => (s.verdict ? [s.verdict] : [])));
  }
}

function plural(n: number, one: string): string {
  return `${n} ${n === 1 ? one : `${one}s`}`;
}

/** One verdict as one plain sentence: the log line's and the panel's words (PLAN M5 owner decisions). */
export function verdictText(v: AuditVerdict): string {
  switch (v.status) {
    case 'verified':
      return `${AUDIT_STATUS_TEXT.verified}: ${plural(v.shuffles, 'shuffle')} and ${plural(v.draws, 'draw')} checked`;
    case 'mismatch': {
      const first = v.mismatches[0];
      const more = v.mismatches.length > 1 ? ` (and ${v.mismatches.length - 1} more)` : '';
      return `${AUDIT_STATUS_TEXT.mismatch}: ${first ? first.detail : 'the records disagree with the table'}${more}`;
    }
    case 'unverifiable':
      return `${AUDIT_STATUS_TEXT.unverifiable} (${v.detail})`;
  }
}

/** The log line of a verdict, as "Audit of game 2: Ben — verified: 3 shuffles and 21 draws checked". */
export function verdictLine(v: AuditVerdict, name: string): string {
  return `Audit of game ${v.game}: ${name} — ${verdictText(v)}`;
}
