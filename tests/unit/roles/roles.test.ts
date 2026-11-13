/**
 * PLAN M3-P5 Spectators, without a network: the role rule (net/roles.ts), the sequencer's spectator branch (the
 * package's acceptance test: "A spectator's dispatches of card actions are rejected by the sequencer"), the `revealTo`
 * reducer case for named spectators, the routing rule for a spectator's pair channel, and the spectator's reveal
 * receiver (DESIGN "Players, seats and formats", Spectators: "joins by the same link without taking a chair, sees only
 * public zones, can chat and ping, and cannot move cards. A player may reveal their hand to a named spectator";
 * "Specification: network protocol and secrecy", Sequencing 1 and 3).
 */
import { describe, expect, it, vi } from 'vitest';
import { ACTION_FAMILIES, type Action, type ActionType } from '../../../src/core/actions';
import { commitFor, type RevealedCard } from '../../../src/core/commit';
import { createTable, explain, reduce } from '../../../src/core/reducer';
import { spectatorIdOf } from '../../../src/core/teams';
import type { SeatId, TableState } from '../../../src/core/types';
import type { PrivateMessage, SequencedAction } from '../../../src/net/messages';
import { emptySecretStore } from '../../../src/core/secrets';
import {
  roleProblem,
  spectatorActionProblem,
  spectatorChatName,
  spectatorLabel,
  spectatorNameProblem,
  spectatorRevealSender,
  spectatorRevealsOver,
  spectatorRoute,
  spectatorsOf,
  SPECTATOR_ACTIONS,
  SPECTATOR_RESEND_MS,
  type SpectatorReveal,
} from '../../../src/net/roles';
import { createSequencer } from '../../../src/net/sequencer';
import type { PeerInfo } from '../../../src/net/types';
import { baseTable, libraryIds } from '../../sim/net/sim';
import { TEST_GAME } from '../core/helpers';

const { state } = baseTable(2);
const VIEWER = 'abcdef0123456789';
const ME = spectatorIdOf(VIEWER);
const spectator = { seat: null, role: 'spectator' as const, self: false, peerId: VIEWER };
/** A spectator sender as the Sequencer contract sees it: no identity (the engine checks that, net/engine.ts). */
const asSpectator = { seat: null, role: 'spectator' as const, self: false };
const seated = (seat: SeatId) => ({ seat, role: 'player' as const, self: false, peerId: `peer${seat.slice(1)}` });

const peer = (peerId: string, nickname: string, role: PeerInfo['role'], status: PeerInfo['status'] = 'connected', seat: string | null = null): PeerInfo => ({
  transportId: `t-${peerId}-${status}`,
  peerId,
  nickname,
  seat,
  role,
  status,
  lastSeq: 0,
});

/** A public battlefield card of seat 0 and a hidden library card of seat 1 in the base table. */
const pub0 = libraryIds(0)[0]!;
const lib1 = libraryIds(1)[7]!;
const hand = (s: TableState, id: string): TableState => reduce(s, { type: 'draw', by: 's1', cid: `d-${id}`, instanceId: id, seq: s.seq + 1 } as Action);

/** Card actions a seated player may send on the base table (each is checked to apply for its owner first). */
function cardActions(by: SeatId): Action[] {
  const mine = by === 's0' ? pub0 : libraryIds(1)[0]!;
  const zoneSeat = by;
  return [
    { type: 'move', by, cid: 'mv', card: mine, to: `battlefield:${zoneSeat}`, pose: { x: 10, y: 20, rot: 0 } },
    { type: 'tap', by, cid: 'tp', card: mine, tapped: true },
    { type: 'rotate', by, cid: 'rt', card: mine, delta: 90 },
    { type: 'counter', by, cid: 'ct', card: mine, kind: '+1/+1', delta: 1 },
    { type: 'note', by, cid: 'nt', card: mine, text: 'hi' },
    { type: 'flip', by, cid: 'fl', card: mine, face: 'down' },
    { type: 'toZone', by, cid: 'tz', card: mine, to: `library:${zoneSeat}`, position: 'bottom' },
    { type: 'createToken', by, cid: 'tk', card: 'tok-1', zone: `battlefield:${zoneSeat}`, pose: { x: 0, y: 0, rot: 0 }, label: 'Soldier' },
    { type: 'life', by, cid: 'lf', seat: by, delta: -3 },
    { type: 'stackPush', by, cid: 'sp', item: 'si-1', kind: 'ability', source: mine },
  ] as Action[];
}

