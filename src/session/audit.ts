/**
 * The networked session's post-game audit (DESIGN "Multiplayer architecture", Hidden information 6; "Specification:
 * network protocol and secrecy", Secret shuffle 5 and private reorder; PLAN Milestone 5, owner decisions: "Audit:
 * automatic at game end"). Implementer: M5-P2.
 *
 * - Publishing: when a game ends ("Next game", or the evening goes back to the lobby: "New draft" or its end), this
 *   browser proposes one `auditPublish {bundle}` for every finished game it played and has not published yet
 *   (core/audit.ts buildAuditBundle: its shuffle and reorder records of that game, stripped of identities). Never before
 *   the game ended: the reducer refuses that too. It played a game when its secret store holds an identity of a card
 *   its seat committed to in that game, so a browser that sits down later in the same chair never speaks for the
 *   player before it. A refused bundle is tried again up to three times.
 * - Only into a history the other players share: the bundle shows the library orders, and a history this browser
 *   sequenced alone (cut off, the others marked away or timed out) may be abandoned for one in which the game is still
 *   being played (DESIGN "Resume and failure handling": later arrivals reconcile to the copy with the highest sequence
 *   number). So a bundle is proposed only once every other player of the game who still holds a chair has acted in
 *   this browser's history after the last time the sequencer marked them away or answered a round for them (`marks`).
 *   Until then the own row stays "waiting for records". And the transport never carries an own `auditPublish`
 *   proposal that the confirmed history does not accept as the end of a game the ledger saw (the engine proposes an
 *   abandoned history's own actions again after adopting another one, net/engine.ts requeueLost): `outgoing` replaces
 *   such a bundle by a withheld stub every reducer refuses, so the proposal is rolled back without its records.
 * - Verdicts: net/audit.ts AuditLedger, fed with every sequenced action; one log line per verdict (a mismatch as a
 *   warning), placed after the seat's `auditPublish`, and the audit panel (ui/audit) through `AuditControls`.
 * - A reload, a rewind to another history or a catch-up rebuilds the ledger from the saved log, replayed from the
 *   room's seq-0 table or the latest saved snapshot; the replay must end on the confirmed state, else (a log with a gap)
 *   the ledger drops the games it can no longer follow and only later games are audited.
 */
import type { Action, ActionDraft } from '../core/actions';
import { buildAuditBundle, type AuditBundle, type AuditVerdict } from '../core/audit';
import { canonicalJson } from '../core/hash';
import { explain } from '../core/reducer/index';
import type { LogEntry, SecretStore, SeatId, TableState } from '../core/types';
import { AUDIT_WAIT_MS, AuditLedger, verdictLine, type AuditControls, type AuditGameView, type LedgerGame } from '../net/audit';
import { applySequenced } from '../net/sequencer';
import type { SequencedAction } from '../net/messages';
import type { Channel, Message, Transport } from '../net/transport';
import { registerDebug } from '../util/debug';

/** Refusals of one game's bundle before this browser stops proposing it. */
const PUBLISH_ATTEMPTS = 3;

/** What the audit needs from the session. */
export interface AuditPort {
  /** The own seat, or null while unseated. */
  seat(): SeatId | null;
  secrets(): SecretStore;
  pending(): readonly Action[];
  /** The engine's confirmed state. */
  confirmed(): TableState;
  /** The session's timeline (sequenced actions and system lines, oldest first). */
  entries(): readonly LogEntry[];
  /** Stamp and propose a public action that is not undoable; false when refused locally. */
  propose(draft: ActionDraft): boolean;
  /** A system line in the own timeline, after the entry of `afterSeq` when given, else at the end. */
  log(level: 'info' | 'warn', text: string, afterSeq?: number): void;
  now(): number;
  /** Something the HUD shows changed. */
  changed(): void;
}

/** Per seat: the seq of its latest own action and of the latest time the sequencer marked it away or answered for it. */
interface Marks {
  own: number;
  silent: number;
}

/** The replacement of a bundle the transport must not carry (see the module comment); no reducer accepts it. */
const WITHHELD = { withheld: true } as const;

