/**
 * PLAN M3-P5 Spectators, the view side: the watch link (`#/t/<room>/<key>/watch`, DECISIONS [M3-C]), showing the own
 * hand to a named spectator, what a spectator lists as shown to it, and how a spectator's chat line is named in the
 * log (DESIGN "Players, seats and formats", Spectators; "Chat and voice", Text chat).
 */
import { describe, expect, it } from 'vitest';
import type { Action } from '../../../src/core/actions';
import { reduce } from '../../../src/core/reducer';
import { emptySecretStore, receiveIdentity } from '../../../src/core/secrets';
import { spectatorIdOf } from '../../../src/core/teams';
import type { TableState } from '../../../src/core/types';
import { logLines } from '../../../src/ui/describe';
import { handOf, isWatchLink, playHash, revealHandDrafts, seatedPlayers, shownToMe, stageText, watchers, watchUrl } from '../../../src/ui/lobby/spectate';
import { parseRoute, routeHash } from '../../../src/ui/routes';
import { baseTable, libraryIds } from '../../sim/net/sim';

const ME = spectatorIdOf('abcdef0123456789');

/** The base table with seat 1 holding three cards in hand. */
function withHand(): TableState {
  let s = baseTable(2).state;
  for (const id of libraryIds(1).slice(5, 8)) s = reduce(s, { type: 'draw', by: 's1', cid: `d-${id}`, instanceId: id, seq: s.seq + 1 } as Action);
  return s;
}

describe('the watch route', () => {
  it('parses and prints `#/t/<room>/<key>/watch`, and nothing else after the key', () => {
    expect(parseRoute('#/t/amber-fox-river-42/AAAAAAAAAAAAAAAAAAAAAA/watch')).toEqual({ name: 'room', room: 'amber-fox-river-42', key: 'AAAAAAAAAAAAAAAAAAAAAA', watch: true });
    expect(parseRoute('#/t/amber-fox-river-42/AAAAAAAAAAAAAAAAAAAAAA/watch/')).toMatchObject({ watch: true });
    expect(parseRoute('#/t/amber-fox-river-42/AAAAAAAAAAAAAAAAAAAAAA')).toEqual({ name: 'room', room: 'amber-fox-river-42', key: 'AAAAAAAAAAAAAAAAAAAAAA' });
    expect(parseRoute('#/t/r/k/play')).toMatchObject({ name: 'notFound' });
    expect(parseRoute('#/t/r/k/watch/more')).toMatchObject({ name: 'notFound' });
    for (const h of ['#/t/r%20m/k%2F1/watch', '#/t/r/k']) expect(routeHash(parseRoute(h))).toBe(h);
  });

  it('builds the spectator link from the table link, and the way back to a chair', () => {
    const link = { roomId: 'amber-fox-river-42', roomKey: 'AAAAAAAAAAAAAAAAAAAAAA', url: 'https://x.test/spellplane/#/t/amber-fox-river-42/AAAAAAAAAAAAAAAAAAAAAA' };
    expect(watchUrl(link)).toBe(`${link.url}/watch`);
    expect(playHash(link)).toBe('#/t/amber-fox-river-42/AAAAAAAAAAAAAAAAAAAAAA');
  });

  it('tells a pasted spectator link from a player link', () => {
    expect(isWatchLink('https://x.test/spellplane/#/t/amber-fox-river-42/AAAAAAAAAAAAAAAAAAAAAA/watch')).toBe(true);
    expect(isWatchLink('come watch: #/t/amber-fox-river-42/k=AAAAAAAAAAAAAAAAAAAAAA/watch.')).toBe(true);
    expect(isWatchLink('https://x.test/spellplane/#/t/amber-fox-river-42/AAAAAAAAAAAAAAAAAAAAAA')).toBe(false);
    expect(isWatchLink('https://x.test/spellplane/#/t/amber-fox-river-42/AAAAAAAAAAAAAAAAAAAAAA/watchers')).toBe(false);
  });
});

