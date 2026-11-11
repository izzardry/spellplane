/**
 * Pure HUD logic: hand fan geometry, tidy, log lines, deck import parsing, routes and context menus
 * (DESIGN "Specification: geometry, layout and motion", "Card manipulation", "Turn flow and confirmation",
 * "Pre-game: draft, sealed and deck building", "Input and interaction design").
 */
import { describe, expect, it } from 'vitest';
import type { Action, DistributiveOmit } from '../../../src/core/actions';
import type { LogEntry } from '../../../src/core/types';
import { MTG_KEYMAP } from '../../../src/games/mtg/keymap';
import { checkDeck, errorName, parsePlainList, replaceName } from '../../../src/ui/deck';
import { logLines } from '../../../src/ui/describe';
import { FakeCardData, fakeGame, tableWith } from '../../../src/ui/fakes';
import { isEmptyChair, untapOfferOnOpen } from '../../../src/ui/commands';
import { CARD_ASPECT, fanLayout, fitInsets, handOrder } from '../../../src/ui/hand';
import { cardMenu, tableMenu } from '../../../src/ui/menu';
import { parseRoute, routeHash } from '../../../src/ui/routes';
import { tidyPoses } from '../../../src/ui/tidy';
import { rig } from './setup';

describe('hand fan geometry (DESIGN "Specification: geometry, layout and motion", Screen layer)', () => {
  it('cards are 22% of viewport height with the card aspect, centred, without overlap while they fit', () => {
    const boxes = fanLayout(3, 1440, 900);
    for (const b of boxes) {
      expect(b.height).toBeCloseTo(198);
      expect(b.width / b.height).toBeCloseTo(CARD_ASPECT);
      expect(b.bottom).toBe(0);
    }
    expect(boxes[1]!.left - boxes[0]!.left).toBeGreaterThan(boxes[0]!.width);
    const mid = (boxes[0]!.left + boxes[2]!.left + boxes[2]!.width) / 2;
    expect(mid).toBeCloseTo(720);
  });

  it('many cards overlap to span exactly 80% of the width', () => {
    for (const n of [12, 20, 60]) {
      const boxes = fanLayout(n, 1440, 900);
      const span = boxes.at(-1)!.left + boxes.at(-1)!.width - boxes[0]!.left;
      expect(span).toBeCloseTo(1152);
      expect(boxes[0]!.left).toBeCloseTo(144);
    }
  });

  it('the hovered card is 45% of viewport height, on top, centred on its slot and kept inside the viewport', () => {
    const boxes = fanLayout(5, 1440, 900, 2);
    const h = boxes[2]!;
    const rest = fanLayout(5, 1440, 900)[2]!;
    expect(h.height).toBeCloseTo(405);
    expect(h.width / h.height).toBeCloseTo(CARD_ASPECT);
    expect(h.z).toBeGreaterThan(Math.max(...boxes.filter((b) => b !== h).map((b) => b.z)));
    expect(h.left + h.width / 2).toBeCloseTo(rest.left + rest.width / 2);
    const edge = fanLayout(30, 1440, 900, 0)[0]!;
    expect(edge.left).toBeGreaterThanOrEqual(0);
  });

  it('an empty hand has no boxes; one card sits in the middle', () => {
    expect(fanLayout(0, 1440, 900)).toEqual([]);
    const [one] = fanLayout(1, 1440, 900);
    expect(one!.left + one!.width / 2).toBeCloseTo(720);
  });

  it('keeps the owner\'s arrangement and only own hand members', () => {
    const { state, secrets } = tableWith(['Anna'], [
      { id: 'a', zone: 'hand:s0', sid: 'sid-bear' },
      { id: 'b', zone: 'hand:s0', sid: 'sid-bolt' },
      { id: 'c', zone: 'hand:s0', sid: 'sid-land' },
    ]);
    secrets.hand = ['c', 'a', 'gone'];
    expect(handOrder(state, secrets, 's0')).toEqual(['c', 'a', 'b']);
  });
});