export class SessionAudit implements AuditControls {
  private ledger = new AuditLedger();
  private readonly listeners = new Set<() => void>();
  private readonly logged = new Set<string>();
  private readonly refusals = new Map<number, number>();
  /** Cids of own `auditPublish` proposals the transport withheld (their rollback is no refusal). */
  private readonly withheld = new Set<string>();
  private marks = new Map<SeatId, Marks>();
  /** Games whose own bundle waits for the other players to share this history (the own row stays pending). */
  private holding = new Set<number>();
  /** The states a rebuild may replay from: the room's seq-0 table, the latest saved snapshot. */
  private bases: TableState[] = [];
  private rebuildQueued = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;

  constructor(private readonly port: AuditPort) {}

  /**
   * Rebuild from a saved log: `bases` are the states a replay may start from (the room's seq-0 table, the latest saved
   * snapshot), `entries` the saved timeline, `confirmed` the state the engine stands at. A replay counts only when the
   * log after its base has no gap and ends on `confirmed`; without one the ledger starts empty. `fresh`: another table
   * (the abandoned alone table's verdicts and refusals are forgotten).
   */
  rebuild(bases: readonly TableState[], entries: readonly LogEntry[], confirmed: TableState, fresh = false): void {
    this.bases = [...bases];
    if (fresh) {
      this.logged.clear();
      this.refusals.clear();
      this.withheld.clear();
    }
    this.ledger = this.replay(entries, confirmed) ?? new AuditLedger();
    this.marks = marksOf(entries);
    this.refresh();
  }

  /** A ledger replayed from the first base after which `entries` run without a gap to `confirmed`, or null. */
  private replay(entries: readonly LogEntry[], confirmed: TableState): AuditLedger | null {
    const actions = entries.flatMap((e) => (e.kind === 'action' ? [{ a: e.action, seq: e.seq, at: e.at }] : []));
    const self = this.port.seat() ?? this.port.secrets().seat;
    for (const base of this.bases) {
      const tail = actions.filter((x) => x.seq > base.seq);
      if (base.seq + tail.length !== confirmed.seq || !tail.every((x, i) => x.seq === base.seq + 1 + i)) continue;
      const ledger = new AuditLedger();
      let st = base;
      for (const x of tail) {
        const next = applySequenced(st, { ...x.a, seq: x.seq } as SequencedAction);
        ledger.apply({ ...x.a, seq: x.seq } as Action, st, next, x.at, self);
        st = next;
      }
      if (canonicalJson(st) === canonicalJson(confirmed)) return ledger;
    }
    return null;
  }

  /** A sequenced action; `exact` when `next` follows from `prior` by this action alone. */
  sequenced(a: SequencedAction, prior: TableState, next: TableState, exact: boolean): void {
    if (this.disposed) return;
    if (!exact) {
      if (next !== prior) {
        // A rewind to another history or a catch-up: drop what may have been replaced now, and replay the saved log
        // once the engine has settled (the game in progress is kept when the log still runs without a gap).
        this.ledger.rebase(Math.min(a.seq, prior.seq + 1));
        this.queueRebuild();
      }
    } else {
      this.ledger.apply(a, prior, next, this.port.now(), this.port.seat());
      noteMarks(this.marks, a);
    }
    this.refresh();
  }

  private queueRebuild(): void {
    if (this.rebuildQueued) return;
    this.rebuildQueued = true;
    queueMicrotask(() => {
      this.rebuildQueued = false;
      if (this.disposed) return;
      const entries = this.port.entries();
      this.marks = marksOf(entries);
      const ledger = this.replay(entries, this.port.confirmed());
      if (ledger) this.ledger = ledger;
      this.refresh();
      this.drive();
    });
  }

  /** An own proposal was refused; true when it was a bundle the transport withheld (no refusal, nothing to report). */
  refused(a: Action): boolean {
    if (a.type !== 'auditPublish') return false;
    if (this.withheld.delete(a.cid)) return true;
    if (typeof a.bundle?.game?.game !== 'number') return false;
    this.refusals.set(a.bundle.game.game, (this.refusals.get(a.bundle.game.game) ?? 0) + 1);
    return false;
  }

