/**
 * M8-P5: the muster rule as a pure function (persistence.md section 5; contracts.md Part G "Rejoin" items 2 to 4):
 * every rule, the row states of the Gathering card, `knownHead` by (play, seq) and `PLAY ON WITH THIS TABLE`.
 */
import { describe, expect, it } from 'vitest';
import { knownIsNewer, musterStatus, type MusterInput, type MusterPeer } from '../../../src/session/muster';
import type { TableState } from '../../../src/core/types';
import { fresh } from '../core/helpers';

const H = 'h'.repeat(43);
const OLD = 'o'.repeat(43);

function table(away: string[] = [], seats = 2): TableState {
  const s = fresh(seats === 2 ? '1v1' : 'ffa3', seats);
  const out: TableState = { ...s, stage: 'match', seq: 40, seats: { ...s.seats } };
  for (const [id, seat] of Object.entries(out.seats)) out.seats[id] = { ...seat, peer: `p${seat.index}`, ...(away.includes(id) ? { away: true } : {}) };
  return out;
}

const peer = (i: number, h = H, live = false, seq = 40, play = 10): MusterPeer => ({
  peerId: `p${i}`,
  status: 'connected',
  head: { seq, play, h, turn: 3, stage: 'match', live, saving: true },
});

const input = (over: Partial<MusterInput>): MusterInput => ({
  state: table(),
  me: 's0',
  mine: { seq: 40, play: 10, h: H },
  peers: [],
  knownHead: null,
  stayed: false,
  ...over,
});

describe('musterStatus', () => {
  it('rule 1: a browser that stayed is live', () => {
    expect(musterStatus(input({ stayed: true }))).toMatchObject({ live: true, rule: 1 });
  });

  it('rule 2: in step with a live peer', () => {
    expect(musterStatus(input({ peers: [peer(1, H, true)] }))).toMatchObject({ live: true, rule: 2 });
    // Not in step: standby, the seat is connecting.
    const m = musterStatus(input({ peers: [peer(1, OLD, true, 44, 12)] }));
    expect(m).toMatchObject({ live: false, waitingFor: ['s1'] });
    expect(m.seats.find((s) => s.seat === 's1')!.state).toBe('connecting');
  });

  it('rule 3: everyone who was there is back and in step; seats marked away are not waited for', () => {
    expect(musterStatus(input({ peers: [peer(1)] }))).toMatchObject({ live: true, rule: 3 });
    const alone = musterStatus(input({ state: table(['s1']) }));
    expect(alone).toMatchObject({ live: true, rule: 3 });
    expect(alone.seats.find((s) => s.seat === 's1')!.state).toBe('leftBefore');
  });

  it('standby names the seats it waits for, with the row states Here, Connecting, Not here and Left before you', () => {
    const m = musterStatus(input({ state: { ...table(['s3'], 4), format: 'ffa4' }, peers: [peer(1), { peerId: 'p2', status: 'handshake' }] }));
    expect(m.live).toBe(false);
    expect(m.waitingFor).toEqual(['s2']);
    expect(Object.fromEntries(m.seats.map((s) => [s.seat, s.state]))).toEqual({ s0: 'here', s1: 'here', s2: 'connecting', s3: 'leftBefore' });
  });

  it('knownHead: a remembered newer head (by moves) holds rule 3; PLAY ON WITH THIS TABLE is offered', () => {
    const known = { play: 13, seq: 41, peer: 'p1', seat: 's1' };
    const m = musterStatus(input({ state: table(['s1']), knownHead: known }));
    expect(m).toMatchObject({ live: false, playOnHere: true, waitingFor: ['s1'] });
    // A copy with more moves is newer than a longer copy of chat; fewer moves is not.
    expect(knownIsNewer({ play: 11, seq: 30, peer: 'p1', seat: 's1' }, { play: 10, seq: 40 })).toBe(true);
    expect(knownIsNewer({ play: 9, seq: 50, peer: 'p1', seat: 's1' }, { play: 10, seq: 40 })).toBe(false);
    // Rule 4: once the table decided (playOn clears knownHead), rule 3 holds and reports the decision.
    expect(musterStatus(input({ state: table(['s1']), decided: true }))).toMatchObject({ live: true, rule: 4 });
  });

  it('in the lobby every browser is live', () => {
    expect(musterStatus(input({ state: { ...table(), stage: 'lobby' }, knownHead: { play: 99, seq: 99, peer: 'p1', seat: 's1' } })).live).toBe(true);
  });
});