describe('tidy (DESIGN "Card manipulation": rows, piles and relative order kept)', () => {
  const layout = fakeGame().layout('1v1');

  it('lays own cards out in rows inside the territory, front row first, left to right in previous order', () => {
    const { state } = tableWith(['Anna', 'Ben'], [
      { id: 'b', zone: 'battlefield:s0', sid: 'sid-bear', pose: { x: 100, y: -200, rot: 0 } },
      { id: 'a', zone: 'battlefield:s0', sid: 'sid-bear', pose: { x: -400, y: -210, rot: 0 } },
      { id: 'l', zone: 'battlefield:s0', sid: 'sid-land', pose: { x: 0, y: -480, rot: 90 } },
      { id: 'o', zone: 'battlefield:s1', sid: 'sid-bear', pose: { x: 0, y: 300, rot: 180 } },
    ]);
    const poses = tidyPoses(state, 's0', layout);
    expect(Object.keys(poses).sort()).toEqual(['a', 'b', 'l']);
    expect(poses.a!.y).toBe(poses.b!.y);
    expect(poses.a!.x).toBeLessThan(poses.b!.x);
    expect(poses.l!.y).toBeLessThan(poses.a!.y);
    expect(poses.l!.rot).toBe(90); // tapped stays tapped
    for (const p of Object.values(poses)) {
      expect(p.y).toBeLessThan(-110);
      expect(p.y).toBeGreaterThan(-550);
      expect(Math.abs(p.x)).toBeLessThan(700);
    }
    // A sideways card takes 88 mm of row width, never overlapping its neighbour.
    expect(poses.b!.x - poses.a!.x).toBeGreaterThanOrEqual(63 + 6);
  });

  it('moves piles and attachments as one unit, keeping their offsets', () => {
    const { state } = tableWith(['Anna'], [
      { id: 'p0', zone: 'battlefield:s0', sid: 'sid-land', pose: { x: 300, y: -300, rot: 0 } },
      { id: 'p1', zone: 'battlefield:s0', sid: 'sid-land', pose: { x: 300, y: -314, rot: 0 } },
      { id: 'host', zone: 'battlefield:s0', sid: 'sid-bear', pose: { x: -300, y: -300, rot: 0 } },
      { id: 'aura', zone: 'battlefield:s0', sid: 'sid-bolt', pose: { x: -290, y: -290, rot: 0 } },
    ]);
    state.cards.p0!.pile = { id: 'P', index: 0, kind: 'cascade' };
    state.cards.p1!.pile = { id: 'P', index: 1, kind: 'cascade' };
    state.cards.aura!.attachedTo = 'host';
    const poses = tidyPoses(state, 's0', layout);
    expect(poses.p1!.x - poses.p0!.x).toBeCloseTo(0);
    expect(poses.p1!.y - poses.p0!.y).toBeCloseTo(-14);
    expect(poses.aura!.x - poses.host!.x).toBeCloseTo(10);
    expect(poses.aura!.y - poses.host!.y).toBeCloseTo(10);
  });

  it('works in the far seat\'s own frame (seat at 180°) and leaves displaced cards alone', () => {
    const { state } = tableWith(['Anna', 'Ben'], [
      { id: 'x', zone: 'battlefield:s1', sid: 'sid-bear', pose: { x: 50, y: 200, rot: 180 } },
      { id: 'y', zone: 'battlefield:s1', sid: 'sid-bear', pose: { x: -50, y: 200, rot: 180 } },
      { id: 'z', zone: 'battlefield:s1', sid: 'sid-bear', pose: { x: 0, y: 150, rot: 180 }, home: { x: 0, y: 260, rot: 180 }, combat: 'attack' },
    ]);
    const poses = tidyPoses(state, 's1', layout);
    expect(Object.keys(poses).sort()).toEqual(['x', 'y']);
    // In Ben's frame x (at canonical +50) is to his left of y, so after tidy it stays to his left: larger canonical x.
    expect(poses.x!.x).toBeGreaterThan(poses.y!.x);
    expect(poses.x!.y).toBeGreaterThan(110);
  });

  it('is deterministic', () => {
    const r = rig();
    const st = r.session.getState();
    expect(tidyPoses(st, 's0', layout)).toEqual(tidyPoses(structuredClone(st), 's0', layout));
  });
});

