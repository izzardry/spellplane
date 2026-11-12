/**
 * The team pair channel and the session's team view without a network (PLAN M3-P2; DESIGN "Players, seats and
 * formats", Two-Headed Giant: "Each teammate's hand is visible live to the other", "A team channel carries voice and
 * text only between teammates"; "Specification: network protocol and secrecy", prv `teamHand`; Commitments: an
 * unverified card is flagged). Two fake engines share one "wire": what one sends with `sendPrivate` the other receives
 * with the sender's seat, so the checks of both directions are exercised against the confirmed state.
 */
import { describe, expect, it } from 'vitest';
import { makeCommitments, type RevealedCard } from '../../../src/core/commit';
import type { SecretStore, TableState } from '../../../src/core/types';
import { emptySecretStore } from '../../../src/core/secrets';
import { asTeamHand, teamChannelOver, type TeamChannelHost } from '../../../src/net/team';
import type { PrivateMessage } from '../../../src/net/messages';
import { ownHandPayload, TeamView } from '../../../src/session/team';
import { teamTable } from './helpers';

type Listener = (msg: PrivateMessage, from: { seat: string | null; peerId: string }) => void;

/** A table where `seat` committed `cards` (all in its hand zone unless `library`). */
function withHand(state: TableState, seat: string, cards: readonly RevealedCard[], library: readonly RevealedCard[] = []): TableState {
  const all = [...cards, ...library];
  const ids = cards.map((c) => c.instanceId).sort();
  const lib = library.map((c) => c.instanceId).sort();
  const next = structuredClone(state);
  next.commitments[seat] = { seat, commits: makeCommitments(all), instanceIds: all.map((c) => c.instanceId).sort(), atSeq: 1 };
  for (const id of [...ids, ...lib]) next.cards[id] = { id, owner: seat, controller: seat, zone: ids.includes(id) ? `hand:${seat}` : `library:${seat}`, face: 'down', faceIndex: 0, tapped: false, pose: { x: 0, y: 0, rot: 0 }, counters: {} };
  next.zones[`hand:${seat}`] = { id: `hand:${seat}`, kind: 'hand', owner: seat, visibility: 'owner', ids, count: ids.length };
  next.zones[`library:${seat}`] = { id: `library:${seat}`, kind: 'library', owner: seat, visibility: 'nobody', ids: lib, count: lib.length };
  return next;
}

const card = (id: string, sid = `sid-${id}`): RevealedCard => ({ instanceId: id, ref: { sid }, salt: `salt-${id}` });

/** Fake engines for seats on one wire; `state` is every engine's confirmed state. */
function wire(state: { current: TableState }) {
  const listeners = new Map<string, Set<Listener>>();
  const sent: { from: string; to: string; msg: PrivateMessage }[] = [];
  const engine = (seat: string): TeamChannelHost => ({
    seat: () => seat,
    confirmedState: () => state.current,
    sendPrivate: (to, msg) => {
      sent.push({ from: seat, to, msg });
      for (const l of listeners.get(to) ?? []) l(structuredClone(msg), { seat, peerId: `p-${seat}` });
      return true;
    },
    onPrivate: (l) => {
      const set = listeners.get(seat) ?? new Set<Listener>();
      set.add(l);
      listeners.set(seat, set);
      return () => set.delete(l);
    },
  });
  return { engine, sent };
}