  /**
   * Whether every other player of `g` who still holds a chair follows this browser's history past the game's end: it
   * acted here after the latest time the sequencer marked it away or answered a round for it.
   */
  private shared(g: LedgerGame, me: SeatId): boolean {
    const st = this.port.confirmed();
    for (const p of g.players) {
      if (p === me) continue;
      const seat = st.seats[p];
      if (!seat || seat.name.trim() === '') continue;
      if (seat.away === true) return false;
      const m = this.marks.get(p);
      if (m && m.silent >= 0 && m.own <= m.silent) return false;
    }
    return true;
  }

  /** Propose the bundle of every finished game this browser played and has not published (see the module comment). */
  drive(): void {
    if (this.disposed) return;
    const holding = new Set<number>();
    const me = this.port.seat();
    const sec = this.port.secrets();
    if (me !== null && sec.seat === me) {
      for (const g of this.ledger.finished()) {
        if (g.bundles.has(me) || !this.played(g, me, sec)) continue;
        const n = g.game.game;
        if ((this.refusals.get(n) ?? 0) >= PUBLISH_ATTEMPTS) continue;
        if (!this.shared(g, me)) {
          holding.add(n);
          continue;
        }
        if (this.port.pending().some((a) => a.type === 'auditPublish' && a.bundle.game.game === n)) continue;
        const bundle = buildAuditBundle(sec, g.game, g.log);
        if (!this.port.propose({ type: 'auditPublish', bundle })) this.refusals.set(n, (this.refusals.get(n) ?? 0) + 1);
      }
    }
    if (!sameSet(holding, this.holding)) {
      this.holding = holding;
      this.refresh();
      this.port.changed();
    }
  }

  private played(g: LedgerGame, me: SeatId, sec: SecretStore): boolean {
    return (g.committed[me] ?? []).some((id) => Object.hasOwn(sec.identities, id));
  }

  /**
   * A message the engine sends (see the module comment): an own `auditPublish` proposal goes out with its records only
   * when the confirmed state accepts it, the ledger holds a finished game with exactly its span, and that game's end is
   * shared; otherwise its bundle is replaced by a stub no reducer accepts.
   */
  outgoing(channel: Channel, msg: Message): Message {
    if (channel !== 'act' || msg.t !== 'propose') return msg;
    const a = msg.action as Action | undefined;
    if (!a || a.type !== 'auditPublish') return msg;
    if (this.mayCarry(a)) return msg;
    this.withheld.add(a.cid);
    return { ...msg, action: { ...a, bundle: WITHHELD } };
  }

  private mayCarry(a: Extract<Action, { type: 'auditPublish' }>): boolean {
    const me = this.port.seat();
    if (me === null || a.by !== me) return false;
    const span = a.bundle?.game;
    const g = this.ledger.finished().find((x) => x.game.game === span?.game && x.game.fromSeq === span.fromSeq && x.game.toSeq === span.toSeq);
    return g !== undefined && explain(this.port.confirmed(), a) === null && this.shared(g, me);
  }

  /** Log every verdict that became final, arm the timer of a game still waiting, tell the listeners. */
  private refresh(): void {
    if (this.disposed) return;
    const now = this.port.now();
    const me = this.port.seat();
    let next: number | null = null;
    for (const g of this.ledger.finished()) {
      for (const seat of this.ledger.seatsOf(g)) {
        const v = this.verdictOf(g, seat, me, now);
        if (v === null) continue;
        const b = g.bundles.get(seat);
        const key = `${g.game.game}|${seat}|${b ? b.seq : 'none'}`;
        if (this.logged.has(key)) continue;
        this.logged.add(key);
        this.port.log(v.status === 'mismatch' ? 'warn' : 'info', verdictLine(v, g.names[seat]?.name || seat), b?.seq);
      }
      if (this.ledger.waiting(g, now)) next = Math.min(next ?? Infinity, g.endedAt + AUDIT_WAIT_MS);
    }
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    if (next !== null) {
      this.timer = setTimeout(
        () => {
          this.timer = null;
          this.refresh();
          this.port.changed();
        },
        Math.max(0, next - now),
      );
    }
    for (const l of [...this.listeners]) {
      try {
        l();
      } catch (e) {
        console.error('audit listener failed', e);
      }
    }
  }