describe('log lines (DESIGN "Turn flow and confirmation", Action log)', () => {
  const entry = (seq: number, at: number, action: DistributiveOmit<Action, 'cid' | 'seq'>): LogEntry => ({ kind: 'action', seq, at, action: { cid: `c${seq}`, seq, ...action } as Action });

  function lines(entries: LogEntry[], mutate?: (s: ReturnType<typeof tableWith>['state']) => void) {
    const { state } = tableWith(['Anna', 'Ben'], [
      { id: 'bf1', zone: 'battlefield:s0', sid: 'sid-bear' },
      { id: 'h1', zone: 'hand:s0', sid: 'sid-bolt' },
    ]);
    mutate?.(state);
    const data = new FakeCardData();
    return logLines(entries, {
      state,
      cardName: (id) => {
        const ref = state.cards[id]?.identity;
        return ref ? (data.peek(ref.sid)?.name ?? null) : null;
      },
      phaseLabel: (id) => id.toUpperCase(),
    });
  }
  const text = (l: ReturnType<typeof lines>[number]) => `${l.actor} ${l.segs.map((s) => ('card' in s ? s.name : s.text)).join('')}`;

  it('one line per action with actor, seat colour and card names; hidden cards stay unnamed', () => {
    const ls = lines([
      entry(1, 0, { type: 'tap', by: 's0', card: 'bf1', tapped: true }),
      entry(2, 0, { type: 'toZone', by: 's1', card: 'h1', to: 'library:s0', position: 'bottom' }),
      entry(3, 0, { type: 'phaseSet', by: 's0', phase: 'combat' }),
    ]);
    expect(ls.map(text)).toEqual(['Anna taps Test Bear', "Ben puts a card on the bottom of Anna's library", 'Anna moves to COMBAT']);
    expect(ls.map((l) => l.colour)).toEqual([0, 1, 0]);
    expect(ls[0]!.segs.find((s) => 'card' in s)).toEqual({ card: 'bf1', name: 'Test Bear' });
  });

  it('merges life changes within two seconds into one line "Anna: 20 → 14"', () => {
    const ls = lines(
      [
        entry(1, 1000, { type: 'life', by: 's0', seat: 's0', delta: -3 }),
        entry(2, 2500, { type: 'life', by: 's0', seat: 's0', delta: -2 }),
        entry(3, 4000, { type: 'life', by: 's0', seat: 's0', delta: -1 }),
        entry(4, 9000, { type: 'life', by: 's0', seat: 's0', delta: 4 }),
      ],
      (s) => (s.seats.s0!.life = 18),
    );
    expect(ls.map(text)).toEqual(['Anna Anna: 20 → 14', 'Anna Anna: 14 → 18']);
  });

  it('does not merge changes by different players or to different seats', () => {
    const ls = lines(
      [
        entry(1, 0, { type: 'life', by: 's0', seat: 's1', delta: -2 }),
        entry(2, 100, { type: 'life', by: 's1', seat: 's1', delta: -1 }),
        entry(3, 200, { type: 'life', by: 's1', seat: 's0', delta: -1 }),
      ],
      (s) => {
        s.seats.s1!.life = 17;
        s.seats.s0!.life = 19;
      },
    );
    expect(ls.map(text)).toEqual(['Anna Ben: 20 → 18', 'Ben Ben: 18 → 17', 'Ben Anna: 20 → 19']);
  });

  it('shows every undo, and an undone draw says the card went back on top of the library', () => {
    const ls = lines([
      entry(1, 0, { type: 'draw', by: 's0', instanceId: 'x' }),
      entry(2, 0, { type: 'undo', by: 's0', of: 'c1', inverse: { type: 'toZone', by: 's0', cid: 'u', card: 'x', to: 'library:s0', position: 'top' } }),
      entry(3, 0, { type: 'tap', by: 's0', card: 'bf1', tapped: true }),
      entry(4, 0, { type: 'undo', by: 's0', of: 'c3', inverse: { type: 'tap', by: 's0', cid: 'u2', card: 'bf1', tapped: false } }),
    ]);
    expect(ls.map(text)).toEqual(['Anna draws a card', 'Anna undoes the draw; the card goes back on top of the library', 'Anna taps Test Bear', 'Anna undoes: taps Test Bear']);
  });

  it('chat lines interleave; protocol steps get no line; system lines are kept', () => {
    const ls = lines([
      entry(1, 0, { type: 'chat', by: 's1', text: 'gg', channel: 'table' }),
      entry(2, 0, { type: 'rngCommit', by: 's0', rid: 'r', purpose: 'die', n: 6, h: 'x' }),
      entry(3, 0, { type: 'shuffleNonce', by: 's1', sid: 'q', nonce: 'n' }),
      { kind: 'system', seq: 3, at: 0, level: 'warn', text: 'State hash mismatch' },
    ]);
    expect(ls.map((l) => l.kind)).toEqual(['chat', 'system']);
    expect(ls[1]!.level).toBe('warn');
  });

  it('a die roll shows its result once revealed', () => {
    const ls = lines([entry(1, 0, { type: 'rngReveal', by: 's0', rid: 'r', nonce: 'n' })], (s) => {
      s.rng.r = { id: 'r', purpose: 'die', n: 20, by: 's0', startSeq: 0, commits: {}, reveals: {}, result: 16 };
    });
    expect(ls.map(text)).toEqual(['Anna rolls a d20: 17']);
  });
  describe('quiet and honest lines (gate M0 findings)', () => {
    const cards = [
      { id: 'g1', zone: 'graveyard:s0', sid: 'sid-bear' },
      { id: 'g2', zone: 'graveyard:s0', sid: 'sid-land' },
      { id: 'g3', zone: 'graveyard:s0', sid: 'sid-bolt' },
      { id: 'lib1', zone: 'library:s0', sid: 'sid-dfc' },
    ];
    const data = new FakeCardData();
    const ctx = (state: ReturnType<typeof tableWith>['state'], names?: Map<string, string | null>) => ({
      state,
      cardName: (id: string) => {
        const ref = state.cards[id]?.identity;
        return ref ? (data.peek(ref.sid)?.name ?? null) : null;
      },
      phaseLabel: (id: string) => id,
      ...(names ? { names } : {}),
    });

    it('a gesture over several cards is one line: draw 7, mill 3 (its reveals get no line), tap 2', () => {
      const { state } = tableWith(['Anna'], cards);
      const es: LogEntry[] = [];
      let n = 0;
      for (let i = 0; i < 7; i++) es.push(entry(++n, 0, { type: 'draw', by: 's0', instanceId: `d${i}`, group: 'gd' }));
      for (const id of ['g1', 'g2', 'g3']) {
        es.push(entry(++n, 0, { type: 'reveal', by: 's0', instanceId: id, ref: { sid: 'x' }, salt: 's', group: 'gm' }));
        es.push(entry(++n, 0, { type: 'move', by: 's0', card: id, to: 'graveyard:s0', group: 'gm' }));
      }
      es.push(entry(++n, 0, { type: 'tap', by: 's0', card: 'g1', tapped: true, group: 'gt' }));
      es.push(entry(++n, 0, { type: 'tap', by: 's0', card: 'g2', tapped: true, group: 'gt' }));
      es.push(entry(++n, 0, { type: 'draw', by: 's0', instanceId: 'd9' }));
      es.push(entry(n + 1, 0, { type: 'draw', by: 's0', instanceId: 'd10' }));
      const ls = logLines(es, ctx(state));
      expect(ls.map(text)).toEqual([
        'Anna draws 7 cards',
        'Anna moves Test Bear, Verdant Field and Spark Jolt to their graveyard',
        'Anna taps Test Bear and Verdant Field',
        'Anna draws a card',
        'Anna draws a card',
      ]);
    });

    it('a reveal keeps its line unless the next action is about the same card (a cast names it)', () => {
      const { state } = tableWith(['Anna', 'Ben'], cards);
      const ls = logLines(
        [
          entry(1, 0, { type: 'reveal', by: 's0', instanceId: 'g1', ref: { sid: 'x' }, salt: 's' }),
          entry(2, 0, { type: 'stackPush', by: 's0', item: 'si1', kind: 'spell', card: 'g1', controller: 's0' }),
          entry(3, 0, { type: 'reveal', by: 's0', instanceId: 'g2', ref: { sid: 'x' }, salt: 's' }),
          entry(4, 0, { type: 'tap', by: 's0', card: 'g3', tapped: true }),
        ],
        ctx(state),
      );
      expect(ls.map(text)).toEqual(['Anna casts Test Bear', 'Anna reveals Verdant Field', 'Anna taps Spark Jolt']);
    });

    it('the M0 shuffle trace reads as a shuffle; a one-card private reorder names nothing; the match start reads plainly', () => {
      const { state } = tableWith(['Anna'], cards);
      const ls = logLines(
        [
          entry(1, 0, { type: 'stageSet', by: 's0', stage: 'match' }),
          entry(2, 0, { type: 'reorder', by: 's0', zone: 'library:s0', count: 60, orderHash: 'h' }),
          entry(3, 0, { type: 'reorder', by: 's0', zone: 'library:s0', count: 1, orderHash: 'h' }),
        ],
        ctx(state),
      );
      expect(ls.map(text)).toEqual(['Anna starts the game', 'Anna shuffles their library', 'Anna moves a card within their library']);
    });

    it('names are frozen when a line is first written: a hidden move stays unnamed after the card turns public', () => {
      const { state } = tableWith(['Anna'], cards);
      const es = [entry(1, 0, { type: 'toZone', by: 's0', card: 'lib1', to: 'library:s0', position: 'bottom' })];
      const names = new Map<string, string | null>();
      expect(logLines(es, ctx(state, names)).map(text)).toEqual(['Anna puts a card on the bottom of their library']);
      // Later the card is milled and public: the old line keeps its words.
      const later = structuredClone(state);
      later.cards.lib1 = { ...later.cards.lib1!, zone: 'graveyard:s0', identity: { sid: 'sid-dfc' } };
      expect(logLines(es, ctx(later, names)).map(text)).toEqual(['Anna puts a card on the bottom of their library']);
      // Without the memo the current state would name it.
      expect(logLines(es, ctx(later)).map(text)).toEqual(['Anna puts Moon Sage on the bottom of their library']);
    });
  });
});