describe('roleProblem (net/roles.ts)', () => {
  it('leaves players to the seat checks', () => {
    expect(roleProblem(state, cardActions('s0')[0]!, { role: 'player', peerId: 'peer0', seat: 's0' })).toBeNull();
  });

  it('lets a spectator chat and ping as its own spectator id', () => {
    expect(SPECTATOR_ACTIONS).toEqual(['chat', 'ping']);
    const chat: Action = { type: 'chat', by: ME, cid: 'c', text: 'gl hf', channel: 'table', name: 'Viv' };
    expect(roleProblem(state, chat, spectator)).toBeNull();
    expect(roleProblem(state, { ...chat, channel: 'spectator' } as Action, spectator)).toBeNull();
    expect(roleProblem(state, { type: 'ping', by: ME, cid: 'p', target: { kind: 'card', id: pub0 } }, spectator)).toBeNull();
  });

  it('refuses every other action type for a spectator', () => {
    for (const type of Object.keys(ACTION_FAMILIES) as ActionType[]) {
      const why = roleProblem(state, { type, by: ME, cid: `x-${type}` } as unknown as Action, spectator);
      if (type === 'chat') continue;
      if (type === 'ping') expect(why).toBeNull();
      else expect(why, type).toMatch(/chat and ping only/);
    }
  });

  it('refuses a spectator acting for a seat, for another spectator, or without an identity', () => {
    const chat = (by: string): Action => ({ type: 'chat', by, cid: 'c', text: 'x', channel: 'table' });
    expect(roleProblem(state, chat('s0'), spectator)).toMatch(/for a seat/);
    expect(roleProblem(state, chat(spectatorIdOf('0000000000000000')), spectator)).toMatch(/acts as v:abcdef0123456789 only/);
    expect(roleProblem(state, chat('viewer'), spectator)).toMatch(/acts as/);
    expect(roleProblem(state, chat(ME), { ...spectator, peerId: '' })).toMatch(/acts as/);
    // Its key pair may also hold a chair at this table: watching, it still never acts for it.
    expect(roleProblem(state, chat('s0'), { role: 'spectator', peerId: 'peer0', seat: 's0' })).toMatch(/for a seat/);
  });

  it('splits into the identity-free part the sequencer runs and the identity part the engine runs', () => {
    const chat = (by: string, extra: object = {}): Action => ({ type: 'chat', by, cid: 'c', text: 'x', channel: 'table', ...extra }) as Action;
    expect(spectatorActionProblem(state, chat(spectatorIdOf('0000000000000000')))).toBeNull();
    expect(spectatorActionProblem(state, chat('s1'))).toMatch(/for a seat/);
    expect(spectatorActionProblem(state, { type: 'tap', by: ME, cid: 't', card: pub0, tapped: true })).toMatch(/chat and ping only/);
    expect(spectatorActionProblem(state, chat(ME, { channel: 'team' }))).toMatch(/tab/);
    // The chat name is the nickname the spectator joined with (its hello), trimmed and cut to 40 characters.
    expect(spectatorChatName('  Viv ')).toBe('Viv');
    expect(spectatorChatName('   ')).toBe('Spectator');
    expect(spectatorChatName('x'.repeat(50))).toBe('x'.repeat(40));
    expect(spectatorNameProblem(chat(ME, { name: 'Viv' }), ' Viv')).toBeNull();
    expect(spectatorNameProblem(chat(ME), 'Viv')).toBeNull();
    expect(spectatorNameProblem(chat(ME, { name: 'Anna' }), 'Viv')).toMatch(/nickname it joined with/);
    expect(spectatorNameProblem(chat(ME, { name: 'Anna (spectator)' }), 'Viv')).toMatch(/nickname it joined with/);
    expect(spectatorNameProblem({ type: 'ping', by: ME, cid: 'p', target: { kind: 'seat', id: 's0' } }, 'Viv')).toBeNull();
  });

  it('keeps a spectator off the team tab and its chat name a short nickname', () => {
    const chat = (extra: object): Action => ({ type: 'chat', by: ME, cid: 'c', text: 'x', channel: 'table', ...extra }) as Action;
    expect(roleProblem(state, chat({ channel: 'team' }), spectator)).toMatch(/table or spectator tab/);
    expect(roleProblem(state, chat({ name: '' }), spectator)).toMatch(/nickname/);
    expect(roleProblem(state, chat({ name: 'x'.repeat(41) }), spectator)).toMatch(/nickname/);
    expect(roleProblem(state, chat({ name: 7 }), spectator)).toMatch(/nickname/);
  });
});

