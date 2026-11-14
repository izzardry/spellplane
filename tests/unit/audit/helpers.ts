/**
 * A two-seat game through the pure core (PLAN M5-P2 unit tests): the secrecy table of tests/unit/secrecy/helpers.ts
 * with the secret shuffle, draws, private reorders and the stage changes that start and end a game, so the audit can
 * be checked against a genuine public log and genuine owner records without any network.
 */
import { auditGames, buildAuditBundle, type AuditBundle, type AuditGame, type AuditInput } from '../../../src/core/audit';
import type { Action } from '../../../src/core/actions';
import { reduce } from '../../../src/core/reducer';
import { beginShuffle, finishShuffle, privateReorder, reissueZone } from '../../../src/core/secrets';
import type { InstanceId, SeatId, TableState, ZoneId } from '../../../src/core/types';
import { reconcileSecrets } from '../../../src/session/secrets';
import { readySecretTable, type SecretTable } from '../secrecy/helpers';

export class AuditTable {
  readonly t: SecretTable;
  private rounds = 0;
  constructor(n = 20) {
    this.t = readySecretTable(['Anna', 'Ben'], n);
  }

  get state(): TableState {
    return this.t.state;
  }

  get log(): Action[] {
    return this.t.log;
  }

  other(seat: SeatId): SeatId {
    return seat === 's0' ? 's1' : 's0';
  }

  follow(seat: SeatId, placement: 'top' | 'bottom' = 'top'): void {
    this.t.secrets[seat] = reconcileSecrets(this.t.secrets[seat]!, this.t.state, placement);
  }

  startMatch(): void {
    this.t.apply('s0', { type: 'stageSet', stage: 'match' });
  }

  /** "Next game": Anna asks, Ben confirms, the table goes to the builder. */
  endMatch(stage: 'build' | 'lobby' = 'build'): void {
    const round = `r-end-${++this.rounds}`;
    this.t.apply('s0', { type: 'ask', round, label: stage === 'build' ? 'Next game?' : 'New draft?' });
    this.t.apply('s1', { type: 'respond', round, seat: 's1', response: 'ok' });
    this.t.apply('s0', { type: 'stageSet', stage, round });
  }

  /** The full secret shuffle of `seat`'s zone, with the other seat's nonce. */
  shuffle(seat: SeatId, sid: string, opts: { zone?: ZoneId; disclosed?: InstanceId[]; done?: (f: ReturnType<typeof finishShuffle>) => ReturnType<typeof finishShuffle> } = {}): void {
    const zone = opts.zone ?? `library:${seat}`;
    const b = beginShuffle(this.t.secrets[seat]!, zone, sid, `owner-${sid}`);
    this.t.apply(seat, b.action);
    this.t.secrets[seat] = b.secrets;
    this.t.apply(this.other(seat), { type: 'shuffleNonce', sid, nonce: `peer-${sid}` });
    let f = finishShuffle(this.t.secrets[seat]!, this.t.state, sid, this.t.entropy[seat]!, opts.disclosed ?? []);
    if (opts.done) f = opts.done(f);
    this.t.apply(seat, f.action);
    this.t.secrets[seat] = f.secrets;
  }

  /** Draw `n` cards from the top of the owner's private order. */
  draw(seat: SeatId, n = 1): InstanceId[] {
    const out: InstanceId[] = [];
    for (let i = 0; i < n; i++) {
      const id = this.t.secrets[seat]!.libraryOrder[0]!;
      this.t.apply(seat, { type: 'draw', instanceId: id });
      this.follow(seat);
      out.push(id);
    }
    return out;
  }

  /** A private reorder of `seat`'s library to `order`, `count` cards looked at. */
  reorder(seat: SeatId, order: InstanceId[], count: number): void {
    const r = privateReorder(this.t.secrets[seat]!, this.t.state, `library:${seat}`, order, count, this.t.entropy[seat]!);
    this.t.apply(seat, r.action);
    this.t.secrets[seat] = r.secrets;
  }

  /** Fresh ids for `seat`'s hand (a reorder with a re-issue). */
  reissueHand(seat: SeatId): void {
    const r = reissueZone(this.t.secrets[seat]!, this.t.state, `hand:${seat}`, this.t.entropy[seat]!)!;
    this.t.apply(seat, r.action);
    this.t.secrets[seat] = r.secrets;
  }

  library(seat: SeatId): InstanceId[] {
    return this.t.secrets[seat]!.libraryOrder;
  }

  games(): AuditGame[] {
    return auditGames(this.t.log);
  }

  /** The state just before seq `seq`, replayed from the table's start. */
  stateBefore(seq: number): TableState {
    let s = this.t.start;
    for (const a of this.t.log) {
      if (a.seq! >= seq) break;
      s = reduce(s, a);
    }
    return s;
  }

  bundle(seat: SeatId, game = this.games()[0]!): AuditBundle {
    return buildAuditBundle(this.t.secrets[seat]!, game, this.t.log);
  }

  /** The audit input for `seat` in `game` with `bundle` (default: the seat's honest bundle). */
  input(seat: SeatId, bundle?: AuditBundle | null, game = this.games()[0]!): AuditInput {
    return {
      seat,
      game,
      bundle: bundle === undefined ? this.bundle(seat, game) : bundle,
      start: this.stateBefore(game.fromSeq),
      log: this.t.log.filter((a) => a.seq! >= game.fromSeq && a.seq! <= game.toSeq),
    };
  }
}