describe('deck import (DESIGN "Pre-game", Constructed decks; "Specification: card data, packs and draft formats")', () => {
  it('the fallback parser reads counts, set suffixes, sideboard headers and SB: lines, and reports bad lines by number', () => {
    const r = parsePlainList('4 Test Bear\n2x Spark Jolt (TST) 2\n\nSideboard\n1 Moon Sage\nSB: 1 Verdant Field\nbad line\n0 Test Bear');
    expect(r.list.main).toEqual([
      { count: 4, name: 'Test Bear', section: 'main', line: 1 },
      { count: 2, name: 'Spark Jolt', set: 'tst', collectorNumber: '2', section: 'main', line: 2 },
    ]);
    expect(r.list.side.map((e) => [e.name, e.line])).toEqual([
      ['Moon Sage', 5],
      ['Verdant Field', 6],
    ]);
    expect(r.errors.map((e) => [e.line, e.kind])).toEqual([
      [7, 'syntax'],
      [8, 'syntax'],
    ]);
  });

  it('collects syntax and unresolved errors by line, with near matches, without blocking the rest', async () => {
    const r = await checkDeck('4 Test Bear\n1 Test Baer\n???\n2 Sprk Jolt', parsePlainList, new FakeCardData());
    expect(r.resolved.main).toHaveLength(4);
    expect(r.errors.map((e) => [e.line, e.kind])).toEqual([
      [2, 'unresolved'],
      [3, 'syntax'],
      [4, 'unresolved'],
    ]);
    expect(r.errors[0]!.nearMatches).toContain('Test Bear');
    expect(r.errors[2]!.nearMatches[0]).toBe('Spark Jolt');
  });

  it('uses the injected parser (data/) when given', async () => {
    const parse = () => ({ list: { main: [{ count: 1, name: 'Moon Sage', section: 'main' as const, line: 1 }], side: [], commander: [], companion: [] }, errors: [] });
    const r = await checkDeck('anything', parse, new FakeCardData());
    expect(r.resolved.main).toEqual([{ sid: 'sid-dfc' }]);
  });

  it('a near match replaces only the name on its line', () => {
    const text = '4 Test Bear\n2 Sprk Jolt (TST) 2\n1 Moon Sage';
    expect(replaceName(text, 2, 'Sprk Jolt', 'Spark Jolt')).toBe('4 Test Bear\n2 Spark Jolt (TST) 2\n1 Moon Sage');
    expect(errorName({ line: 2, text: 'SB: 2x Sprk Jolt (TST) 2', kind: 'unresolved', message: '', nearMatches: [] })).toBe('Sprk Jolt');
  });
});

