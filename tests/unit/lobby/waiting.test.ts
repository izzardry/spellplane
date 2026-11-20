/**
 * The waiting room's rules (docs/design/m8/journey.md 4.7, 4.8, 4.9, 4.13; matchmaking.md 2.12): the code as a name,
 * the deck rule, the creator's pill and countdown, the line that says what is missing, the join field, the versus
 * columns, the 0-life offer and the game-over view. M8-P4.
 */
import { describe, expect, it } from 'vitest';
import type { SeatId, TableState } from '../../../src/core/types';
import { parseRoomLink } from '../../../src/ui/lobby/room';
import {
  BOOSTER_ONLY_REASON,
  codeLabel,
  concedeOffer,
  countdownMayRun,
  deckAllow,
  deckRuleOf,
  draftPacks,
  gameOverView,
  isBareCode,
  isLiveDraft,
  joinVerdict,
  missingLine,
  startPill,
  versusColumns,
  versusDone,
  versusFailure,
} from '../../../src/ui/lobby/waiting';
import { act, freshTable, sit } from './helpers';

const A = 'aaaaaaaaaaaaaaaa';
const B = 'bbbbbbbbbbbbbbbb';

function edit(state: TableState, f: (s: TableState) => void): TableState {
  const next = structuredClone(state);
  f(next);
  return next;
}
const readyAll = (s: TableState, ...seats: SeatId[]): TableState => edit(s, (t) => seats.forEach((id) => (t.seats[id]!.ready = true)));
const auto = (s: TableState): TableState => edit(s, (t) => (t.settings.autoSetup = true));

function twoSeated(): TableState {
  return sit(sit(freshTable(), 's0', 'Ann', 0, A), 's1', 'Ben', 1, B);
}

describe('codeLabel', () => {
  it('shows the room id as the game name', () => {
    expect(codeLabel('amber-fox-93')).toBe('AMBER FOX 93');
    expect(codeLabel('amber-fox-river-42')).toBe('AMBER FOX RIVER 42');
  });
});

describe('deck rule and allow', () => {
  const custom = { kind: 'custom' as const, source: 'pasted' as const, main: [{ sid: 'x' }] };
  const sealed = { kind: 'sealed' as const, source: 'built' as const, main: [{ sid: 'x' }] };
  const oldDrafted = { source: 'drafted' as const, main: [{ sid: 'x' }] };
  it('any deck takes custom and booster decks', () => {
    expect(deckAllow('any')(custom)).toBe(true);
    expect(deckAllow('any')(sealed)).toBe(true);
  });
  it('booster decks only rejects custom decks with the reason', () => {
    expect(deckAllow('booster')(custom)).toBe(BOOSTER_ONLY_REASON);
    expect(deckAllow('booster')(sealed)).toBe(true);
    expect(deckAllow('booster')(oldDrafted)).toBe(true);
  });
  it('an empty deck is never allowed', () => {
    expect(deckAllow('any')({ ...custom, main: [] })).toMatch(/no cards/);
  });
  it('reads the rule from the table settings, any by default', () => {
    expect(deckRuleOf(freshTable())).toBe('any');
    expect(deckRuleOf(freshTable(), 'booster')).toBe('booster');
    expect(deckRuleOf(edit(freshTable(), (t) => ((t.settings as { decks?: string }).decks = 'booster')))).toBe('booster');
  });
});

describe('live draft', () => {
  it('a table without explicit lobby settings is not a draft night', () => {
    expect(isLiveDraft(freshTable())).toBe(false);
  });
  it('explicit draft settings make it one, with one booster per pack (three at most)', () => {
    let t = twoSeated();
    t = act(t, 's0', { type: 'lobbySet', lobby: { draft: { format: 'pass', packs: 3, picks: 1 }, sets: ['M19', 'DOM'], pickTimer: false } });
    expect(isLiveDraft(t)).toBe(true);
    expect(draftPacks(t)).toEqual(['M19', 'DOM', 'DOM']);
    const constructed = act(twoSeated(), 's0', { type: 'lobbySet', lobby: { draft: null, sets: ['M19'], pickTimer: false } });
    expect(isLiveDraft(constructed)).toBe(false);
  });
});