describe('the sequencer refuses a spectator’s card actions (PLAN M3-P5 acceptance)', () => {
  it('accepts each card action from the seat that owns the card and refuses it from a spectator', () => {
    for (const a of cardActions('s0')) {
      expect(explain(state, a), `${a.type} applies for its owner`).toBeNull();
      expect(createSequencer(state.seq).sequence(state, a, seated('s0')).ok, `${a.type} from s0`).toBe(true);
      // The same action from a spectator: in the seat's name, and in its own.
      const asSeat = createSequencer(state.seq).sequence(state, a, asSpectator);
      expect(asSeat.ok, `${a.type} from a spectator for s0`).toBe(false);
      const own = createSequencer(state.seq).sequence(state, { ...a, by: ME } as Action, asSpectator);
      expect(own, `${a.type} from a spectator as itself`).toEqual({ ok: false, reason: expect.stringMatching(/chat and ping only/) });
    }
  });

  it('refuses a spectator’s chair, Ready, draw, shuffle, roll and reveal: nothing a seat does', () => {
    const s = createSequencer(state.seq);
    const tries: Action[] = [
      { type: 'seatTake', by: 's0', cid: 'st', seat: 's0', name: 'Viv', colour: 3, peer: VIEWER },
      { type: 'seatLeave', by: 's1', cid: 'sl', seat: 's1' },
      { type: 'draw', by: ME, cid: 'dr', instanceId: lib1 },
      { type: 'shuffleCommit', by: ME, cid: 'sh', sid: 'sh1', zone: 'library:s1', h: 'h' },
      { type: 'rngCommit', by: ME, cid: 'rn', rid: 'r1', purpose: 'die', n: 6, h: 'h' },
      { type: 'revealTo', by: ME, cid: 'rv', instanceId: pub0, seats: ['s1'] },
      { type: 'caption', by: ME, cid: 'cp', text: 'hello' },
      { type: 'phaseSet', by: ME, cid: 'ph', phase: 'main1' },
      { type: 'lineAdd', by: ME, cid: 'ln', line: 'l1', kind: 'attack', from: { kind: 'card', id: pub0 }, to: { kind: 'seat', id: 's1' } },
    ] as Action[];
    for (const a of tries) expect(s.sequence(state, a, asSpectator).ok, a.type).toBe(false);
    expect(s.lastSeq).toBe(state.seq);
  });

  it('sequences a spectator’s chat and ping, which change nothing but the log', () => {
    const s = createSequencer(state.seq);
    const chat = s.sequence(state, { type: 'chat', by: ME, cid: 'c1', text: 'nice [[Shock]]', channel: 'table', name: 'Viv' }, asSpectator);
    expect(chat.ok).toBe(true);
    const ping = s.sequence(state, { type: 'ping', by: ME, cid: 'p1', target: { kind: 'seat', id: 's1' } }, asSpectator);
    expect(ping.ok && ping.action.seq).toBe(state.seq + 2);
    // A ping at a card that does not exist is refused by the reducer, as for anyone.
    expect(s.sequence(state, { type: 'ping', by: ME, cid: 'p2', target: { kind: 'card', id: 'nope' } }, asSpectator).ok).toBe(false);
    const after = reduce(reduce(state, (chat as { action: SequencedAction }).action), (ping as { action: SequencedAction }).action);
    expect({ ...after, seq: 0 }).toEqual({ ...state, seq: 0 });
  });

  it('checks type, seat and tab without the sender’s identity, which the engine checks before (net/engine.ts)', () => {
    const s = createSequencer(state.seq);
    expect(s.sequence(state, { type: 'chat', by: ME, cid: 'c', text: 'x', channel: 'table' }, asSpectator).ok).toBe(true);
    expect(s.sequence(state, { type: 'chat', by: 's0', cid: 'c2', text: 'x', channel: 'table' }, asSpectator)).toEqual({ ok: false, reason: 'a spectator may not act for a seat' });
    expect(s.sequence(state, { type: 'chat', by: ME, cid: 'c3', text: 'x', channel: 'team' }, asSpectator).ok).toBe(false);
  });
});

