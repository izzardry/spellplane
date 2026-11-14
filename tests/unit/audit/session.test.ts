/**
 * The session's audit (session/audit.ts; PLAN M5-P2, audit round 1) on a pure-core table with a fake session port:
 * a bundle is proposed only once every other player acknowledged the game's end in this history, the transport never carries
 * one the confirmed history does not accept, and another table starts its verdict lines afresh.
 */
import { describe, expect, it } from 'vitest';
import type { Action, ActionDraft } from '../../../src/core/actions';
import type { LogEntry, TableState } from '../../../src/core/types';
import { AUDIT_WAIT_MS, type AuditSeatView } from '../../../src/net/audit';
import type { SequencedAction } from '../../../src/net/messages';
import type { PeerInfo } from '../../../src/net/types';
import { gatedTransport, SessionAudit } from '../../../src/session/audit';
import type { Channel, Message, Transport } from '../../../src/net/transport';
import { AuditTable } from './helpers';

/** Give every seat of the table (its start and its state) a peer id, as a networked table has. */
function withPeers(g: AuditTable): void {
  const patch = (st: TableState): TableState => ({ ...st, seats: Object.fromEntries(Object.entries(st.seats).map(([id, seat]) => [id, { ...seat, peer: seat.peer ?? `peer-${id}` }])) });
  const t = g.t as { start: TableState; state: TableState };
  t.start = patch(t.start);
  t.state = patch(t.state);
}

function fixture(g: AuditTable, opts: { now?: number } = {}) {
  withPeers(g);
  const proposed: ActionDraft[] = [];
  const lines: string[] = [];
  const entries = (): LogEntry[] => g.log.map((a) => ({ kind: 'action', seq: a.seq!, at: 0, action: a }));
  const peerOf = (seat: string): string => g.state.seats[seat]!.peer!;
  const peers = (): PeerInfo[] =>
    Object.values(g.state.seats)
      .filter((s) => s.id !== 's0' && s.peer)
      .map((s) => ({ transportId: `t-${s.id}`, peerId: s.peer!, nickname: s.name, seat: s.id, role: 'player', status: 'connected', lastSeq: 0 }));
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
    now: () => opts.now ?? 0,
    changed: () => {},
    peers,
    // Anna (s0) sequences, in step with the room.
    sequencer: () => peerOf('s0'),
    isSequencer: () => true,
    inStep: () => true,
  });
  const rebuild = (fresh = false): void => audit.rebuild([g.t.start], entries(), g.state, fresh);
  /** A heartbeat of `seat`'s browser: at `seq`, following `sequencer` (Anna's peer by default). */
  const hb = (seat: string, seq: number, sequencer: string | null = peerOf('s0')): void => audit.incoming('ctl', `t-${seat}`, { v: 1, t: 'hb', seq, sequencer });
  return { audit, proposed, lines, rebuild, hb };
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
  it('holds the own bundle until every other player acknowledged the game’s end in this history; the row says whom it waits for', async () => {
    const g = endedAlone();
    const toSeq = g.state.seq;
    const f = fixture(g);
    f.rebuild();
    f.audit.drive();
    expect(f.proposed).toEqual([]);
    const own = (): AuditSeatView => f.audit.games()[0]!.seats.find((s) => s.seat === 's0')!;
    expect(own().verdict).toBeNull();
    expect(own().note).toBe("Published once Ben has the game's end");
    expect(f.lines.some((l) => l.includes('Anna'))).toBe(false);
    // Not yet at the end; following another sequencer (a history of his own); ahead of this browser (another history).
    f.hb('s1', toSeq - 1);
    f.hb('s1', toSeq + 5, 'peer-elsewhere');
    f.hb('s1', toSeq + 5);
    // An own action of Ben's in this history is no proof either: he may have proposed it before the end reached him.
    g.t.apply('s1', { type: 'chat', text: 'back', channel: 'table' });
    f.rebuild();
    await Promise.resolve();
    f.audit.drive();
    expect(f.proposed).toEqual([]);
    // His browser reports the end, following this browser: the bundle goes out.
    f.hb('s1', toSeq);
    await Promise.resolve();
    expect(f.proposed).toEqual([{ type: 'auditPublish', bundle: g.bundle('s0') }]);
  });

  it('a timeout answer is no evidence either way: a player the pass timer answered for acknowledges like any other', async () => {
    const g = endedAlone();
    const f = fixture(g);
    f.rebuild();
    f.hb('s1', g.state.seq);
    await Promise.resolve();
    f.audit.drive();
    expect(f.proposed).toEqual([{ type: 'auditPublish', bundle: g.bundle('s0') }]);
  });

  it('forgets the acknowledgements when the history is rewound or caught up from a snapshot', async () => {
    const g = endedAlone();
    const f = fixture(g);
    f.rebuild();
    const prior = g.state;
    f.hb('s1', g.state.seq);
    // A rewind before Ben's acknowledgement was used: it counts no more.
    f.audit.sequenced({ ...g.log.at(-1)!, seq: prior.seq } as SequencedAction, prior, { ...prior }, false);
    await Promise.resolve();
    await Promise.resolve();
    f.audit.drive();
    expect(f.proposed).toEqual([]);
  });

  it('a reload long after the game does not log the own seat as "records missing" while its bundle is held', () => {
    const g = endedAlone();
    const f = fixture(g, { now: AUDIT_WAIT_MS + 1 });
    f.rebuild();
    expect(f.lines).toEqual(['Audit of game 1: Ben — could not be checked: records missing (none published so far; records published later are still checked)']);
    f.audit.drive();
    expect(f.lines).toHaveLength(1);
    expect(f.audit.verdicts().map((v) => v.seat)).toEqual(['s1']);
  });

  it('lets an own bundle through the transport only for a game the confirmed history ended with exactly its span', () => {
    const g = new AuditTable();
    g.startMatch();
    g.shuffle('s0', 'sh-a1');
    g.draw('s0', 2);
    g.endMatch();
    const f = fixture(g);
    f.rebuild();
    f.hb('s1', g.state.seq);
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