describe('the creator pill and the missing line', () => {
  it('counts open seats', () => {
    const t = sit(freshTable(), 's0', 'Ann', 0, A);
    expect(startPill({ state: t, connected: true, count: null })).toEqual({ kind: 'waiting', label: 'WAITING · 1 OPEN SEAT' });
    expect(startPill({ state: sit(freshTable('ffa4'), 's0', 'Ann', 0, A), connected: true, count: null }).label).toBe('WAITING · 3 OPEN SEATS');
    expect(missingLine(t, 's0', 's0', true, null)).toBe('Waiting for one more player.');
  });
  it('counts ready players', () => {
    const t = readyAll(twoSeated(), 's0');
    expect(startPill({ state: t, connected: true, count: null }).label).toBe('WAITING · 1 OF 2 READY');
    expect(missingLine(t, 's0', 's0', true, null)).toBe('Waiting for Ben to be ready.');
    expect(missingLine(t, 's1', 's0', true, null)).toBe('Choose a deck and press READY.');
  });
  it('waits for connections before it starts', () => {
    const t = auto(readyAll(twoSeated(), 's0', 's1'));
    expect(startPill({ state: t, connected: false, count: 3 }).label).toBe('WAITING · CONNECTING');
    expect(countdownMayRun(t, false)).toBe(false);
    expect(missingLine(t, 's0', 's0', false, null)).toBe('Waiting for everyone to connect.');
  });
  it('counts down at a table with automatic setup', () => {
    const t = auto(readyAll(twoSeated(), 's0', 's1'));
    expect(countdownMayRun(t, true)).toBe(true);
    expect(startPill({ state: t, connected: true, count: 3 })).toEqual({ kind: 'start', label: 'START · 3', counting: true });
    expect(missingLine(t, 's0', 's0', true, 2)).toBe('Starting in 2…');
    expect(missingLine(t, 's1', 's0', true, null)).toBe('Waiting for Ann to start the game.');
  });
  it('never counts down at a table opened the old way', () => {
    const t = readyAll(twoSeated(), 's0', 's1');
    expect(countdownMayRun(t, true)).toBe(false);
    expect(startPill({ state: t, connected: true, count: null })).toEqual({ kind: 'start', label: 'START', counting: false });
  });
  it('stops counting when a seat is free again or someone is not ready', () => {
    const t = auto(readyAll(twoSeated(), 's0', 's1'));
    expect(countdownMayRun(edit(t, (x) => (x.seats.s1!.ready = false)), true)).toBe(false);
    expect(countdownMayRun(act(t, 's1', { type: 'seatLeave', seat: 's1' }), true)).toBe(false);
  });
});

describe('join', () => {
  const base = 'https://example.test/spellplane/';
  const parse = (t: string) => parseRoomLink(base, t);
  const key = 'AAAAAAAAAAAAAAAAAAAAAA';
  it('a pasted link navigates, also inside a sentence', () => {
    expect(joinVerdict(`https://x.test/#/t/amber-fox-93/${key}`, parse)).toEqual({ kind: 'go', hash: `#/t/amber-fox-93/${key}` });
    expect(joinVerdict(`Come play: https://x.test/#/t/amber-fox-93/${key}.`, parse)).toEqual({ kind: 'go', hash: `#/t/amber-fox-93/${key}` });
  });
  it('a bare code asks for the whole link', () => {
    for (const c of ['amber-fox-93', 'AMBER FOX 93', 'amber fox river 42']) {
      expect(isBareCode(c)).toBe(true);
      expect(joinVerdict(c, parse)).toEqual({ kind: 'code' });
    }
  });
  it('anything else is not a link', () => {
    expect(joinVerdict('hello', parse)).toEqual({ kind: 'bad' });
    expect(joinVerdict('   ', parse)).toEqual({ kind: 'empty' });
  });
});