describe('routes (PLAN M0-P4: #/ solo; #/t/<room>/<key>, #/diag, #/lobby reserved)', () => {
  it('parses and round-trips', () => {
    expect(parseRoute('')).toEqual({ name: 'solo' });
    expect(parseRoute('#/')).toEqual({ name: 'solo' });
    expect(parseRoute('#/t/abc/k%2F1')).toEqual({ name: 'room', room: 'abc', key: 'k/1' });
    expect(parseRoute('#/lobby')).toEqual({ name: 'lobby' });
    expect(parseRoute('#/diag/')).toEqual({ name: 'diag' });
    expect(parseRoute('#/t/abc')).toEqual({ name: 'notFound', hash: '#/t/abc' });
    expect(parseRoute('#/x')).toMatchObject({ name: 'notFound' });
    for (const h of ['#/', '#/lobby', '#/diag', '#/t/r%20m/k%2F1']) expect(routeHash(parseRoute(h))).toBe(h);
  });
});

describe('context menus (DESIGN "Input and interaction design": the key beside each action)', () => {
  it('lists exactly the actions that apply, each with its current key', () => {
    const r = rig();
    const st = r.session.getState();
    const runs: string[] = [];
    const bf = cardMenu(st.cards.bf1!, MTG_KEYMAP, r.commands, (a) => runs.push(a));
    const ids = bf.map((e) => e.id);
    expect(ids).toEqual(expect.arrayContaining(['tap', 'flip', 'rotate180', 'attack', 'ability', 'trigger', 'toGraveyard', 'toHand', 'toLibraryBottom', 'inspect']));
    expect(ids).not.toContain('transform');
    expect(ids).not.toContain('peek');
    expect(bf.find((e) => e.id === 'toLibraryBottom')!.key).toBe('Shift+L');
    expect(bf.find((e) => e.id === 'trigger')!.key).toBeNull();
    bf.find((e) => e.id === 'tap')!.run();
    expect(runs).toEqual(['tap']);
    const hand = cardMenu(st.cards.h1!, MTG_KEYMAP, r.commands, () => {}).map((e) => e.id);
    expect(hand).toContain('cast');
    expect(hand).not.toContain('tap');
    const table = tableMenu(MTG_KEYMAP, () => {});
    expect(table.find((e) => e.id === 'untapAll')!.key).toBe('Ctrl+U');
    const extra = { id: 'mill', label: 'Mill N…', key: null, run: () => {} };
    const withLibrary = tableMenu(MTG_KEYMAP, () => {}, [extra]).map((e) => e.id);
    expect(withLibrary.indexOf('mill')).toBe(withLibrary.indexOf('shuffle') + 1);
  });

  it('a named counter from the menu adds that kind', () => {
    const r = rig();
    const loyalty = cardMenu(r.session.getState().cards.bf1!, MTG_KEYMAP, r.commands, () => {}).find((e) => e.id === 'counter:loyalty')!;
    loyalty.run();
    expect(r.session.dispatched.map((a) => a.type === 'counter' && [a.kind, a.delta])).toEqual([['loyalty', 1]]);
  });
});

