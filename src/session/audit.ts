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
 * - Verdicts: net/audit.ts AuditLedger, fed with every sequenced action; one log line per verdict (a mismatch as a
 *   warning), placed after the seat's `auditPublish`, and the audit panel (ui/audit) through `AuditControls`.
 * - A reload rebuilds the ledger from the saved log, replayed from the room's seq-0 table; the replay must end on the
 *   confirmed state, else (a log with a gap) only later games are audited.
 */
import type { Action, ActionDraft } from '../core/actions';
import { buildAuditBundle, type AuditBundle, type AuditVerdict } from '../core/audit';
import { canonicalJson } from '../core/hash';
import type { LogEntry, SecretStore, SeatId, TableState } from '../core/types';
import { AUDIT_WAIT_MS, AuditLedger, verdictLine, type AuditControls, type AuditGameView, type LedgerGame } from '../net/audit';
import { applySequenced } from '../net/sequencer';
import type { SequencedAction } from '../net/messages';
import { registerDebug } from '../util/debug';

/** Refusals of one game's bundle before this browser stops proposing it. */
const PUBLISH_ATTEMPTS = 3;

/** What the audit needs from the session. */
export interface AuditPort {
  /** The own seat, or null while unseated. */
  seat(): SeatId | null;
  secrets(): SecretStore;
  pending(): readonly Action[];
  /** Stamp and propose a public action that is not undoable; false when refused locally. */
  propose(draft: ActionDraft): boolean;
  /** A system line in the own timeline, after the entry of `afterSeq` when given, else at the end. */
  log(level: 'info' | 'warn', text: string, afterSeq?: number): void;
  now(): number;
  /** Something the HUD shows changed. */
  changed(): void;
}

export class SessionAudit implements AuditControls {
  private ledger = new AuditLedger();
  private readonly listeners = new Set<() => void>();
  private readonly logged = new Set<string>();
  private readonly refusals = new Map<number, number>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;

  constructor(private readonly port: AuditPort) {}

  /**
   * Rebuild from a saved log: `base` is the room's seq-0 table, `entries` the saved timeline, `confirmed` the state the
   * engine stands at. The replay counts only when the log has no gap and ends on `confirmed`.
   */
  rebuild(base: TableState, entries: readonly LogEntry[], confirmed: TableState): void {
    this.ledger = new AuditLedger();
    const actions = entries.flatMap((e) => (e.kind === 'action' ? [{ a: e.action, seq: e.seq, at: e.at }] : []));
    if (actions.length > 0 && actions.every((x, i) => x.seq === i + 1) && confirmed.seq === actions.length) {
      const ledger = new AuditLedger();
      let st = base;
      const self = this.port.seat() ?? this.port.secrets().seat;
      for (const x of actions) {
        const next = applySequenced(st, { ...x.a, seq: x.seq } as SequencedAction);
        ledger.apply({ ...x.a, seq: x.seq } as Action, st, next, x.at, self);
        st = next;
      }
      if (canonicalJson(st) === canonicalJson(confirmed)) this.ledger = ledger;
    }
    this.refresh();
  }

  /** A sequenced action; `exact` when `next` follows from `prior` by this action alone. */
  sequenced(a: SequencedAction, prior: TableState, next: TableState, exact: boolean): void {
    if (this.disposed) return;
    if (!exact) {
      if (next !== prior) this.ledger.rebase(Math.min(a.seq, prior.seq + 1));
    } else {
      this.ledger.apply(a, prior, next, this.port.now(), this.port.seat());
    }
    this.refresh();
  }

  /** An own proposal was refused. */
  refused(a: Action): void {
    if (a.type !== 'auditPublish' || typeof a.bundle?.game?.game !== 'number') return;
    this.refusals.set(a.bundle.game.game, (this.refusals.get(a.bundle.game.game) ?? 0) + 1);
  }

  /** Propose the bundle of every finished game this browser played and has not published (see the module comment). */
  drive(): void {
    if (this.disposed) return;
    const me = this.port.seat();
    if (me === null) return;
    const sec = this.port.secrets();
    if (sec.seat !== me) return;
    for (const g of this.ledger.finished()) {
      if (g.bundles.has(me) || !this.played(g, me, sec)) continue;
      const n = g.game.game;
      if ((this.refusals.get(n) ?? 0) >= PUBLISH_ATTEMPTS) continue;
      if (this.port.pending().some((a) => a.type === 'auditPublish' && a.bundle.game.game === n)) continue;
      const bundle = buildAuditBundle(sec, g.game, g.log);
      if (!this.port.propose({ type: 'auditPublish', bundle })) this.refusals.set(n, (this.refusals.get(n) ?? 0) + 1);
    }
  }

  private played(g: LedgerGame, me: SeatId, sec: SecretStore): boolean {
    return (g.committed[me] ?? []).some((id) => Object.hasOwn(sec.identities, id));
  }

  /** Log every verdict that became final, arm the timer of a game still waiting, tell the listeners. */
  private refresh(): void {
    if (this.disposed) return;
    const now = this.port.now();
    let next: number | null = null;
    for (const g of this.ledger.finished()) {
      for (const seat of this.ledger.seatsOf(g)) {
        const v = this.ledger.verdict(g, seat, now);
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

  // --- AuditControls -----------------------------------------------------------------------------------------

  verdicts(): AuditVerdict[] {
    return this.ledger.verdicts(this.port.now());
  }

  published(): AuditBundle[] {
    return this.ledger.published();
  }

  games(): AuditGameView[] {
    return this.ledger.views(this.port.now());
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

/** The debug hook's `audit` part (debug/types.ts AuditDebug) for a session's audit. */
export function registerAuditDebug(audit: AuditControls): void {
  registerDebug({ audit: { verdicts: () => audit.verdicts(), published: () => audit.published() } });
}