describe('showing the hand to a named spectator', () => {
  it('reveals every hand card to that spectator only, in one group, in hand order', () => {
    const s = withHand();
    const drafts = revealHandDrafts(s, 's1', ME, 'g1');
    expect(drafts).toEqual(handOf(s, 's1').map((instanceId) => ({ type: 'revealTo', instanceId, seats: [], spectators: [ME], group: 'g1' })));
    expect(drafts).toHaveLength(3);
    // Each is a valid public record.
    for (const d of drafts) expect(reduce(s, { ...d, by: 's1', cid: 'c' } as Action)).toBe(s);
  });

  it('shows nothing for an empty hand, a seat that is not at the table, or a target that is not a spectator', () => {
    const s = withHand();
    expect(revealHandDrafts(s, 's0', ME, 'g')).toEqual([]);
    expect(revealHandDrafts(s, 's7', ME, 'g')).toEqual([]);
    expect(revealHandDrafts(s, 's1', 's0', 'g')).toEqual([]);
  });

  it('offers the connected spectators only', () => {
    const peers = [
      { transportId: 't1', peerId: 'p1', nickname: 'Viv', seat: null, role: 'spectator' as const, status: 'connected' as const, lastSeq: 0 },
      { transportId: 't2', peerId: 'p2', nickname: 'Away', seat: null, role: 'spectator' as const, status: 'away' as const, lastSeq: 0 },
      { transportId: 't3', peerId: 'p3', nickname: 'Ann', seat: 's0', role: 'player' as const, status: 'connected' as const, lastSeq: 0 },
    ];
    expect(watchers(peers).map((w) => w.id)).toEqual(['v:p1']);
  });
});

describe('what a spectator sees', () => {
  it('lists the cards shown to it by owner, in the owner’s hand order, and forgets public ones', () => {
    const s = withHand();
    const [h1, h2, h3] = handOf(s, 's1') as [string, string, string];
    let sec = emptySecretStore(ME);
    for (const id of [h3, h1]) sec = receiveIdentity(sec, { instanceId: id, ref: { sid: `sid-${id}` }, salt: 'x' }, 's1');
    expect(shownToMe(s, sec)).toEqual([
      {
        seat: 's1',
        name: 'P1',
        cards: [
          { id: h1, ref: { sid: `sid-${h1}` }, inHand: true },
          { id: h3, ref: { sid: `sid-${h3}` }, inHand: true },
        ],
      },
    ]);
    // h1 is played (public now): it is no longer listed as shown.
    let t = reduce(s, { type: 'reveal', by: 's1', cid: 'r', instanceId: h1, ref: { sid: `sid-${h1}` }, salt: 'x', seq: s.seq + 1 } as Action);
    t = reduce(t, { type: 'move', by: 's1', cid: 'm', card: h1, to: 'battlefield:s1', pose: { x: 0, y: 0, rot: 0 }, seq: t.seq + 1 } as Action);
    expect(shownToMe(t, sec)[0]!.cards.map((c) => c.id)).toEqual([h3]);
    expect(h2).toBeDefined();
  });

  it('says what stage the players are in and who sits at the table', () => {
    const s = baseTable(2).state;
    expect(stageText('lobby')).toMatch(/lobby/);
    expect(stageText('draft')).toMatch(/drafting/);
    expect(stageText('build')).toMatch(/building/);
    expect(stageText('match')).toBe('');
    expect(seatedPlayers(s).map((p) => [p.seat, p.name])).toEqual([
      ['s0', 'P0'],
      ['s1', 'P1'],
    ]);
  });

  it('names a spectator’s chat line by its nickname, never by its id', () => {
    const s = baseTable(2).state;
    const lines = logLines(
      [
        { kind: 'action', seq: s.seq + 1, at: 0, action: { type: 'chat', by: ME, cid: 'c1', text: 'gl hf', channel: 'table', name: 'Viv', seq: s.seq + 1 } as Action },
        { kind: 'action', seq: s.seq + 2, at: 0, action: { type: 'ping', by: ME, cid: 'p1', target: { kind: 'seat', id: 's0' }, seq: s.seq + 2 } as Action },
      ],
      { state: s, cardName: () => null, phaseLabel: (p) => p },
    );
    expect(lines[0]).toMatchObject({ kind: 'chat', actor: 'Viv (spectator)', colour: null, channel: 'table' });
    expect(lines[1]).toMatchObject({ kind: 'action', actor: 'A spectator', colour: null });
    // What a reader sees (actor and text) never shows the raw spectator id.
    expect(JSON.stringify(lines.map((l) => [l.actor, l.segs]))).not.toContain('abcdef0123456789');
  });
});