describe('net/team.ts: the teammate hand on the pair channel', () => {
  const hand = [card('h1'), card('h2'), card('h3')];
  const library = [card('l1')];

  it('sends the hand to the teammate only, and only cards the confirmed state has in the own hand zone', () => {
    const state = { current: withHand(teamTable(), 's0', hand, library) };
    const { engine, sent } = wire(state);
    const anna = teamChannelOver(engine('s0'));
    const got: unknown[] = [];
    teamChannelOver(engine('s1')).onHand((from, cards, order, verified) => got.push({ from, cards, order, verified }));
    // A library card slipped into the list never leaves; nor does a card twice.
    anna.sendHand('s1', [...hand, library[0]!, hand[0]!], ['h3', 'h1', 'l1', 'h2']);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.msg).toMatchObject({ t: 'teamHand', cards: hand, order: ['h3', 'h1', 'h2'] });
    expect(got).toEqual([{ from: 's0', cards: hand, order: ['h3', 'h1', 'h2'], verified: [true, true, true] }]);
    // Opponents and the own seat get nothing.
    for (const to of ['s2', 's3', 's0']) anna.sendHand(to, hand, ['h1']);
    expect(sent).toHaveLength(1);
  });

  it('sends nothing while the table hides team hands, and the receiver ignores a hand then', () => {
    const state = { current: withHand(teamTable(), 's0', hand) };
    state.current.settings.teamHandsVisible = false;
    const { engine, sent } = wire(state);
    teamChannelOver(engine('s0')).sendHand('s1', hand, []);
    expect(sent).toEqual([]);
    const got: unknown[] = [];
    teamChannelOver(engine('s1')).onHand(() => got.push(1));
    engine('s0').sendPrivate('s1', { v: 1, t: 'teamHand', cards: hand, order: [] });
    expect(got).toEqual([]);
  });

  it('takes a hand from a teammate only, flags a card that does not open the commitment, and drops malformed ones', () => {
    const state = { current: withHand(withHand(teamTable(), 's0', hand), 's2', [card('c1')]) };
    const { engine } = wire(state);
    const got: { from: string; verified: boolean[] }[] = [];
    teamChannelOver(engine('s1')).onHand((from, _c, _o, verified) => got.push({ from, verified }));
    // An opponent pushing its hand to Ben is ignored.
    engine('s2').sendPrivate('s1', { v: 1, t: 'teamHand', cards: [card('c1')], order: ['c1'] });
    expect(got).toEqual([]);
    // A forged identity is flagged.
    engine('s0').sendPrivate('s1', { v: 1, t: 'teamHand', cards: [card('h1'), card('h2', 'sid-forged')], order: ['h1', 'h2'] });
    expect(got).toEqual([{ from: 's0', verified: [true, false] }]);
    // Malformed: an order naming a card not sent, a duplicate card.
    expect(asTeamHand({ t: 'teamHand', cards: [card('h1')], order: ['h9'] })).toBeNull();
    expect(asTeamHand({ t: 'teamHand', cards: [card('h1'), card('h1')], order: [] })).toBeNull();
    expect(asTeamHand({ t: 'teamHand', cards: [{ instanceId: 'h1', ref: { sid: 1 }, salt: 's' }], order: [] })).toBeNull();
    engine('s0').sendPrivate('s1', { v: 1, t: 'teamHand', cards: [card('h1')], order: ['h9'] });
    expect(got).toHaveLength(1);
  });

  it('team chat goes to and comes from a teammate only', () => {
    const state = { current: teamTable() };
    const { engine, sent } = wire(state);
    const lines: string[] = [];
    teamChannelOver(engine('s1')).onChat((from, _cid, text) => lines.push(`${from}:${text}`));
    const anna = teamChannelOver(engine('s0'));
    anna.sendChat('s1', 'c1', 'hold the trick', 3);
    anna.sendChat('s2', 'c2', 'not for you', 3);
    expect(sent.map((x) => x.to)).toEqual(['s1']);
    engine('s3').sendPrivate('s1', { v: 1, t: 'teamChat', cid: 'c3', text: 'spy', atSeq: 3 });
    expect(lines).toEqual(['s0:hold the trick']);
  });
});

