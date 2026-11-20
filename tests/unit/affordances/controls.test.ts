/**
 * PLAN M7-P5, the HUD side of play without keys (ui/touch/affordances.ts, ui/commands.ts runFor and counterOn): the
 * selection strip offers "Tap, Flip, Counter +/−, To graveyard, More…" (Attack in the own combat step), never a key; a
 * pile offers "Draw, Shuffle, Search, Reveal top" (a graveyard or exile: Open); the strip and the pile buttons stand
 * beside what they act on, inside the screen. Every control dispatches the very drafts the key does ("new routes
 * dispatch existing actions"): checked against Commands.run with the same cards hovered or selected.
 */
import { describe, expect, it } from 'vitest';
import type { ActionDraft } from '../../../src/core/actions';
import type { InstanceId, SecretStore, TableState } from '../../../src/core/types';
import type { ActionId } from '../../../src/games/types';
import { mtg } from '../../../src/games/mtg';
import { MTG_KEYMAP } from '../../../src/games/mtg/keymap';
import { Commands, type UiHooks } from '../../../src/ui/commands';
import { FakeSession } from '../../../src/ui/fakes';
import { inZoneKind } from '../../../src/ui/geometry';
import { keyLabel } from '../../../src/ui/keymap';
import { AFFORDANCE_GAP_PX, controlHeight, counterChips, pileButtons, pilePlace, stripItems, stripPlace } from '../../../src/ui/touch/affordances';
import { TOUCH_TARGET_PX } from '../../../src/ui/touch/actions';
import { act, applyDrafts, board, card, ok } from '../combat/helpers';

function commandsFor(state: TableState, seat = 's0', view: { hovered?: InstanceId | null; selection?: InstanceId[] } = {}) {
  const secrets: SecretStore = { seat, identities: {}, libraryOrder: [], hand: [], audit: [], received: {} };
  const session = new FakeSession(structuredClone(state), secrets, undefined, seat, () => 0);
  const ui = new Proxy({} as UiHooks, { get: () => () => undefined });
  let n = 0;
  const commands = new Commands({ session, game: mtg, scene: () => null, view: () => ({ hovered: view.hovered ?? null, selection: view.selection ?? [] }), ui, newId: (p) => `${p}-k${++n}`, now: () => 0 });
  const drafts = (): ActionDraft[] =>
    session.dispatched.map((a) => {
      const { by: _b, cid: _c, seq: _s, ...rest } = a;
      return rest as ActionDraft;
    });
  return { commands, drafts };
}

const ctxOf = (state: TableState, ids: string[], over: { phase?: string; myTurn?: boolean } = {}) => {
  const { commands } = commandsFor(state);
  return {
    cards: ids.map((id) => card(state, id)),
    me: 's0',
    phase: over.phase ?? 'main1',
    myTurn: over.myTurn ?? true,
    applies: (a: ActionId, c: Parameters<Commands['applies']>[1]) => commands.applies(a, c),
    battlefield: (c: Parameters<Commands['applies']>[1]) => inZoneKind(c, 'battlefield'),
  };
};

