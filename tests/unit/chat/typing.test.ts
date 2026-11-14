/**
 * GAPS 22 (M6-P2): the "who is typing" indicator. DESIGN "Multiplayer architecture", Shared state: who is typing travels
 * on presence and is never logged; "Chat and voice", Text chat: table, team and spectator tabs; "Two-Headed Giant": a
 * team channel carries voice and text only between teammates; "Spectators": a spectator can chat.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTable } from '../../../src/core/reducer';
import type { TableState } from '../../../src/core/types';
import { mtg } from '../../../src/games/mtg/index';
import type { ChatChannel } from '../../../src/net/messages';
import type { PeerInfo, PeerPresence } from '../../../src/net/types';
import { TYPING_IDLE_MS, TypingSender, typersOf, typingSeats, typingText } from '../../../src/ui/chat/typing';

const t1v1 = (): TableState =>
  createTable({ game: mtg, format: '1v1', seats: [{ name: 'Anna', colour: 0, peer: 'pa' }, { name: 'Ben', colour: 1, peer: 'pb' }] });
const t2hg = (): TableState =>
  createTable({
    game: mtg,
    format: '2hg',
    seats: ['Anna', 'Ben', 'Cara', 'Dan'].map((name, i) => ({ name, colour: i as 0 | 1 | 2 | 3, peer: `p${i}`, team: i < 2 ? 't0' : 't1' })),
  });

const pres = (peerId: string, seat: string | null, typing: ChatChannel | null): PeerPresence => ({ peerId, seat, cursor: null, over: null, drag: [], speaking: false, typing, caption: null, at: 0 });
const spectatorPeer = (peerId: string, nickname: string): PeerInfo => ({ transportId: `t-${peerId}`, peerId, nickname, seat: null, role: 'spectator', status: 'connected', lastSeq: 0 });

describe('announcing typing', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());
  const sender = () => {
    const sent: (ChatChannel | null)[] = [];
    return { s: new TypingSender({ send: (c) => sent.push(c) }), sent };
  };

  it('announces the tab once the field holds text, once, and clears it when the text is sent or emptied', () => {
    const { s, sent } = sender();
    s.input('', 'table');
    s.input('   ', 'table');
    expect(sent).toEqual([]);
    s.input('g', 'table');
    s.input('gl', 'table');
    s.input('gl h', 'table');
    expect(sent).toEqual(['table']);
    s.input('', 'table');
    expect(sent).toEqual(['table', null]);
    s.input('x', 'table');
    s.stop();
    s.stop();
    expect(sent).toEqual(['table', null, 'table', null]);
  });

  it('stops after a pause without keystrokes, and comes back with the next one', () => {
    const { s, sent } = sender();
    s.input('a', 'table');
    vi.advanceTimersByTime(TYPING_IDLE_MS - 1);
    s.input('ab', 'table');
    vi.advanceTimersByTime(TYPING_IDLE_MS - 1);
    expect(sent).toEqual(['table']);
    vi.advanceTimersByTime(1);
    expect(sent).toEqual(['table', null]);
    s.input('abc', 'table');
    expect(sent).toEqual(['table', null, 'table']);
  });

  it('follows the tab: the spectator tab is announced, the team tab never', () => {
    const { s, sent } = sender();
    s.input('hi', 'spectator');
    s.input('hi', 'table');
    expect(sent).toEqual(['spectator', 'table']);
    s.input('psst', 'team');
    expect(sent).toEqual(['spectator', 'table', null]);
    s.input('psst more', 'team');
    vi.advanceTimersByTime(TYPING_IDLE_MS * 2);
    expect(sent).toEqual(['spectator', 'table', null]);
    expect(s.channel()).toBeNull();
  });
});

describe('who is shown typing', () => {
  it('names seated players by their seat and spectators by nickname, never the viewer, sorted', () => {
    const st = t1v1();
    const list = typersOf([pres('pb', 's1', 'table'), pres('vz', null, 'spectator'), pres('pa', 's0', 'table'), pres('pc', 's1', null)], st, 's0', [spectatorPeer('vz', ' Viv ')]);
    expect(list).toEqual([
      { peerId: 'pb', seat: 's1', name: 'Ben', channel: 'table' },
      { peerId: 'vz', seat: null, name: 'Viv (spectator)', channel: 'spectator' },
    ]);
    expect([...typingSeats(list)]).toEqual(['s1']);
  });

  it('a spectator sees players and other spectators typing on the table and spectator tabs', () => {
    const st = t1v1();
    const list = typersOf([pres('pa', 's0', 'table'), pres('vy', null, 'spectator')], st, 'v:0123456789abcdef', [spectatorPeer('vy', '')]);
    expect(list.map((t) => t.name)).toEqual(['Anna', 'Spectator (spectator)']);
  });

  it('team typing is shown to teammates only (an older client may announce it)', () => {
    const st = t2hg();
    const p = [pres('p1', 's1', 'team'), pres('p3', 's3', 'team')];
    expect(typersOf(p, st, 's0').map((t) => t.seat)).toEqual(['s1']);
    expect(typersOf(p, st, 's2').map((t) => t.seat)).toEqual(['s3']);
    // A spectator never sees team typing.
    expect(typersOf(p, st, 'v:0123456789abcdef')).toEqual([]);
    // Nor does a player at a table without teams.
    expect(typersOf([pres('pb', 's1', 'team')], t1v1(), 's0')).toEqual([]);
  });

  it('ignores a peer without an identity yet and a channel it does not know', () => {
    const st = t1v1();
    expect(typersOf([pres('', 's1', 'table'), pres('pb', 's1', 'lobby' as ChatChannel)], st, 's0')).toEqual([]);
  });

  it('a seat id that is not at the table counts as a spectator', () => {
    const list = typersOf([pres('px', 's9', 'table')], t1v1(), 's0', []);
    expect(list).toEqual([{ peerId: 'px', seat: null, name: 'Spectator (spectator)', channel: 'table' }]);
  });
});

describe('the line beside the chat field', () => {
  const ann = { peerId: 'a', seat: 's0', name: 'Anna', channel: 'table' as const };
  const ben = { peerId: 'b', seat: 's1', name: 'Ben', channel: 'table' as const };
  const cara = { peerId: 'c', seat: 's2', name: 'Cara', channel: 'table' as const };
  const viv = { peerId: 'v', seat: null, name: 'Viv (spectator)', channel: 'spectator' as const };

  it('says who is typing on the tab shown', () => {
    expect(typingText([], 'table')).toBe('');
    expect(typingText([ann], 'table')).toBe('Anna is typing…');
    expect(typingText([ann, ben], 'table')).toBe('Anna and Ben are typing…');
    expect(typingText([ann, ben, cara], 'table')).toBe('3 people are typing…');
  });

  it('names another tab the viewer has, and leaves out tabs the viewer does not have', () => {
    expect(typingText([viv], 'table', ['table', 'spectator'])).toBe('Viv (spectator) is typing in Spectators');
    expect(typingText([ann, viv], 'spectator', ['table', 'spectator'])).toBe('Viv (spectator) is typing… · Anna is typing in Table');
    expect(typingText([viv], 'table', ['table'])).toBe('');
  });
});