describe('session/team.ts: the team view', () => {
  function view(state: { current: TableState }, seat: string, secrets: SecretStore, engine: TeamChannelHost): TeamView {
    const v = new TeamView({ seat: () => seat, confirmedState: () => state.current, secrets: () => secrets, now: () => 0 });
    v.attach(engine);
    return v;
  }

  it('sends the own hand in the owner’s arrangement once per change, and again to a teammate that (re)connects', () => {
    const hand = [card('h1'), card('h2'), card('h3')];
    const state = { current: withHand(teamTable(), 's0', hand) };
    const { engine, sent } = wire(state);
    const secrets: SecretStore = { ...emptySecretStore('s0'), hand: ['h2', 'h3', 'h1'], identities: Object.fromEntries(hand.map((c) => [c.instanceId, { card: c.ref, salt: c.salt }])) };
    expect(ownHandPayload(state.current, secrets, 's0').order).toEqual(['h2', 'h3', 'h1']);
    const anna = view(state, 's0', secrets, engine('s0'));
    const ben = view(state, 's1', emptySecretStore('s1'), engine('s1'));
    anna.sync();
    anna.sync();
    expect(sent).toHaveLength(1);
    expect(ben.hand('s0').map((c) => [c.id, c.verified])).toEqual([
      ['h2', true],
      ['h3', true],
      ['h1', true],
    ]);
    anna.sync(true);
    expect(sent).toHaveLength(2);
    // Opponents never: Cleo's view of Anna is empty.
    expect(view(state, 's2', emptySecretStore('s2'), engine('s2')).hand('s0')).toEqual([]);
  });

  it('a hand the engine could not send yet (teammate not verified) goes out on the next sync, without a peers event', () => {
    const hand = [card('h1'), card('h2')];
    const state = { current: withHand(teamTable(), 's0', hand) };
    const { engine, sent } = wire(state);
    const secrets: SecretStore = { ...emptySecretStore('s0'), hand: ['h1', 'h2'], identities: Object.fromEntries(hand.map((c) => [c.instanceId, { card: c.ref, salt: c.salt }])) };
    let verified = false;
    const real = engine('s0');
    const gated: TeamChannelHost = { ...real, sendPrivate: (to, msg) => verified && real.sendPrivate(to, msg) };
    const anna = view(state, 's0', secrets, gated);
    const ben = view(state, 's1', emptySecretStore('s1'), engine('s1'));
    anna.sync();
    expect(sent).toHaveLength(0);
    verified = true;
    // Any later change of the session syncs again; the unchanged hand is not taken as delivered.
    anna.sync();
    expect(sent).toHaveLength(1);
    expect(ben.hand('s0').map((c) => c.id)).toEqual(['h1', 'h2']);
    anna.sync();
    expect(sent).toHaveLength(1);
  });

  it('shows the copy that matches the hand zone, never a card that left it, and nothing while the teammate is away', () => {
    const state = { current: withHand(teamTable(), 's0', [card('h1'), card('h2')]) };
    const { engine } = wire(state);
    const ben = view(state, 's1', emptySecretStore('s1'), engine('s1'));
    const push = (ids: string[]): void => void engine('s0').sendPrivate('s1', { v: 1, t: 'teamHand', cards: ids.map((id) => card(id)), order: ids });
    // A newer copy (after a draw the confirmed state does not show here yet) arrives before an older one.
    push(['h1', 'h2', 'h3']);
    push(['h2', 'h1']);
    expect(ben.hand('s0').map((c) => c.id)).toEqual(['h2', 'h1']);
    // The draw lands: the newer copy matches now.
    state.current = withHand(teamTable(), 's0', [card('h1'), card('h2'), card('h3')]);
    expect(ben.hand('s0').map((c) => c.id)).toEqual(['h1', 'h2', 'h3']);
    // A card leaves the hand before the next copy arrives: it is not shown.
    state.current = withHand(teamTable(), 's0', [card('h1'), card('h3')]);
    expect(ben.hand('s0').map((c) => c.id)).toEqual(['h1', 'h3']);
    state.current = { ...state.current, seats: { ...state.current.seats, s0: { ...state.current.seats.s0!, away: true } } };
    expect(ben.hand('s0')).toEqual([]);
  });

  it('team chat lines are kept for the own timeline, once each', () => {
    const state = { current: teamTable() };
    const { engine, sent } = wire(state);
    const anna = view(state, 's0', emptySecretStore('s0'), engine('s0'));
    const ben = view(state, 's1', emptySecretStore('s1'), engine('s1'));
    let changes = 0;
    ben.subscribe(() => changes++);
    anna.say({ type: 'chat', text: 'go', channel: 'team', by: 's0', cid: 'k1' });
    engine('s0').sendPrivate('s1', { v: 1, t: 'teamChat', cid: 'k1', text: 'go', atSeq: 0 });
    expect(sent.filter((x) => x.msg.t === 'teamChat').map((x) => x.to)).toEqual(['s1', 's1']);
    expect(anna.chatLog()).toHaveLength(1);
    expect(ben.chatLog()).toEqual([{ kind: 'action', seq: 0, at: 0, action: { type: 'chat', text: 'go', channel: 'team', by: 's0', cid: 'k1', seq: 0 } }]);
    expect(changes).toBe(1);
  });
});