  /** The ledger's verdict, except that the own seat stays pending while its bundle is held back. */
  private verdictOf(g: LedgerGame, seat: SeatId, me: SeatId | null, now: number): AuditVerdict | null {
    if (seat === me && !g.bundles.has(seat) && this.holding.has(g.game.game)) return null;
    return this.ledger.verdict(g, seat, now);
  }

  // --- AuditControls -----------------------------------------------------------------------------------------

  verdicts(): AuditVerdict[] {
    return this.games().flatMap((g) => g.seats.flatMap((s) => (s.verdict ? [s.verdict] : [])));
  }

  published(): AuditBundle[] {
    return this.ledger.published();
  }

  games(): AuditGameView[] {
    const me = this.port.seat();
    const finished = this.ledger.finished();
    return this.ledger.views(this.port.now()).map((view, i) => {
      const g = finished[i];
      if (me === null || !g || g.bundles.has(me) || !this.holding.has(view.game.game)) return view;
      const seats = view.seats.map((s) => (s.seat === me ? { ...s, verdict: null } : s));
      return { ...view, seats, done: false };
    });
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  dispose(): void {
    this.disposed = true;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    this.listeners.clear();
  }
}

function sameSet(a: ReadonlySet<number>, b: ReadonlySet<number>): boolean {
  return a.size === b.size && [...a].every((x) => b.has(x));
}

/** Update `marks` with one sequenced action (see `Marks`). */
function noteMarks(marks: Map<SeatId, Marks>, a: Action): void {
  const seq = a.seq ?? 0;
  const at = (seat: SeatId): Marks => {
    let m = marks.get(seat);
    if (!m) marks.set(seat, (m = { own: -1, silent: -1 }));
    return m;
  };
  if (typeof a.by === 'string') at(a.by).own = seq;
  if (a.type === 'away' && a.away && a.seat !== a.by) at(a.seat).silent = seq;
  if (a.type === 'respond' && a.response === 'timeout' && a.seat !== a.by) at(a.seat).silent = seq;
}

function marksOf(entries: readonly LogEntry[]): Map<SeatId, Marks> {
  const marks = new Map<SeatId, Marks>();
  for (const e of entries) if (e.kind === 'action') noteMarks(marks, { ...e.action, seq: e.seq } as Action);
  return marks;
}

/** The sessions' audits, for the stage view (ui/flow/Stage.svelte) without a contract member on `TableSession`. */
const AUDITS = new WeakMap<object, AuditControls>();

/** Register `audit` as the audit of `session`. */
export function attachAudit(session: object, audit: AuditControls): void {
  AUDITS.set(session, audit);
}

/** The audit of a networked session; undefined in solo play and for spectators. */
export function sessionAudit(session: object): AuditControls | undefined {
  return AUDITS.get(session);
}

/**
 * `transport` with every outgoing message passed through `gate` first (the audit's check of own `auditPublish`
 * proposals, `SessionAudit.outgoing`); everything else is the transport's own.
 */
export function gatedTransport(transport: Transport, gate: (channel: Channel, msg: Message) => Message): Transport {
  const t: Transport = {
    get selfId() {
      return transport.selfId;
    },
    join: (roomId, roomKey) => transport.join(roomId, roomKey),
    leave: () => transport.leave(),
    peers: () => transport.peers(),
    send: (channel, msg, to) => transport.send(channel, gate(channel, msg), to),
    on: (channel, handler) => transport.on(channel, handler),
    onPeer: (handler) => transport.onPeer(handler),
  };
  if (transport.addStream) t.addStream = (stream, to) => transport.addStream!(stream, to);
  if (transport.removeStream) t.removeStream = (stream, to) => transport.removeStream!(stream, to);
  if (transport.onStream) t.onStream = (handler) => transport.onStream!(handler);
  return t;
}

/** The debug hook's `audit` part (debug/types.ts AuditDebug) for a session's audit. */
export function registerAuditDebug(audit: AuditControls): void {
  registerDebug({ audit: { verdicts: () => audit.verdicts(), published: () => audit.published() } });
}