describe('the selection strip', () => {
  it('offers Tap, Flip, the counters, To graveyard and More… for a card on the battlefield in a main step', () => {
    const s = board();
    expect(stripItems(ctxOf(s, ['a00'])).map((i) => i.id)).toEqual(['tap', 'flip', 'counters', 'toGraveyard', 'more']);
  });

  it('puts Attack first in the own combat step, for own untapped creatures only', () => {
    let s = board();
    expect(stripItems(ctxOf(s, ['a00'], { phase: 'combat' })).map((i) => i.id)[0]).toBe('attack');
    expect(stripItems(ctxOf(s, ['a00'], { phase: 'combat', myTurn: false })).map((i) => i.id)).not.toContain('attack');
    expect(stripItems(ctxOf(s, ['b00'], { phase: 'combat' })).map((i) => i.id)).not.toContain('attack');
    s = ok(s, act('tap', { card: 'a00', tapped: true }));
    const items = stripItems(ctxOf(s, ['a00'], { phase: 'combat' }));
    expect(items.map((i) => i.id)).not.toContain('attack');
    // A tapped card offers Untap.
    expect(items.find((i) => i.id === 'tap')!.label).toBe('Untap');
  });

  it('a mixed selection reads Tap until every card is tapped', () => {
    let s = board();
    s = ok(s, act('tap', { card: 'a00', tapped: true }));
    expect(stripItems(ctxOf(s, ['a00', 'a01'])).find((i) => i.id === 'tap')!.label).toBe('Tap');
  });

  it('never names a key: no label carries a key of the keymap', () => {
    const s = board();
    const keys = new Set(['T', 'F', 'G', 'A', '+', '−', 'E', 'H']);
    for (const phase of ['main1', 'combat']) {
      for (const item of stripItems(ctxOf(s, ['a00'], { phase }))) {
        expect(item.label.split(/[\s(]/)).not.toContain(item.action ? keyLabel(MTG_KEYMAP, item.action) : '?');
        for (const k of keys) expect(item.label).not.toMatch(new RegExp(`\\(${k.replace('+', '\\+')}\\)`));
      }
    }
  });

  it('is empty for a spectator and for no cards', () => {
    const s = board();
    expect(stripItems({ ...ctxOf(s, ['a00']), me: null })).toEqual([]);
    expect(stripItems(ctxOf(s, []))).toEqual([]);
  });

  it('counter chips show the first card\'s counters, +1/+1 first, then by name; none without counters', () => {
    let s = board();
    expect(counterChips([card(s, 'a00')])).toEqual([]);
    s = ok(s, act('counter', { card: 'a00', kind: 'loyalty', delta: 3 }));
    s = ok(s, act('counter', { card: 'a00', kind: '+1/+1', delta: 2 }));
    s = ok(s, act('counter', { card: 'a00', kind: 'charge', delta: 1 }));
    expect(counterChips([card(s, 'a00')])).toEqual([
      { kind: '+1/+1', count: 2 },
      { kind: 'charge', count: 1 },
      { kind: 'loyalty', count: 3 },
    ]);
  });
});

describe('strip controls dispatch what the keys dispatch', () => {
  const same = (s: TableState, action: ActionId, ids: string[]) => {
    const viaKey = commandsFor(s, 's0', { selection: ids });
    viaKey.commands.run(action);
    // The strip acts on its cards whatever the pointer rests on (here another card is hovered).
    const viaStrip = commandsFor(s, 's0', { hovered: 'b01', selection: [] });
    viaStrip.commands.runFor(ids, action);
    expect(viaStrip.drafts()).toEqual(viaKey.drafts());
    return viaStrip.drafts();
  };

  it('Tap, Flip, To graveyard and Attack on one card and on a selection (one group)', () => {
    const s = board();
    expect(same(s, 'tap', ['a00'])).toEqual([{ type: 'tap', card: 'a00', tapped: true }]);
    const two = same(s, 'tap', ['a00', 'a01']);
    expect(two).toHaveLength(2);
    expect(two[0]!.group).toBeDefined();
    expect(two[1]!.group).toBe(two[0]!.group);
    same(s, 'flip', ['a02']);
    expect(same(s, 'toGraveyard', ['a00'])).toEqual([{ type: 'move', card: 'a00', to: 'graveyard:s0' }]);
    const atk = same(s, 'attack', ['a00', 'a01']);
    expect(applyDrafts(s, atk).cards['a00']).toMatchObject({ combat: 'attack', tapped: true });
  });

  it('counter + and − on the selection: one action per card; − skips a card without that counter', () => {
    let s = board();
    const { commands, drafts } = commandsFor(s);
    commands.counterOn(['a00', 'a01'], '+1/+1', 1);
    const d = drafts();
    expect(d.map((a) => a.type === 'counter' && [a.card, a.kind, a.delta])).toEqual([
      ['a00', '+1/+1', 1],
      ['a01', '+1/+1', 1],
    ]);
    expect(d[0]!.group).toBe(d[1]!.group);
    s = applyDrafts(s, [d[0]!].map(({ group: _g, ...a }) => a as ActionDraft));
    const minus = commandsFor(s);
    minus.commands.counterOn(['a00', 'a01'], '+1/+1', -1);
    expect(minus.drafts()).toEqual([{ type: 'counter', card: 'a00', kind: '+1/+1', delta: -1 }]);
    // The same as the − key on that card.
    const key = commandsFor(s, 's0', { hovered: 'a00' });
    key.commands.run('counterRemove');
    expect(key.drafts()).toEqual(minus.drafts());
  });
});

describe('pile actions', () => {
  const hover = (zone: string, owner: string | null) => ({ zone, pile: null, owner, count: 5, rect: { x: 900, y: 500, width: 60, height: 84 }, via: 'tap' as const });

  it('the own library: Draw, Shuffle, Search and Reveal top (Reveal top only with someone to reveal to)', () => {
    const s = board();
    expect(pileButtons(hover('library:s0', 's0'), s, 's0').map((b) => b.label)).toEqual(['Draw', 'Shuffle', 'Search', 'Reveal top']);
    const solo: TableState = { ...s, seats: { s0: s.seats['s0']!, s1: { ...s.seats['s1']!, name: '' } } };
    expect(pileButtons(hover('library:s0', 's0'), solo, 's0').map((b) => b.id)).toEqual(['draw', 'shuffle', 'search']);
  });

  it("another player's library offers nothing; a graveyard or exile opens; a spectator gets no library actions", () => {
    const s = board();
    expect(pileButtons(hover('library:s1', 's1'), s, 's0')).toEqual([]);
    expect(pileButtons(hover('graveyard:s1', 's1'), s, 's0').map((b) => b.id)).toEqual(['open']);
    expect(pileButtons(hover('exile:s0', 's0'), s, 's0').map((b) => b.id)).toEqual(['open']);
    expect(pileButtons(hover('library:s0', 's0'), s, null)).toEqual([]);
  });
});

describe('placement', () => {
  const vp = { width: 1440, height: 900 };

  it('the strip stands centred above the selection (below it when it is flagged), inside the screen, off the cards', () => {
    const rect = { x: 600, y: 400, width: 120, height: 90 };
    const size = { width: 300, height: 38 };
    const above = stripPlace({ cards: ['a'], rect, zone: null, above: true }, size, vp);
    expect(above).toEqual({ x: 510, y: 400 - AFFORDANCE_GAP_PX - 38 });
    const below = stripPlace({ cards: ['a'], rect, zone: null, above: false }, size, vp);
    expect(below.y).toBe(400 + 90 + AFFORDANCE_GAP_PX);
    // At the screen's edge it is pushed inside.
    expect(stripPlace({ cards: ['a'], rect: { x: 0, y: 400, width: 60, height: 80 }, zone: null, above: true }, size, vp).x).toBe(8);
    expect(stripPlace({ cards: ['a'], rect: { x: 1400, y: 400, width: 60, height: 80 }, zone: null, above: true }, size, vp).x).toBe(1440 - 300 - 8);
  });

  it('pile buttons stand beside the pile (left first), vertically centred on it, never over it', () => {
    const size = { width: 110, height: 120 };
    const p = pilePlace({ x: 1000, y: 500, width: 60, height: 84 }, size, vp);
    expect(p).toEqual({ x: 1000 - AFFORDANCE_GAP_PX - 110, y: 482, side: 'left' });
    const q = pilePlace({ x: 20, y: 500, width: 60, height: 84 }, size, vp);
    expect(q.side).toBe('right');
    expect(q.x).toBe(20 + 60 + AFFORDANCE_GAP_PX);
  });

  it('controls use the kit heights: 36 (sm) under a mouse, 44 (md, thumb-sized) on a touch screen', () => {
    expect(controlHeight(true)).toBe(TOUCH_TARGET_PX);
    expect(TOUCH_TARGET_PX).toBe(44);
    expect(controlHeight(false)).toBe(36);
  });
});