describe('screen-anchored layer and seats (gate M0 findings)', () => {
  it('the scene fit keeps clear of the toolbar row, the open log, the hand fan and the avatar column', () => {
    expect(fitInsets(900, true)).toBe('40 316 206 190');
    expect(fitInsets(900, false)).toBe('40 0 206 190');
  });

  it('an untaken seat without cards is an empty chair (no avatar); a named, taken or occupied seat is not', () => {
    const { state } = tableWith(['Anna', ''], [{ id: 'bf1', zone: 'battlefield:s0', sid: 'sid-bear' }]);
    expect(isEmptyChair(state, 's1')).toBe(true);
    expect(isEmptyChair(state, 's0')).toBe(false);
    expect(isEmptyChair({ ...state, seats: { ...state.seats, s1: { ...state.seats.s1!, peer: 'p1' } } }, 's1')).toBe(false);
    const withCard = tableWith(['Anna', ''], [{ id: 'x', zone: 'graveyard:s1', sid: 'sid-bear' }]).state;
    expect(isEmptyChair(withCard, 's1')).toBe(false);
  });
});

describe('untap-and-draw offer on a page that opens mid-turn (DESIGN "Turn flow and confirmation"; gate M1 finding)', () => {
  const act = (seq: number, action: Record<string, unknown>): LogEntry => ({ kind: 'action', seq, at: 0, action: { cid: `c${seq}`, seq, ...action } as unknown as Action });
  const table = (active: string) => {
    const { state } = tableWith(['Anna', 'Ben'], []);
    return { ...state, turn: { ...state.turn, number: 7, active } };
  };

  it('offers it when the last pass handed the turn to this seat and it has done nothing since', () => {
    const log = [act(1, { type: 'turnPass', to: 's0', by: 's1' }), act(2, { type: 'life', seat: 's0', delta: -1, by: 's1' })];
    expect(untapOfferOnOpen(table('s0'), 's0', log, null)).toBe(true);
  });

  it('does not offer it once the seat acted after the pass, or when it is not its turn', () => {
    const acted = [act(1, { type: 'turnPass', to: 's0', by: 's1' }), act(2, { type: 'draw', instanceId: 'x', by: 's0' })];
    expect(untapOfferOnOpen(table('s0'), 's0', acted, null)).toBe(false);
    expect(untapOfferOnOpen(table('s1'), 's0', [act(1, { type: 'turnPass', to: 's1', by: 's0' })], 7)).toBe(false);
  });

  it('a log that does not reach back to the pass offers it only when this tab had it open at this turn', () => {
    expect(untapOfferOnOpen(table('s0'), 's0', [], null)).toBe(false);
    expect(untapOfferOnOpen(table('s0'), 's0', [], 6)).toBe(false);
    expect(untapOfferOnOpen(table('s0'), 's0', [], 7)).toBe(true);
  });
});
