/**
 * The lobby's connectivity check (DESIGN "Multiplayer architecture", Rooms and connection: no TURN fallback; the lobby
 * runs a connectivity check per pair and says so plainly, with the usual remedies: other network, phone hotspot, VPN).
 */
import { describe, expect, it } from 'vitest';
import type { PeerInfo } from '../../../src/net/types';
import type { SessionNetStatus } from '../../../src/session/types';
import { CONNECT_CHECK_MS, ConnectivityCheck } from '../../../src/ui/lobby/connectivity';
import { freshTable, sit } from './helpers';

const A = 'aaaaaaaaaaaaaaaa';
const B = 'bbbbbbbbbbbbbbbb';
const C = 'cccccccccccccccc';

const peer = (p: Partial<PeerInfo> & { peerId: string }): PeerInfo => ({ transportId: `t-${p.peerId}`, nickname: '', seat: null, role: 'player', status: 'connected', lastSeq: 0, ...p });
const net = (connection: SessionNetStatus['connection'], peers: PeerInfo[] = []): SessionNetStatus => ({ mode: 'net', connection, peers, sequencer: null, seq: 0 });
const REMEDY = /another network, a phone hotspot or a VPN/;

describe('ConnectivityCheck', () => {
  it('says nothing in solo play', () => {
    const c = new ConnectivityCheck();
    expect(c.observe({ mode: 'solo', connection: 'solo', peers: [], sequencer: null, seq: 0 }, freshTable(), A, 0)).toEqual({ overall: 'solo', pairs: [], problems: [] });
  });

  it('alone at a table: checking at first, then the plain failure message with remedies after the timeout', () => {
    const c = new ConnectivityCheck();
    const st = sit(freshTable(), 's0', 'Ann', 0, A);
    expect(c.observe(net('alone'), st, A, 1000)).toMatchObject({ overall: 'checking', problems: [] });
    expect(c.observe(net('alone'), st, A, 1000 + CONNECT_CHECK_MS - 1).problems).toEqual([]);
    const r = c.observe(net('alone'), st, A, 1000 + CONNECT_CHECK_MS);
    expect(r.overall).toBe('failed');
    expect(r.problems).toHaveLength(1);
    expect(r.problems[0]!.kind).toBe('alone');
    expect(r.problems[0]!.text).toMatch(/No other player has connected yet/);
    expect(r.problems[0]!.text).toMatch(REMEDY);
    expect(r.problems[0]!.text).toMatch(/no relay server/);
  });

  it('the failure clears when a peer connects, and the wait starts over if it drops again', () => {
    const c = new ConnectivityCheck();
    const st = sit(freshTable(), 's0', 'Ann', 0, A);
    c.observe(net('alone'), st, A, 0);
    expect(c.observe(net('alone'), st, A, CONNECT_CHECK_MS).problems).toHaveLength(1);
    const both = sit(st, 's1', 'Ben', 1, B);
    expect(c.observe(net('connected', [peer({ peerId: B, nickname: 'Ben', seat: 's1' })]), both, A, CONNECT_CHECK_MS + 1)).toEqual({
      overall: 'ok',
      pairs: [{ peer: B, name: 'Ben', seat: 's1', state: 'connected' }],
      problems: [],
    });
    expect(c.observe(net('alone'), st, A, CONNECT_CHECK_MS + 2).problems).toEqual([]);
    expect(c.observe(net('alone'), st, A, 2 * CONNECT_CHECK_MS + 2).problems).toHaveLength(1);
  });

  it('relays out of reach: joining that never completes', () => {
    const c = new ConnectivityCheck();
    const st = freshTable();
    expect(c.observe(net('joining'), st, A, 0).overall).toBe('checking');
    const r = c.observe(net('joining'), st, A, CONNECT_CHECK_MS);
    expect(r.problems.map((p) => p.kind)).toEqual(['relays']);
    expect(r.problems[0]!.text).toMatch(/signalling relays/);
    expect(r.problems[0]!.text).toMatch(REMEDY);
  });

  it('a pair whose handshake never completes fails, naming the other player', () => {
    const c = new ConnectivityCheck();
    const st = sit(freshTable(), 's0', 'Ann', 0, A);
    const s = net('alone', [peer({ peerId: B, nickname: 'Ben', status: 'handshake' })]);
    expect(c.observe(s, st, A, 0).pairs).toEqual([{ peer: B, name: 'Ben', seat: null, state: 'connecting' }]);
    const r = c.observe(s, st, A, CONNECT_CHECK_MS);
    expect(r.pairs[0]!.state).toBe('failed');
    expect(r.problems.find((p) => p.kind === 'pair')?.text).toMatch(/cannot finish connecting to Ben/);
  });

  it('per pair: a seated player another peer relays but this browser cannot reach directly', () => {
    // Three players: A hears B, B also sits with C, but A's connection to C never opens.
    const c = new ConnectivityCheck();
    const st = sit(sit(sit(freshTable('ffa3'), 's0', 'Ann', 0, A), 's1', 'Ben', 1, B), 's2', 'Cat', 2, C);
    const s = net('connected', [peer({ peerId: B, nickname: 'Ben', seat: 's1' })]);
    const first = c.observe(s, st, A, 0);
    expect(first.overall).toBe('checking');
    expect(first.pairs).toEqual([
      { peer: B, name: 'Ben', seat: 's1', state: 'connected' },
      { peer: C, name: 'Cat', seat: 's2', state: 'connecting' },
    ]);
    const r = c.observe(s, st, A, CONNECT_CHECK_MS);
    expect(r.overall).toBe('failed');
    expect(r.problems).toEqual([{ kind: 'pair', peer: C, seat: 's2', text: expect.stringMatching(/Cat is at this table, but your browser cannot connect to theirs directly/) }]);
    expect(r.problems[0]!.text).toMatch(REMEDY);
  });

  it('an away seat is not a connection failure', () => {
    const c = new ConnectivityCheck();
    const st = sit(sit(sit(freshTable('ffa3'), 's0', 'Ann', 0, A), 's1', 'Ben', 1, B), 's2', 'Cat', 2, C);
    st.seats.s2!.away = true;
    const s = net('connected', [peer({ peerId: B, nickname: 'Ben', seat: 's1' })]);
    c.observe(s, st, A, 0);
    const r = c.observe(s, st, A, 10 * CONNECT_CHECK_MS);
    expect(r).toMatchObject({ overall: 'ok', problems: [] });
    expect(r.pairs.find((p) => p.peer === C)?.state).toBe('away');
  });

  it('a version mismatch is reported at once', () => {
    const r = new ConnectivityCheck().observe(net('versionMismatch'), freshTable(), A, 0);
    expect(r.overall).toBe('failed');
    expect(r.problems[0]!.kind).toBe('version');
    expect(r.problems[0]!.text).toMatch(/different version/);
  });

  it('the own seat is never a pair', () => {
    const c = new ConnectivityCheck();
    const st = sit(sit(freshTable(), 's0', 'Ann', 0, A), 's1', 'Ben', 1, B);
    const r = c.observe(net('connected', [peer({ peerId: B, nickname: 'Ben', seat: 's1' })]), st, A, 0);
    expect(r.pairs.map((p) => p.peer)).toEqual([B]);
  });
});