describe('revealTo names spectators (core/reducer/zones.ts)', () => {
  it('accepts a reveal to spectators only, to seats and spectators, and refuses one to nobody', () => {
    const base = { type: 'revealTo', by: 's0', cid: 'r', instanceId: pub0 } as const;
    expect(explain(state, { ...base, seats: [], spectators: [ME] })).toBeNull();
    expect(explain(state, { ...base, seats: ['s1'], spectators: [ME, spectatorIdOf('0000000000000001')] })).toBeNull();
    expect(explain(state, { ...base, seats: [] })).toMatch(/at least one seat or spectator/);
    expect(explain(state, { ...base, seats: [], spectators: [] })).toMatch(/at least one seat or spectator/);
    expect(explain(state, { ...base, seats: [], spectators: ['s1'] })).toMatch(/not a spectator id/);
    expect(explain(state, { ...base, seats: [], spectators: ['v:'] })).toMatch(/not a spectator id/);
    expect(explain(state, { ...base, seats: [], spectators: 'v:x' as unknown as string[] })).toMatch(/spectator ids/);
    expect(explain(state, { ...base, seats: ['s9'], spectators: [ME] })).not.toBeNull();
    // The public record changes no state.
    expect(reduce(state, { ...base, seats: [], spectators: [ME] })).toBe(state);
  });

  it('a seat reveals only its own card to a spectator (the sequencer’s owner check)', () => {
    const s1hand = hand(state, lib1);
    const s = createSequencer(s1hand.seq);
    expect(s.sequence(s1hand, { type: 'revealTo', by: 's1', cid: 'a', instanceId: lib1, seats: [], spectators: [ME] }, seated('s1')).ok).toBe(true);
    expect(s.sequence(s1hand, { type: 'revealTo', by: 's0', cid: 'b', instanceId: lib1, seats: [], spectators: [ME] }, seated('s0')).ok).toBe(false);
  });
});

describe('spectatorsOf and the pair-channel route', () => {

  it('lists verified spectators by nickname, once per identity, connected first', () => {
    const list = spectatorsOf([
      peer('p1', 'Zed', 'spectator'),
      peer('p2', 'Ann', 'player', 'connected', 's0'),
      peer('p3', 'Bea', 'spectator', 'away'),
      peer('p3', 'Bea', 'spectator', 'connected'),
      peer('', 'Nobody', 'spectator', 'handshake'),
      peer('p4', 'Cy', 'spectator', 'handshake'),
    ]);
    expect(list).toEqual([
      { id: 'v:p3', peerId: 'p3', nickname: 'Bea', connected: true },
      { id: 'v:p1', peerId: 'p1', nickname: 'Zed', connected: true },
    ]);
    expect(spectatorLabel('Viv')).toBe('Viv (spectator)');
    expect(spectatorLabel(undefined)).toBe('A spectator');
  });

  it('routes only a targeted reveal, only to that spectator’s own unseated page', () => {
    const reveal: PrivateMessage = { v: 1, t: 'reveal', instanceId: 'x', ref: { sid: 's' }, salt: 'salt', purpose: 'revealTo', about: 'cid' };
    const look: PrivateMessage = { ...reveal, purpose: 'look' } as PrivateMessage;
    const pack: PrivateMessage = { v: 1, t: 'pack', packId: 'p', cards: [] };
    const viv = peer(VIEWER, 'Viv', 'spectator');
    expect(spectatorRoute(ME, viv, false, reveal)).toBe(true);
    expect(spectatorRoute(ME, viv, false, look)).toBe(false);
    expect(spectatorRoute(ME, viv, false, pack)).toBe(false);
    expect(spectatorRoute(ME, viv, true, reveal)).toBe(false);
    expect(spectatorRoute(ME, { ...viv, role: 'player' }, false, reveal)).toBe(false);
    expect(spectatorRoute(ME, { ...viv, peerId: 'other' }, false, reveal)).toBe(false);
    expect(spectatorRoute(ME, { ...viv, status: 'handshake' }, false, reveal)).toBe(false);
    expect(spectatorRoute('s1', viv, false, reveal)).toBe(false);
  });
});

