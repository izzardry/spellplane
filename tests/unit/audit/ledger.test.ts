/**
 * The audit ledger (net/audit.ts; PLAN M5-P2; PLAN Milestone 5, owner decisions: verdicts per player in the log and the
 * panel, missing records "could not be checked: records missing", never a mismatch): what one browser makes of the
 * sequenced log, game by game.
 */
import { describe, expect, it } from 'vitest';
import type { Action } from '../../../src/core/actions';
import { reduce } from '../../../src/core/reducer';
import { AUDIT_WAIT_MS, AuditLedger, verdictLine, verdictText } from '../../../src/net/audit';
import { AuditTable } from './helpers';

/** Feed `ledger` the log of `g` from `from` on (as net/sequencer.ts applySequenced does: a refused action only moves seq). */
function feed(ledger: AuditLedger, g: AuditTable, actions: readonly Action[], at = 0): void {
  let s = g.stateBefore(actions[0]!.seq!);
  for (const a of actions) {
    const r = reduce(s, a);
    const next = r === s ? { ...s, seq: a.seq! } : r;
    ledger.apply(a, s, next, at, 's0');
    s = next;
  }
}

function played(): AuditTable {
  const g = new AuditTable();
  g.startMatch();
  g.shuffle('s0', 'sh-a1');
  g.shuffle('s1', 'sh-b1');
  g.draw('s0', 7);
  g.draw('s1', 7);
  g.endMatch();
  return g;
}

describe('the audit ledger', () => {
  it('keeps a seat pending until its bundle arrives or the wait is over, then says "could not be checked"', () => {
    const g = played();
    g.t.apply('s0', { type: 'auditPublish', bundle: g.bundle('s0') });
    const ledger = new AuditLedger();
    feed(ledger, g, g.log, 1000);
    const [game] = ledger.finished();
    expect(game!.players).toEqual(['s0', 's1']);
    expect(ledger.views(1000)[0]!.seats.map((s) => [s.seat, s.name, s.verdict?.status ?? null])).toEqual([
      ['s0', 'Anna', 'verified'],
      ['s1', 'Ben', null],
    ]);
    expect(ledger.verdicts(1000).map((v) => v.seat)).toEqual(['s0']);
    expect(ledger.published()).toEqual([g.bundle('s0')]);
    expect(ledger.verdicts(1000 + AUDIT_WAIT_MS).map((v) => [v.seat, v.status])).toEqual([
      ['s0', 'verified'],
      ['s1', 'unverifiable'],
    ]);
    expect(ledger.views(1000 + AUDIT_WAIT_MS)[0]!.done).toBe(true);
  });

  it('stops waiting when the next game starts, takes the first bundle of a seat, and ignores a bundle the reducer refuses', () => {
    const g = played();
    const honest = g.bundle('s1');
    g.t.apply('s1', { type: 'auditPublish', bundle: honest });
    const second = { ...honest, records: [] };
    g.t.apply('s1', { type: 'auditPublish', bundle: second });
    g.t.ready('s0');
    g.t.ready('s1');
    g.t.apply('s0', { type: 'stageSet', stage: 'match' });
    // A sequencer that sequenced a bundle of the game being played: every peer's reducer refuses it.
    const forged: Action = { type: 'auditPublish', by: 's0', cid: 'forged', seq: g.state.seq + 1, bundle: { seat: 's0', game: { game: 2, fromSeq: 1, toSeq: 2 }, records: [] } };
    const ledger = new AuditLedger();
    feed(ledger, g, [...g.log, forged], 0);
    expect(ledger.playing()).toBe(true);
    expect(ledger.verdicts(0).map((v) => [v.seat, v.status])).toEqual([
      ['s0', 'unverifiable'],
      ['s1', 'verified'],
    ]);
    expect(ledger.finished()[0]!.bundles.get('s1')!.bundle).toEqual(honest);
    expect(ledger.finished().every((x) => x.game.game === 1)).toBe(true);
  });

  it('counts a bundle only for the game whose span it names exactly (one built in an abandoned history does not count)', () => {
    const g = played();
    const honest = g.bundle('s1');
    // The same game number, but the span of another history: the reducer cannot tell, the ledger does not take it.
    g.t.apply('s1', { type: 'auditPublish', bundle: { ...honest, game: { ...honest.game, toSeq: honest.game.toSeq - 1 } } });
    g.t.apply('s1', { type: 'auditPublish', bundle: honest });
    const ledger = new AuditLedger();
    feed(ledger, g, g.log);
    const seq = g.log.filter((a) => a.type === 'auditPublish').at(-1)!.seq;
    expect(ledger.finished()[0]!.bundles.get('s1')).toEqual({ bundle: honest, seq });
    expect(ledger.verdicts(0).find((v) => v.seat === 's1')!.status).toBe('verified');
  });

  it('drops the games a catch-up or rewind may have replaced', () => {
    const g = played();
    const ledger = new AuditLedger();
    feed(ledger, g, g.log);
    expect(ledger.finished()).toHaveLength(1);
    ledger.rebase(g.games()[0]!.toSeq + 1);
    expect(ledger.finished()).toHaveLength(1);
    ledger.rebase(g.games()[0]!.toSeq);
    expect(ledger.finished()).toHaveLength(0);
  });

  it('words every verdict for the log and the panel', () => {
    expect(verdictText({ seat: 's0', game: 1, status: 'verified', shuffles: 1, draws: 7 })).toBe('verified: 1 shuffle and 7 draws checked');
    expect(verdictLine({ seat: 's0', game: 2, status: 'verified', shuffles: 2, draws: 1 }, 'Anna')).toBe('Audit of game 2: Anna — verified: 2 shuffles and 1 draw checked');
    // A seat that never shuffled and never drew from a committed order: the status word alone would overstate it.
    expect(verdictText({ seat: 's0', game: 1, status: 'verified', shuffles: 0, draws: 0 })).toBe('verified: nothing to check (no shuffle and no draw from a committed order)');
    expect(
      verdictText({
        seat: 's1',
        game: 1,
        status: 'mismatch',
        mismatches: [
          { kind: 'draw', seq: 9, detail: 'The 8th draw took b.' },
          { kind: 'order', seq: 4, detail: 'x' },
        ],
      }),
    ).toBe('mismatch: The 8th draw took b. (and 1 more)');
    expect(verdictText({ seat: 's1', game: 1, status: 'unverifiable', reason: 'recordsMissing', detail: 'No records.', checked: 0 })).toBe('could not be checked: records missing (No records.)');
  });
});