describe('versus', () => {
  it('ticks per player and is done when everyone is connected and dealt', () => {
    let t = twoSeated();
    t = edit(t, (x) => {
      x.stage = 'match';
      x.commitments.s0 = { seat: 's0', commits: [], instanceIds: Array.from({ length: 60 }, (_, i) => `c${i}`), atSeq: 1 };
    });
    let cols = versusColumns(t, 's0', () => true);
    expect(cols.map((c) => [c.name, c.cards, c.shuffled, c.dealt])).toEqual([
      ['Ann', 60, false, false],
      ['Ben', 0, false, false],
    ]);
    expect(versusDone(cols)).toBe(false);
    t = edit(t, (x) => {
      x.seats.s0!.dealt = 0;
      x.seats.s1!.dealt = 0;
    });
    cols = versusColumns(t, 's0', () => true);
    expect(versusDone(cols)).toBe(true);
    expect(versusDone(versusColumns(t, 's0', () => false))).toBe(false);
    expect(versusFailure(versusColumns(t, 's0', () => false))).toBe('Ben could not be reached directly. Some networks do not allow it, and Spellplane uses no relay.');
  });
});

describe('the concede chip', () => {
  const match = (t: TableState) => edit(t, (x) => (x.stage = 'match'));
  it('is offered only to the seat at 0 life or 10 poison', () => {
    const t = match(edit(twoSeated(), (x) => (x.seats.s1!.life = 0)));
    expect(concedeOffer(t, 's1')).toEqual({ reason: 'life', text: 'You are at 0 life.' });
    expect(concedeOffer(t, 's0')).toBeNull();
    expect(concedeOffer(t, null)).toBeNull();
    const p = match(edit(twoSeated(), (x) => (x.seats.s0!.counters = { poison: 10 })));
    expect(concedeOffer(p, 's0')?.reason).toBe('poison');
  });
  it('is not offered outside a match, after the result or after conceding', () => {
    const low = edit(twoSeated(), (x) => (x.seats.s1!.life = -2));
    expect(concedeOffer(low, 's1')).toBeNull();
    expect(concedeOffer(match(edit(low, (x) => (x.seats.s1!.conceded = true))), 's1')).toBeNull();
    expect(concedeOffer(match(edit(low, (x) => (x.result = { winners: ['s0'], reason: 'concede', atSeq: 9 }))), 's1')).toBeNull();
  });
});

describe('game over', () => {
  const over = edit(twoSeated(), (x) => {
    x.stage = 'match';
    x.turn.number = 9;
    x.seats.s1!.conceded = true;
    x.result = { winners: ['s0'], reason: 'concede', atSeq: 40 };
  });
  it('says victory, defeat or game over with the reason', () => {
    expect(gameOverView(over, 's0', 'private')?.headline).toBe('VICTORY');
    expect(gameOverView(over, 's1', 'private')?.headline).toBe('DEFEAT');
    expect(gameOverView(over, null, 'private')?.headline).toBe('GAME OVER');
    expect(gameOverView(over, 's0', 'private')?.reason).toBe('Ben conceded on turn 9.');
    expect(gameOverView(over, 's1', 'private')?.reason).toBe('You conceded on turn 9.');
    expect(gameOverView(twoSeated(), 's0', 'private')).toBeNull();
  });
  it('picks the primary by the kind of game', () => {
    expect(gameOverView(over, 's0', 'matched')?.primary.label).toBe('FIND ANOTHER MATCH');
    expect(gameOverView(over, 's0', 'private')?.primary.label).toBe('REMATCH');
    expect(gameOverView(over, 's0', 'draft')?.primary.label).toBe('NEXT GAME');
  });
  it('shows the rating change only when the match record has one', () => {
    expect(gameOverView(over, 's0', 'matched')?.rating).toBeNull();
    expect(gameOverView(over, 's0', 'matched', { before: 1500, after: 1512 })?.rating).toBe('RANK 1512  ▲ +12');
    expect(gameOverView(over, 's1', 'matched', { before: 1500, after: 1488 })?.rating).toBe('RANK 1488  ▼ −12');
  });
});