describe('spectatorRevealsOver: a spectator takes a reveal only with the revealTo naming it', () => {
  /** A table where s1 holds a committed hidden card in hand. */
  function setup() {
    const ids = ['h1', 'h2'];
    const cards: Record<string, RevealedCard> = Object.fromEntries(ids.map((id) => [id, { instanceId: id, ref: { sid: `sid-${id}` }, salt: `salt-${id}` }]));
    let s = createTable({ game: TEST_GAME, format: '1v1', seats: [0, 1].map((i) => ({ name: `P${i}`, colour: i, peer: `peer${i}` })) });
    s = reduce(s, { type: 'ready', by: 's1', cid: 'rd', seq: 1, zone: 'library:s1', instanceIds: ids, commits: ids.map((id) => commitFor(id, cards[id]!.ref, cards[id]!.salt)) } as Action);
    expect(s.commitments.s1?.instanceIds).toEqual(ids);
    const listeners = { seq: [] as ((a: SequencedAction, own: boolean) => void)[], state: [] as ((s: TableState) => void)[], prv: [] as ((m: PrivateMessage, f: { seat: SeatId | null; peerId: string }) => void)[] };
    let current = s;
    const host = {
      state: () => current,
      onState: (l: (s: TableState) => void) => (listeners.state.push(l), () => undefined),
      onSequenced: (l: (a: SequencedAction, own: boolean) => void) => (listeners.seq.push(l), () => undefined),
      onPrivate: (l: (m: PrivateMessage, f: { seat: SeatId | null; peerId: string }) => void) => (listeners.prv.push(l), () => undefined),
    };
    const got: SpectatorReveal[] = [];
    spectatorRevealsOver(host, ME, (r) => got.push(r));
    let seq = current.seq;
    const sequenced = (a: Omit<Action, 'seq'>): void => {
      const full = { ...a, seq: ++seq } as SequencedAction;
      current = reduce(current, full);
      for (const l of listeners.seq) l(full, false);
      for (const l of listeners.state) l(current);
    };
    const prv = (card: RevealedCard, about: string, from: SeatId | null = 's1', purpose: 'revealTo' | 'look' = 'revealTo', peerId = 'x'): void => {
      for (const l of listeners.prv) l({ v: 1, t: 'reveal', ...card, purpose, about }, { seat: from, peerId });
    };
    return { cards, got, sequenced, prv, setState: (st: TableState) => (current = st) };
  }

  it('takes a reveal that arrives after or before its revealTo, verified against the owner’s commitment', () => {
    const t = setup();
    t.sequenced({ type: 'revealTo', by: 's1', cid: 'r1', instanceId: 'h1', seats: [], spectators: [ME] } as Action);
    t.prv(t.cards.h1!, 'r1');
    t.prv(t.cards.h2!, 'r2');
    expect(t.got).toEqual([{ card: t.cards.h1, from: 's1', verified: true }]);
    t.sequenced({ type: 'revealTo', by: 's1', cid: 'r2', instanceId: 'h2', seats: [], spectators: [ME] } as Action);
    expect(t.got.map((g) => g.card.instanceId)).toEqual(['h1', 'h2']);
  });

  it('drops a reveal its revealTo does not name this spectator in, or that another seat, card or purpose carries', () => {
    const t = setup();
    t.sequenced({ type: 'revealTo', by: 's1', cid: 'other', instanceId: 'h1', seats: [], spectators: [spectatorIdOf('0000000000000009')] } as Action);
    t.prv(t.cards.h1!, 'other');
    t.sequenced({ type: 'revealTo', by: 's1', cid: 'seat', instanceId: 'h1', seats: ['s0'] } as Action);
    t.prv(t.cards.h1!, 'seat');
    t.sequenced({ type: 'revealTo', by: 's1', cid: 'mine', instanceId: 'h1', seats: [], spectators: [ME] } as Action);
    t.prv(t.cards.h2!, 'mine');
    t.prv(t.cards.h1!, 'mine', 's0');
    t.prv(t.cards.h1!, 'mine', null);
    t.prv(t.cards.h1!, 'mine', 's1', 'look');
    t.prv(t.cards.h1!, 'never-sequenced');
    expect(t.got).toEqual([]);
  });

  it('takes a reveal that came before this page knew the sender’s chair, by the chair that peer holds then', () => {
    const t = setup();
    // A page that just joined: its replica does not know peer1's chair yet, so the engine names no seat.
    t.prv(t.cards.h1!, 'r1', null, 'revealTo', 'peer1');
    t.prv(t.cards.h2!, 'r2', null, 'revealTo', 'peer0');
    t.sequenced({ type: 'revealTo', by: 's1', cid: 'r1', instanceId: 'h1', seats: [], spectators: [ME] } as Action);
    t.sequenced({ type: 'revealTo', by: 's1', cid: 'r2', instanceId: 'h2', seats: [], spectators: [ME] } as Action);
    // peer0 holds s0, not s1: its reveal of s1's card is dropped.
    expect(t.got).toEqual([{ card: t.cards.h1, from: 's1', verified: true }]);
  });

  it('flags an identity that does not open the commitment', () => {
    const t = setup();
    t.sequenced({ type: 'revealTo', by: 's1', cid: 'r1', instanceId: 'h1', seats: [], spectators: [ME] } as Action);
    t.prv({ ...t.cards.h1!, ref: { sid: 'sid-forged' } }, 'r1');
    expect(t.got).toEqual([{ card: { ...t.cards.h1!, ref: { sid: 'sid-forged' } }, from: 's1', verified: false }]);
  });
});

