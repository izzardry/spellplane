/**
 * The session's audit (session/audit.ts; PLAN M5-P2, audit round 1) on a pure-core table with a fake session port:
 * a bundle is proposed only into a history the other players follow past the game's end, the transport never carries
 * one the confirmed history does not accept, and another table starts its verdict lines afresh.
 */
import { describe, expect, it } from 'vitest';
import type { Action, ActionDraft } from '../../../src/core/actions';
import type { LogEntry } from '../../../src/core/types';
import { gatedTransport, SessionAudit } from '../../../src/session/audit';
import type { Channel, Message, Transport } from '../../../src/net/transport';
import { AuditTable } from './helpers';

function fixture(g: AuditTable) {
  const proposed: ActionDraft[] = [];
  const lines: string[] = [];
  const entries = (): LogEntry[] => g.log.map((a) => ({ kind: 'action', seq: a.seq!, at: 0, action: a }));
  const audit = new SessionAudit({
    seat: () => 's0',
    secrets: () => g.t.secrets.s0!,
    pending: () => [],
    confirmed: () => g.state,
    entries,
    propose: (d) => {
      proposed.push(d);
      return true;
    },
    log: (_level, text) => void lines.push(text),
    now: () => 0,
    changed: () => {},
  });
  const rebuild = (fresh = false): void => audit.rebuild([g.t.start], entries(), g.state, fresh);
  return { audit, proposed, lines, rebuild };
}

/** A game Anna ends while Ben is silent: the sequencer (Anna) answers his part of the round. */
function endedAlone(): AuditTable {
  const g = new AuditTable();
  g.startMatch();
  g.shuffle('s0', 'sh-a1');
  g.shuffle('s1', 'sh-b1');
  g.draw('s0', 3);
  g.t.apply('s0', { type: 'ask', round: 'r-end', label: 'Next game?' });
  g.t.apply('s0', { type: 'respond', round: 'r-end', seat: 's1', response: 'timeout' });
  g.t.apply('s0', { type: 'stageSet', stage: 'build', round: 'r-end' });
  return g;
}

describe('the session’s audit', () => {
  it('holds the own bundle while another player has not acted since the sequencer answered for them, and its row waits', () => {
    const g = endedAlone();
    const f = fixture(g);
    f.rebuild();
    f.audit.drive();
    expect(f.proposed).toEqual([]);
    expect(f.audit.games()[0]!.seats.find((s) => s.seat === 's0')!.verdict).toBeNull();
    expect(f.lines.some((l) => l.includes('Anna'))).toBe(false);
    // Ben acts in this history: it is his too now, and the bundle goes out.
    g.t.apply('s1', { type: 'chat', text: 'back', channel: 'table' });
    f.rebuild();
    f.audit.drive();
    expect(f.proposed).toEqual([{ type: 'auditPublish', bundle: g.bundle('s0') }]);
  });

  it('lets an own bundle through the transport only for a game the confirmed history ended with exactly its span', () => {
    const g = new AuditTable();
    g.startMatch();
    g.shuffle('s0', 'sh-a1');
    g.draw('s0', 2);
    g.endMatch();
    const f = fixture(g);
    f.rebuild();
    const bundle = g.bundle('s0');
    const sent: Message[] = [];
    const raw = { selfId: 'p', join: async () => {}, leave: () => {}, peers: () => [], send: (_c: Channel, m: Message) => void sent.push(m), on: () => {}, onPeer: () => {} } satisfies Transport;
    const t = gatedTransport(raw, (c, m) => f.audit.outgoing(c, m));
    const propose = (b: unknown, cid: string): Message => ({ v: 1, t: 'propose', cid, action: { type: 'auditPublish', by: 's0', cid, bundle: b } });

    t.send('act', propose(bundle, 'c1'));
    expect(sent.at(-1)).toEqual(propose(bundle, 'c1'));
    // Another span (built in an abandoned history): withheld, and its rollback is no refusal.
    const other = { ...bundle, game: { ...bundle.game, toSeq: bundle.game.toSeq - 1 } };
    t.send('act', propose(other, 'c2'));
    expect(sent.at(-1)).toEqual(propose({ withheld: true }, 'c2'));
    expect(f.audit.refused({ type: 'auditPublish', by: 's0', cid: 'c2', bundle: other } as Action)).toBe(true);
    expect(f.audit.refused({ type: 'auditPublish', by: 's0', cid: 'c3', bundle } as Action)).toBe(false);
    // Everything else passes untouched.
    const chat: Message = { v: 1, t: 'propose', cid: 'c4', action: { type: 'chat', by: 's0', cid: 'c4', text: 'hi', channel: 'table' } };
    t.send('act', chat);
    expect(sent.at(-1)).toBe(chat);
    expect(t.selfId).toBe('p');
  });

  it('withholds a bundle whose game is still being played in the confirmed history', () => {
    const g = new AuditTable();
    g.startMatch();
    g.shuffle('s0', 'sh-a1');
    const f = fixture(g);
    f.rebuild();
    const bundle = { seat: 's0', game: { game: 1, fromSeq: g.games()[0]?.fromSeq ?? 1, toSeq: g.state.seq }, records: [] };
    const out = f.audit.outgoing('act', { v: 1, t: 'propose', cid: 'c1', action: { type: 'auditPublish', by: 's0', cid: 'c1', bundle } });
    expect((out.action as { bundle: unknown }).bundle).toEqual({ withheld: true });
  });

  it('logs the verdicts of another table afresh', () => {
    const g = new AuditTable();
    g.startMatch();
    g.shuffle('s0', 'sh-a1');
    g.endMatch();
    g.t.apply('s0', { type: 'auditPublish', bundle: g.bundle('s0') });
    const f = fixture(g);
    f.rebuild();
    expect(f.lines.filter((l) => l.startsWith('Audit of game 1: Anna'))).toHaveLength(1);
    f.rebuild();
    expect(f.lines.filter((l) => l.startsWith('Audit of game 1: Anna'))).toHaveLength(1);
    f.rebuild(true);
    expect(f.lines.filter((l) => l.startsWith('Audit of game 1: Anna'))).toHaveLength(2);
  });
});
