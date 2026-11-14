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
 * - Only into a history in which every player has seen the game end: the bundle shows the library orders, and a
 *   history may be abandoned for one in which the game is still being played (DESIGN "Resume and failure handling":
 *   later arrivals reconcile to the copy with the highest sequence number; a player cut off just before the end plays
 *   on alone). So a bundle is proposed only once every other seat that holds a chair acknowledged the game's end in
 *   this browser's history (`acks`), whether or not it played the game (a peer who sat down mid-match without a deck
 *   sequences like any other, so it may hold a history in which the game goes on; the verdicts still cover only the
 *   game's players): its heartbeat names the sequencer this browser follows, in step,
 *   at a seq at or after the end and not ahead of this browser (a peer further ahead may hold another history), or
 *   its own bundle of the game is sequenced here. Every history that can win a reconciliation then holds the end. A
 *   player who answered nothing (the pass timer answered for them) acknowledges like any other; one who left before
 *   the end holds the bundle until they are back or their chair is free, and the own row says so ("waiting for
 *   records", held for Ben). Acknowledgements are dropped when the history is rewound or caught up from a snapshot,
 *   and none is taken after a change of sequencer until this browser applied an action from the new one in step.
 *   And the transport never carries an own `auditPublish`
 *   proposal that the confirmed history does not accept as the end of a game the ledger saw (the engine proposes an
 *   abandoned history's own actions again after adopting another one, net/engine.ts requeueLost): `outgoing` replaces
 *   such a bundle by a withheld stub every reducer refuses, so the proposal is rolled back without its records.
 * - Verdicts: net/audit.ts AuditLedger, fed with every sequenced action; one log line per verdict (a mismatch as a
 *   warning), placed after the seat's `auditPublish`, and the audit panel (ui/audit) through `AuditControls`. The line
 *   of a seat without a bundle (the wait ran out on this browser's clock) says the records are missing so far: a bundle
 *   published later is still checked and gets a line of its own, so peers may differ in that line, never in a verdict.
 * - A reload, a rewind to another history or a catch-up rebuilds the ledger from the saved log, replayed from the
 *   room's seq-0 table or the latest saved snapshot; the replay must end on the confirmed state, else (a log with a gap)
 *   the ledger drops the games it can no longer follow and only later games are audited.
 */
import type { Action, ActionDraft } from '../core/actions';
import { AUDIT_STATUS_TEXT, buildAuditBundle, type AuditBundle, type AuditVerdict } from '../core/audit';
import { canonicalJson } from '../core/hash';
import { explain } from '../core/reducer/index';
import type { LogEntry, SecretStore, SeatId, TableState } from '../core/types';
import { AUDIT_WAIT_MS, AuditLedger, verdictLine, type AuditControls, type AuditGameView, type LedgerGame } from '../net/audit';
import { applySequenced, seatOfPeer } from '../net/sequencer';
import type { SequencedAction } from '../net/messages';
import type { PeerInfo } from '../net/types';
import type { Channel, Message, PeerId, Transport } from '../net/transport';
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
  /** The engine's peers (transport id, identity, status, role). */
  peers(): readonly PeerInfo[];
  /** The peer id of the sequencer this browser follows (itself when it sequences), or null. */
  sequencer(): string | null;
  /** Whether this browser is the sequencer. */
  isSequencer(): boolean;
  /** Whether the engine is in step with the room (status 'connected': no catch-up, claim or overlap read under way). */
  inStep(): boolean;
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
  /** Per seat: the highest seq of this browser's history its browser acknowledged (see the module comment). */
  private readonly acks = new Map<SeatId, number>();
  /** This browser sequences, or applied an action in step since the sequencer last changed (its acks may count). */
  private followed = false;
  /** The games whose own bundle is held, with the seats they wait for (a change is shown). */
  private holdKey = '';
  private wakeQueued = false;
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
      this.acks.clear();
      this.followed = false;
    }
    this.ledger = this.replay(entries, confirmed) ?? new AuditLedger();
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
        this.acks.clear();
        this.followed = false;
        this.queueRebuild();
      }
    } else {
      this.ledger.apply(a, prior, next, this.port.now(), this.port.seat());
      this.followed = true;
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
    const n = (this.refusals.get(a.bundle.game.game) ?? 0) + 1;
    this.refusals.set(a.bundle.game.game, n);
    // Given up: the own row shows what the others see.
    if (n >= PUBLISH_ATTEMPTS) this.refresh();
    return false;
  }

  /** The sequencer changed: acknowledgements count again once this browser applied an action from it in step. */
  sequencerChanged(): void {
    this.followed = false;
  }

  /**
   * A message the engine received (before the engine handles it): a peer's heartbeat acknowledges the seq it reports
   * when it follows the sequencer this browser follows and this browser is in step with it (see the module comment).
   */
  incoming(channel: Channel, from: string, msg: Message): void {
    if (this.disposed || channel !== 'ctl' || msg.t !== 'hb') return;
    const seq = msg.seq;
    const named = msg.sequencer;
    const sequencer = this.port.sequencer();
    if (typeof seq !== 'number' || !Number.isSafeInteger(seq) || sequencer === null || named !== sequencer) return;
    if (!this.port.inStep() || !(this.followed || this.port.isSequencer())) return;
    const info = this.port.peers().find((p) => p.transportId === from);
    if (!info || info.status === 'handshake' || info.role !== 'player' || info.peerId === '') return;
    const st = this.port.confirmed();
    const seat = seatOfPeer(st, info.peerId);
    if (seat === null) return;
    // The sequencer's history is the one this browser follows: it holds this browser's seqs up to its own. Another
    // peer ahead of this browser may hold a history the sequencer has not adopted (yet).
    let at: number;
    if (info.peerId === sequencer) at = Math.min(seq, st.seq);
    else if (seq <= st.seq) at = seq;
    else return;
    if (at <= (this.acks.get(seat) ?? -1)) return;
    this.acks.set(seat, at);
    if (this.holdKey !== '') this.wake();
  }

  private wake(): void {
    if (this.wakeQueued) return;
    this.wakeQueued = true;
    queueMicrotask(() => {
      this.wakeQueued = false;
      this.drive();
    });
  }

  /**
   * The other seats that hold a chair now and have not acknowledged the game's end in this browser's history (see the
   * module comment); the own bundle waits for them. Every chair counts, not only the game's players: a peer who sat down
   * in a free chair without a deck sequences like any other and may hold a history in which the game is still on.
   */
  private blockers(g: LedgerGame, me: SeatId): SeatId[] {
    const st = this.port.confirmed();
    return Object.values(st.seats)
      .filter((seat) => {
        if (seat.id === me || seat.name.trim() === '' || g.bundles.has(seat.id)) return false;
        return (this.acks.get(seat.id) ?? -1) < g.game.toSeq;
      })
      .sort((x, y) => x.index - y.index)
      .map((seat) => seat.id);
  }

  /** Whether this browser may still publish its own bundle of `g` (it played the game, has not published, not given up). */
  private canPublish(g: LedgerGame, me: SeatId | null): me is SeatId {
    if (me === null || g.bundles.has(me)) return false;
    const sec = this.port.secrets();
    return sec.seat === me && this.played(g, me, sec) && (this.refusals.get(g.game.game) ?? 0) < PUBLISH_ATTEMPTS;
  }

  /** Propose the bundle of every finished game this browser played and has not published (see the module comment). */
  drive(): void {
    if (this.disposed) return;
    const held: string[] = [];
    const me = this.port.seat();
    for (const g of this.ledger.finished()) {
      if (!this.canPublish(g, me)) continue;
      const n = g.game.game;
      const blockers = this.blockers(g, me);
      if (blockers.length > 0) {
        held.push(`${n}:${blockers.join(',')}`);
        continue;
      }
      if (this.port.pending().some((a) => a.type === 'auditPublish' && a.bundle?.game?.game === n)) continue;
      let bundle = buildAuditBundle(this.port.secrets(), g.game, g.log);
      if (__SPELLPLANE_DEBUG__ && tamperNext?.has(this) === true) bundle = tampered(bundle);
      if (!this.port.propose({ type: 'auditPublish', bundle })) this.refusals.set(n, (this.refusals.get(n) ?? 0) + 1);
      else if (__SPELLPLANE_DEBUG__) tamperNext?.delete(this);
    }
    const key = held.join('|');
    if (key !== this.holdKey) {
      this.holdKey = key;
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
    return g !== undefined && explain(this.port.confirmed(), a) === null && this.blockers(g, me).length === 0;
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
        const name = g.names[seat]?.name || seat;
        // Without a bundle the line is provisional: a bundle that arrives later is still checked (and logged).
        const line = b ? verdictLine(v, name) : `Audit of game ${v.game}: ${name} — ${AUDIT_STATUS_TEXT.unverifiable} (none published so far; records published later are still checked)`;
        this.port.log(v.status === 'mismatch' ? 'warn' : 'info', line, b?.seq);
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

  /** The ledger's verdict, except that the own seat stays pending while this browser may still publish its bundle. */
  private verdictOf(g: LedgerGame, seat: SeatId, me: SeatId | null, now: number): AuditVerdict | null {
    if (seat === me && this.canPublish(g, me)) return null;
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
      if (!g || !this.canPublish(g, me)) return view;
      const st = this.port.confirmed();
      const held = this.blockers(g, me).map((p) => {
        const name = st.seats[p]?.name.trim() || g.names[p]?.name || p;
        return st.seats[p]?.away === true ? `${name} (away)` : name;
      });
      const note = held.length > 0 ? `Published once ${list(held)} ${held.length === 1 ? 'has' : 'have'} the game's end` : undefined;
      const seats = view.seats.map((s) => (s.seat === me ? { ...s, verdict: null, ...(note ? { note } : {}) } : s));
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

function list(names: readonly string[]): string {
  return names.length <= 1 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
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
 * proposals, `SessionAudit.outgoing`) and every incoming one shown to `observe` before its handler (the audit's
 * acknowledgements, `SessionAudit.incoming`); everything else is the transport's own.
 */
export function gatedTransport(transport: Transport, gate: (channel: Channel, msg: Message) => Message, observe?: (channel: Channel, from: PeerId, msg: Message) => void): Transport {
  const t: Transport = {
    get selfId() {
      return transport.selfId;
    },
    join: (roomId, roomKey) => transport.join(roomId, roomKey),
    leave: () => transport.leave(),
    peers: () => transport.peers(),
    send: (channel, msg, to) => transport.send(channel, gate(channel, msg), to),
    on: (channel, handler) =>
      transport.on(
        channel,
        observe
          ? (msg, from) => {
              try {
                observe(channel, from, msg);
              } catch (e) {
                console.error('audit observer failed', e);
              }
              handler(msg, from);
            }
          : handler,
      ),
    onPeer: (handler) => transport.onPeer(handler),
  };
  if (transport.addStream) t.addStream = (stream, to) => transport.addStream!(stream, to);
  if (transport.removeStream) t.removeStream = (stream, to) => transport.removeStream!(stream, to);
  if (transport.onStream) t.onStream = (handler) => transport.onStream!(handler);
  return t;
}

/**
 * Test builds only (the debug hook's `audit.tamper`): the audits whose next own bundle carries a rewritten library
 * order. Every use sits behind `__SPELLPLANE_DEBUG__`, so production builds contain none of it (DECISIONS [M5-review]).
 */
let tamperNext: WeakSet<SessionAudit> | null = null;

/**
 * Test-only (M5 gate: "a tampered game shows a mismatch"; reached through the debug hook, which production builds do
 * not have, and a no-op there): the next bundle `audit` publishes reports its first shuffle's resulting library order
 * with the top two cards swapped, as a browser that lied about its library order would. The other browsers' replay of
 * the nonces then disagrees with it, and the audit reports a mismatch for this seat.
 */
export function tamperNextBundle(audit: SessionAudit): void {
  if (!__SPELLPLANE_DEBUG__) return;
  (tamperNext ??= new WeakSet()).add(audit);
}

/** A bundle whose first shuffle (or else first reorder) reports its top two cards swapped (tamperNextBundle; test builds only). */
function tampered(bundle: AuditBundle): AuditBundle {
  let i = bundle.records.findIndex((r) => r.kind === 'shuffle' && r.order.length >= 2);
  if (i < 0) i = bundle.records.findIndex((r) => r.order.length >= 2);
  if (i < 0) return bundle;
  const records = bundle.records.map((r, k) => {
    if (k !== i) return r;
    const order = [...r.order];
    [order[0], order[1]] = [order[1]!, order[0]!];
    return { ...r, order };
  });
  return { ...bundle, records };
}

/**
 * The debug hook's `audit` part (debug/types.ts AuditDebug) for a session's audit; the result unregisters it. With
 * `tamper` the part also offers the test-only `tamper()` (SessionAudit.tamper; the hook exists in dev and test builds
 * only).
 */
export function registerAuditDebug(audit: AuditControls, tamper?: () => void): () => void {
  const part = { verdicts: () => audit.verdicts(), published: () => audit.published(), ...(__SPELLPLANE_DEBUG__ && tamper ? { tamper } : {}) };
  registerDebug({ audit: part });
  return () => {
    if (typeof window !== 'undefined' && window.__spellplane?.audit === part) delete window.__spellplane.audit;
  };
}
