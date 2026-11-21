/**
 * The broker's rules on single steps (M8-P7; matchmaking.md 2.5): passes for match ids this browser has not seen are
 * kept until the offer arrives and count only from its members; an offer must fit its queue's table size and team
 * shape; an offer for a passed id is answered `stale`; match ids carry the broker's salt.
 */
import { describe, expect, it } from 'vitest';
import type { QueueId } from '../../../../src/core/types';
import { createBroker, step, type BrokerState, type StepResult } from '../../../../src/net/lobby/broker';
import type { LobbyMessage, Ticket } from '../../../../src/net/lobby/messages';
import { midOf } from '../../../../src/net/lobby/pairing';

const Q1: QueueId = '1v1.constructed.casual';
const QT: QueueId = '2hg.constructed.casual';

function ticket(tid: string, queues: QueueId[] = [Q1]): Ticket {
  return { v: 1, tid, peerId: `p-${tid}`, pubKey: `pk-${tid}`, name: tid.toUpperCase(), proto: 4, queues, ratings: {}, band: 3, score: 50, open: false, nat: 'unknown', rev: 1, sig: 's' };
}

/** A broker `me` seeking in `queues`, linked to and knowing the tickets of `others` (all seeking the same). */
function seeking(me: string, others: string[], queues: QueueId[] = [Q1], salt = ''): BrokerState {
  let s = createBroker({ tid: me, peerId: `p-${me}`, proto: 4, salt });
  s = step(s, { kind: 'links', now: 0, links: others }).state;
  for (const o of others) s = step(s, { kind: 'message', now: 0, from: o, msg: { v: 1, t: 'seek', ticket: ticket(o, queues), waitedMs: 0 } }).state;
  // The own ticket last, after every peer is known. A browser anchors only groups of greater tids: the tests that need
  // a member's view give it the greatest tid of the match.
  return step(s, { kind: 'seek', now: 0, ticket: ticket(me, queues) }).state;
}

function msg(s: BrokerState, from: string, m: LobbyMessage, now = 10): StepResult {
  return step(s, { kind: 'message', now, from, msg: m });
}

describe('broker: passes, offer shape, dead ids, salted ids', () => {
  it('a pass from a non-member for an id not yet offered is dropped when the real offer arrives', () => {
    // 0z (a member of the lobby, not of the match) passes a match id before a8's offer reaches b8.
    let s = seeking('b8', ['a8', '0z']);
    const mid = midOf(Q1, ['a8', 'b8'], 'a8', 1);
    s = msg(s, '0z', { v: 1, t: 'pass', mid, reason: 'busy' }).state;
    expect(s.dead).not.toContain(mid);
    const r = msg(s, 'a8', { v: 1, t: 'offer', mid, queue: Q1, members: [{ tid: 'a8', rev: 1 }, { tid: 'b8', rev: 1 }] });
    expect(r.state.offers.map((o) => o.mid)).toEqual([mid]);
    expect(r.state.phase).toBe('collecting');
    // After the collect window b8 holds it.
    const held = step(r.state, { kind: 'tick', now: 500 });
    expect(held.state.phase).toBe('held');
    expect(held.effects).toContainEqual({ kind: 'hold', mid, to: ['a8'] });
  });

  it('an early pass from a member of the offer ends it when the offer arrives', () => {
    let s = seeking('c8', ['a8', 'b8'], ['ffa3.constructed.casual']);
    const mid = midOf('ffa3.constructed.casual', ['a8', 'b8', 'c8'], 'a8', 1);
    s = msg(s, 'b8', { v: 1, t: 'pass', mid, reason: 'busy' }).state;
    const r = msg(s, 'a8', { v: 1, t: 'offer', mid, queue: 'ffa3.constructed.casual', members: ['a8', 'b8', 'c8'].map((tid) => ({ tid, rev: 1 })) });
    expect(r.state.offers).toEqual([]);
    expect(r.state.dead).toContain(mid);
  });

  it('an offer whose member count or team shape does not fit its queue is passed stale', () => {
    // Three members for a 1v1 queue.
    const s = seeking('c8', ['a8', 'b8']);
    const three = msg(s, 'a8', { v: 1, t: 'offer', mid: 'aaaaaaaaaaaaaaaa', queue: Q1, members: ['a8', 'b8', 'c8'].map((tid) => ({ tid, rev: 1 })) });
    const decided = step(three.state, { kind: 'tick', now: 500 });
    expect(decided.state.phase).toBe('seeking');
    expect(decided.send).toContainEqual({ to: 'a8', msg: { v: 1, t: 'pass', mid: 'aaaaaaaaaaaaaaaa', reason: 'stale' } });
    // A 1v1 offer with a team field.
    const teamed = msg(seeking('b8', ['a8']), 'a8', { v: 1, t: 'offer', mid: 'bbbbbbbbbbbbbbbb', queue: Q1, members: [{ tid: 'a8', rev: 1, team: 0 }, { tid: 'b8', rev: 1, team: 1 }] });
    expect(step(teamed.state, { kind: 'tick', now: 500 }).state.phase).toBe('seeking');
    // 2hg: three on one team.
    const t = seeking('d8', ['a8', 'b8', 'c8'], [QT]);
    const bad = msg(t, 'a8', { v: 1, t: 'offer', mid: 'cccccccccccccccc', queue: QT, members: [{ tid: 'a8', rev: 1, team: 0 }, { tid: 'b8', rev: 1, team: 0 }, { tid: 'c8', rev: 1, team: 0 }, { tid: 'd8', rev: 1, team: 1 }] });
    const badDecided = step(bad.state, { kind: 'tick', now: 500 });
    expect(badDecided.state.phase).toBe('seeking');
    expect(badDecided.send.some((o) => o.msg.t === 'pass' && o.msg.reason === 'stale')).toBe(true);
    // 2hg: two and two is taken.
    const good = msg(t, 'a8', { v: 1, t: 'offer', mid: 'dddddddddddddddd', queue: QT, members: [{ tid: 'a8', rev: 1, team: 0 }, { tid: 'b8', rev: 1, team: 1 }, { tid: 'c8', rev: 1, team: 1 }, { tid: 'd8', rev: 1, team: 0 }] });
    expect(step(good.state, { kind: 'tick', now: 500 }).state.phase).toBe('held');
  });

  it('an offer for an id this browser already passed is answered stale, so its anchor retries at once', () => {
    const mid = 'eeeeeeeeeeeeeeee';
    // b8 passed this id before (a declined or lapsed check, a reused id).
    const s = { ...seeking('b8', ['a8']), dead: [mid] };
    const r = msg(s, 'a8', { v: 1, t: 'offer', mid, queue: Q1, members: [{ tid: 'a8', rev: 1 }, { tid: 'b8', rev: 1 }] }, 40);
    expect(r.send).toEqual([{ to: 'a8', msg: { v: 1, t: 'pass', mid, reason: 'stale' } }]);
  });

  it('match ids carry the broker salt: the same anchor tid and counter on a new lobby connection gives a new id', () => {
    expect(midOf(Q1, ['a', 'b'], 'a', 1, 'salt-one')).not.toBe(midOf(Q1, ['a', 'b'], 'a', 1, 'salt-two'));
    expect(midOf(Q1, ['a', 'b'], 'a', 1, 'salt-one')).not.toBe(midOf(Q1, ['a', 'b'], 'a', 1));
    const offerOf = (salt: string): string => {
      const s = seeking('a8', ['b8'], [Q1], salt);
      return s.offers[0]!.mid;
    };
    expect(offerOf('one')).not.toBe(offerOf('two'));
    expect(offerOf('one')).toBe(offerOf('one'));
  });
});