describe('spectatorRevealSender: the owner sends a reveal to the named spectator and owes it while the card stays put', () => {
  function setup() {
    const ids = ['h1', 'h2'];
    const cards: Record<string, RevealedCard> = Object.fromEntries(ids.map((id) => [id, { instanceId: id, ref: { sid: `sid-${id}` }, salt: `salt-${id}` }]));
    let s = createTable({ game: TEST_GAME, format: '1v1', seats: [0, 1].map((i) => ({ name: `P${i}`, colour: i, peer: `peer${i}` })) });
    s = reduce(s, { type: 'ready', by: 's1', cid: 'rd', seq: 1, zone: 'library:s1', instanceIds: ids, commits: ids.map((id) => commitFor(id, cards[id]!.ref, cards[id]!.salt)) } as Action);
    for (const id of ids) s = hand(s, id);
    expect(s.zones['hand:s1']?.ids).toEqual(ids);
    const secrets = { ...emptySecretStore('s1'), identities: Object.fromEntries(ids.map((id) => [id, { card: cards[id]!.ref, salt: cards[id]!.salt }])) };
    const listeners = { seq: [] as ((a: SequencedAction, own: boolean) => void)[], peers: [] as ((p: PeerInfo[]) => void)[] };
    let current = s;
    let peers: PeerInfo[] = [peer(VIEWER, 'Viv', 'spectator')];
    const sent: { to: string; about: string; id: string; sid: string }[] = [];
    const host = {
      confirmedState: () => current,
      seat: () => 's1',
      peers: () => peers,
      onSequenced: (l: (a: SequencedAction, own: boolean) => void) => (listeners.seq.push(l), () => undefined),
      onPeers: (l: (p: PeerInfo[]) => void) => (listeners.peers.push(l), () => undefined),
      sendPrivate: (to: SeatId, m: PrivateMessage) => {
        if (m.t === 'reveal') sent.push({ to, about: m.about, id: m.instanceId, sid: m.ref.sid });
        return peers.some((p) => spectatorIdOf(p.peerId) === to && p.status === 'connected');
      },
    };
    const off = spectatorRevealSender(host, () => secrets);
    let seq = current.seq;
    const sequenced = (a: Omit<Action, 'seq'>, own = true): void => {
      const full = { ...a, seq: ++seq } as SequencedAction;
      current = reduce(current, full);
      for (const l of listeners.seq) l(full, own);
    };
    const setPeers = (next: PeerInfo[]): void => {
      peers = next;
      for (const l of listeners.peers) l(next);
    };
    return { sent, sequenced, setPeers, off };
  }

  it('sends an own sequenced revealTo to each named spectator, with the revealTo as `about`, and nothing else', () => {
    const t = setup();
    t.sequenced({ type: 'revealTo', by: 's1', cid: 'r1', instanceId: 'h1', seats: [], spectators: [ME, spectatorIdOf('0000000000000009')] } as Action);
    t.sequenced({ type: 'revealTo', by: 's1', cid: 'r2', instanceId: 'h2', seats: ['s0'] } as Action);
    t.sequenced({ type: 'revealTo', by: 's1', cid: 'r3', instanceId: 'h2', seats: [], spectators: [ME] } as Action, false);
    expect(t.sent).toEqual([
      { to: ME, about: 'r1', id: 'h1', sid: 'sid-h1' },
      { to: spectatorIdOf('0000000000000009'), about: 'r1', id: 'h1', sid: 'sid-h1' },
    ]);
  });

  it('sends it again when that spectator’s page comes back, while the card is hidden in the same zone', () => {
    const t = setup();
    t.setPeers([]);
    t.sequenced({ type: 'revealTo', by: 's1', cid: 'r1', instanceId: 'h1', seats: [], spectators: [ME] } as Action);
    t.sequenced({ type: 'revealTo', by: 's1', cid: 'r2', instanceId: 'h2', seats: [], spectators: [ME] } as Action);
    expect(t.sent.map((x) => x.about)).toEqual(['r1', 'r2']);
    // The spectator's page connects (or reconnects after a reload): both are owed.
    t.setPeers([peer(VIEWER, 'Viv', 'spectator')]);
    expect(t.sent.map((x) => x.about)).toEqual(['r1', 'r2', 'r1', 'r2']);
    // Another spectator arriving, or a peers change that is not a return, sends nothing.
    t.setPeers([peer(VIEWER, 'Viv', 'spectator'), peer('0000000000000009', 'Zed', 'spectator')]);
    t.setPeers([peer(VIEWER, 'Viv', 'spectator'), peer('0000000000000009', 'Zed', 'spectator'), peer('peer0', 'P0', 'player', 'connected', 's0')]);
    expect(t.sent).toHaveLength(4);
    // h1 goes back to the library (where nobody sees it): no longer owed. h2 is still in hand.
    t.sequenced({ type: 'toZone', by: 's1', cid: 'back', card: 'h1', to: 'library:s1', position: 'top' } as Action);
    t.setPeers([]);
    t.setPeers([peer(VIEWER, 'Viv', 'spectator')]);
    expect(t.sent.slice(4).map((x) => [x.about, x.id])).toEqual([['r2', 'h2']]);
    // Once the card is public, nothing is owed any more.
    t.sequenced({ type: 'reveal', by: 's1', cid: 'show', instanceId: 'h2', ref: { sid: 'sid-h2' }, salt: 'salt-h2' } as Action);
    t.setPeers([]);
    t.setPeers([peer(VIEWER, 'Viv', 'spectator')]);
    expect(t.sent).toHaveLength(5);
    t.off();
  });

  it('tries again a few times after a spectator comes back (its side of the handshake may finish after ours)', () => {
    vi.useFakeTimers();
    try {
      const t = setup();
      t.setPeers([]);
      t.sequenced({ type: 'revealTo', by: 's1', cid: 'r1', instanceId: 'h1', seats: [], spectators: [ME] } as Action);
      t.setPeers([peer(VIEWER, 'Viv', 'spectator')]);
      expect(t.sent).toHaveLength(2);
      vi.advanceTimersByTime(SPECTATOR_RESEND_MS.at(-1)!);
      expect(t.sent).toHaveLength(2 + SPECTATOR_RESEND_MS.length);
      expect(new Set(t.sent.map((x) => `${x.to} ${x.about} ${x.id}`))).toEqual(new Set([`${ME} r1 h1`]));
      // Gone again before the retries: nothing more goes out, and unsubscribing stops what is scheduled.
      t.setPeers([]);
      t.setPeers([peer(VIEWER, 'Viv', 'spectator')]);
      t.setPeers([]);
      vi.advanceTimersByTime(SPECTATOR_RESEND_MS.at(-1)!);
      expect(t.sent).toHaveLength(3 + SPECTATOR_RESEND_MS.length);
      t.setPeers([peer(VIEWER, 'Viv', 'spectator')]);
      t.off();
      vi.advanceTimersByTime(SPECTATOR_RESEND_MS.at(-1)!);
      expect(t.sent).toHaveLength(4 + SPECTATOR_RESEND_MS.length);
    } finally {
      vi.useRealTimers();
    }
  });
});
