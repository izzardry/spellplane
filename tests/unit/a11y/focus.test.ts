/**
 * Keyboard card focus (DESIGN "Input and interaction design", Accessibility: "every card action is reachable from the
 * keyboard by cycling focus through cards in a zone"; PLAN M5-P4; DECISIONS [M5-C]: arrow keys move focus, cards of a
 * zone in their visible order with wrap, zones in a fixed order starting with the viewer's own, then the stack, then
 * the other seats clockwise; only zones and cards this viewer may see are focusable).
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { MTG_KEYMAP } from '../../../src/games/mtg/keymap';
import { FOCUS_KEYS, focusCards, focusMoveOf, focusZones, keepFocus, moveFocus, type CardFocus, type FocusMove } from '../../../src/ui/a11y/index';
import { game, table, withCards, without } from './fixture';

const OWN = ['hand:s0', 'battlefield:s0', 'library:s0', 'graveyard:s0', 'exile:s0', 'command:s0'];
const OF = (seat: string) => ['battlefield', 'library', 'graveyard', 'exile', 'command'].map((k) => `${k}:${seat}`);

/** A 1v1 table with cards in every kind of zone. */
function busy() {
  return withCards(table('1v1'), [
    { id: 'h1', zone: 'hand:s0' },
    { id: 'h2', zone: 'hand:s0' },
    { id: 'h3', zone: 'hand:s0' },
    { id: 'bfa', zone: 'battlefield:s0', pose: { x: -100, y: -250, rot: 0 } },
    { id: 'bfb', zone: 'battlefield:s0', pose: { x: 100, y: -250, rot: 0 } },
    { id: 'bfc', zone: 'battlefield:s0', pose: { x: 0, y: -400, rot: 0 } },
    { id: 'bfd', zone: 'battlefield:s0', pose: { x: -50, y: -260, rot: 90 } },
    { id: 'lib1', zone: 'library:s0' },
    { id: 'lib2', zone: 'library:s0' },
    { id: 'gy1', zone: 'graveyard:s0' },
    { id: 'gy2', zone: 'graveyard:s0' },
    { id: 'st1', zone: 'stack' },
    { id: 'st2', zone: 'stack' },
    { id: 'oh1', zone: 'hand:s1' },
    { id: 'oh2', zone: 'hand:s1' },
    { id: 'ol1', zone: 'library:s1' },
    { id: 'obf', zone: 'battlefield:s1', pose: { x: 0, y: 300, rot: 180 } },
    { id: 'ofd', zone: 'battlefield:s1', face: 'down', pose: { x: 100, y: 300, rot: 180 } },
  ]);
}

describe('the zone order', () => {
  it('starts with the own hand, battlefield, library, graveyard, exile and command zone, then the stack, then the opponent', () => {
    expect(focusZones(table('1v1'), game, 's0')).toEqual([...OWN, 'stack', ...OF('s1')]);
    expect(focusZones(table('1v1'), game, 's1')).toEqual([...OWN.map((z) => z.replace('s0', 's1')), 'stack', ...OF('s0')]);
  });

  it('visits the other seats clockwise from the viewer (four players: the next seat in turn order first)', () => {
    const zones = focusZones(table('ffa4'), game, 's2');
    expect(zones.slice(0, 7)).toEqual([...OWN.map((z) => z.replace('s0', 's2')), 'stack']);
    const seatsAfter = zones.slice(7).map((z) => z.split(':')[1]);
    expect([...new Set(seatsAfter)]).toEqual(['s3', 's0', 's1']);
  });

  it('never offers another player\'s hand, a sideboard or a draft pack', () => {
    for (const viewer of ['s0', 's1', 's2', 's3']) {
      const zones = focusZones(table('ffa4'), game, viewer);
      expect(zones.filter((z) => z.startsWith('hand:'))).toEqual([`hand:${viewer}`]);
      expect(zones.some((z) => z.startsWith('sideboard') || z.startsWith('pack'))).toBe(false);
    }
  });

  it('a spectator (no seat) starts at the stack and visits every seat from the first', () => {
    const zones = focusZones(table('1v1'), game, null);
    expect(zones).toEqual(['stack', ...OF('s0'), ...OF('s1')]);
    expect(moveFocus(table('1v1'), game, null, null, 'nextCard')).toEqual({ zone: 'stack', card: null });
  });
});

describe('the cards of a zone', () => {
  it('the own hand follows the fan order the HUD shows, then any card the arrangement lacks', () => {
    const st = busy();
    expect(focusCards(st, game, 's0', 'hand:s0', { handOrder: ['h3', 'h1'] })).toEqual(['h3', 'h1', 'h2']);
    expect(focusCards(st, game, 's0', 'hand:s0')).toEqual(['h1', 'h2', 'h3']);
  });

  it('hidden cards are never focusable: a library, and another player\'s hand even when asked directly', () => {
    const st = busy();
    expect(focusCards(st, game, 's0', 'library:s0')).toEqual([]);
    expect(focusCards(st, game, 's0', 'library:s1')).toEqual([]);
    expect(focusCards(st, game, 's0', 'hand:s1')).toEqual([]);
    expect(focusCards(st, game, null, 'hand:s0')).toEqual([]);
  });

  it('a battlefield reads as the viewer sees it: rows far to near, each left to right', () => {
    const st = busy();
    // Seat 0 sees its own territory upright: the row at y≈-255 (bfa, bfd, bfb by x), then the near row (bfc).
    expect(focusCards(st, game, 's0', 'battlefield:s0')).toEqual(['bfa', 'bfd', 'bfb', 'bfc']);
    // Seat 1 sits across: the same cards are upside down for it, so the near row of seat 0 is now the far row.
    expect(focusCards(st, game, 's1', 'battlefield:s0')).toEqual(['bfc', 'bfb', 'bfd', 'bfa']);
  });

  it('a face-down card on a battlefield is a card on the table (focusable, its identity is not needed)', () => {
    expect(focusCards(busy(), game, 's0', 'battlefield:s1')).toContain('ofd');
  });

  it('piles and the stack start with the top card', () => {
    const st = busy();
    expect(focusCards(st, game, 's0', 'graveyard:s0')).toEqual(['gy2', 'gy1']);
    expect(focusCards(st, game, 's0', 'stack')).toEqual(['st2', 'st1']);
  });
});

describe('moveFocus', () => {
  const st = busy();
  const mv = (from: CardFocus | null, move: FocusMove) => moveFocus(st, game, 's0', from, move);

  it('from nothing lands on the own hand (first card; last for left and PageDown)', () => {
    expect(mv(null, 'nextCard')).toEqual({ zone: 'hand:s0', card: 'h1' });
    expect(mv(null, 'nextZone')).toEqual({ zone: 'hand:s0', card: 'h1' });
    expect(mv(null, 'prevCard')).toEqual({ zone: 'hand:s0', card: 'h3' });
    expect(mv(null, 'last')).toEqual({ zone: 'hand:s0', card: 'h3' });
  });

  it('right and left cycle through the zone and wrap around', () => {
    expect(mv({ zone: 'hand:s0', card: 'h1' }, 'nextCard')).toEqual({ zone: 'hand:s0', card: 'h2' });
    expect(mv({ zone: 'hand:s0', card: 'h3' }, 'nextCard')).toEqual({ zone: 'hand:s0', card: 'h1' });
    expect(mv({ zone: 'hand:s0', card: 'h1' }, 'prevCard')).toEqual({ zone: 'hand:s0', card: 'h3' });
    expect(mv({ zone: 'graveyard:s0', card: 'gy2' }, 'nextCard')).toEqual({ zone: 'graveyard:s0', card: 'gy1' });
  });

  it('down and up move between zones, wrapping, onto the first card', () => {
    expect(mv({ zone: 'hand:s0', card: 'h2' }, 'nextZone')).toEqual({ zone: 'battlefield:s0', card: 'bfa' });
    expect(mv({ zone: 'battlefield:s0', card: 'bfb' }, 'prevZone')).toEqual({ zone: 'hand:s0', card: 'h1' });
    expect(mv({ zone: 'hand:s0', card: 'h1' }, 'prevZone')).toEqual({ zone: 'command:s1', card: null });
    expect(mv({ zone: 'command:s1', card: null }, 'nextZone')).toEqual({ zone: 'hand:s0', card: 'h1' });
    expect(mv({ zone: 'command:s0', card: null }, 'nextZone')).toEqual({ zone: 'stack', card: 'st2' });
  });

  it('PageUp and PageDown go to the first and last card of the zone', () => {
    expect(mv({ zone: 'battlefield:s0', card: 'bfd' }, 'first')).toEqual({ zone: 'battlefield:s0', card: 'bfa' });
    expect(mv({ zone: 'battlefield:s0', card: 'bfd' }, 'last')).toEqual({ zone: 'battlefield:s0', card: 'bfc' });
  });

  it('a library or an empty zone takes focus as a zone, without a card', () => {
    expect(mv({ zone: 'battlefield:s0', card: 'bfa' }, 'nextZone')).toEqual({ zone: 'library:s0', card: null });
    expect(mv({ zone: 'library:s0', card: null }, 'nextCard')).toEqual({ zone: 'library:s0', card: null });
    expect(mv({ zone: 'exile:s0', card: null }, 'last')).toEqual({ zone: 'exile:s0', card: null });
  });

  it('a card that left its zone counts as before the first card; a zone gone starts over at the hand', () => {
    expect(mv({ zone: 'hand:s0', card: 'gone' }, 'nextCard')).toEqual({ zone: 'hand:s0', card: 'h1' });
    expect(mv({ zone: 'hand:s0', card: 'gone' }, 'prevCard')).toEqual({ zone: 'hand:s0', card: 'h3' });
    expect(mv({ zone: 'battlefield:s9', card: null }, 'nextCard')).toEqual({ zone: 'hand:s0', card: 'h1' });
    // Another player's hand is not a focus place, even if a stale focus names it.
    expect(mv({ zone: 'hand:s1', card: 'oh1' }, 'nextCard')).toEqual({ zone: 'hand:s0', card: 'h1' });
  });

  it('every reachable focus is a focusable zone and a card this viewer may see (random key sequences)', () => {
    const moves: FocusMove[] = ['nextCard', 'prevCard', 'nextZone', 'prevZone', 'first', 'last'];
    for (const viewer of ['s0', 's1', null]) {
      const zones = new Set(focusZones(st, game, viewer));
      fc.assert(
        fc.property(fc.array(fc.constantFrom(...moves), { maxLength: 60 }), (keys) => {
          let f: CardFocus | null = null;
          for (const k of keys) {
            f = moveFocus(st, game, viewer, f, k);
            expect(f).not.toBeNull();
            expect(zones.has(f!.zone)).toBe(true);
            const cards = focusCards(st, game, viewer, f!.zone);
            if (cards.length === 0) expect(f!.card).toBeNull();
            else expect(cards).toContain(f!.card);
            // Never another player's hand card or any library card.
            const hidden = viewer === 's0' ? ['oh1', 'oh2'] : viewer === 's1' ? ['h1', 'h2', 'h3'] : ['oh1', 'oh2', 'h1', 'h2', 'h3'];
            expect([...hidden, 'ol1', 'lib1', 'lib2']).not.toContain(f!.card);
          }
        }),
        { numRuns: 60 },
      );
    }
  });

  it('visits every focusable card of every zone by right and down alone', () => {
    const seen = new Set<string>();
    let f: CardFocus | null = moveFocus(st, game, 's0', null, 'first');
    for (let z = 0; z < focusZones(st, game, 's0').length; z++) {
      const cards = focusCards(st, game, 's0', f!.zone);
      for (let i = 0; i < cards.length; i++) {
        seen.add(f!.card!);
        f = moveFocus(st, game, 's0', f, 'nextCard');
      }
      f = moveFocus(st, game, 's0', f, 'nextZone');
    }
    expect([...seen].sort()).toEqual(['bfa', 'bfb', 'bfc', 'bfd', 'gy1', 'gy2', 'h1', 'h2', 'h3', 'obf', 'ofd', 'st1', 'st2']);
  });
});

describe('the focus keys', () => {
  it('are the arrows and PageUp/PageDown, without modifiers, and no keymap key', () => {
    expect(focusMoveOf({ key: 'ArrowRight' })).toBe('nextCard');
    expect(focusMoveOf({ key: 'ArrowLeft' })).toBe('prevCard');
    expect(focusMoveOf({ key: 'ArrowDown' })).toBe('nextZone');
    expect(focusMoveOf({ key: 'ArrowUp' })).toBe('prevZone');
    expect(focusMoveOf({ key: 'PageUp' })).toBe('first');
    expect(focusMoveOf({ key: 'PageDown' })).toBe('last');
    for (const mod of ['ctrlKey', 'altKey', 'metaKey', 'shiftKey']) expect(focusMoveOf({ key: 'ArrowRight', [mod]: true })).toBeNull();
    expect(focusMoveOf({ key: 't' })).toBeNull();
    const keys = new Set(Object.values(FOCUS_KEYS));
    for (const b of MTG_KEYMAP) expect(keys.has(b.chord.key)).toBe(false);
  });
});

describe('keepFocus after the table changes', () => {
  it('stays on its card while it is still in the zone', () => {
    const st = busy();
    const before = focusCards(st, game, 's0', 'battlefield:s0');
    const tapped = { ...st, cards: { ...st.cards, bfd: { ...st.cards.bfd!, tapped: true } } };
    expect(keepFocus(tapped, game, 's0', { zone: 'battlefield:s0', card: 'bfd' }, before)).toEqual({ zone: 'battlefield:s0', card: 'bfd' });
  });

  it('passes to the card that took its place when the card leaves (G, E, H on the focused card)', () => {
    const st = busy();
    const before = focusCards(st, game, 's0', 'battlefield:s0');
    expect(keepFocus(without(st, 'bfd'), game, 's0', { zone: 'battlefield:s0', card: 'bfd' }, before)).toEqual({ zone: 'battlefield:s0', card: 'bfb' });
    // The last card leaves: the new last card.
    expect(keepFocus(without(st, 'bfc'), game, 's0', { zone: 'battlefield:s0', card: 'bfc' }, before)).toEqual({ zone: 'battlefield:s0', card: 'bfb' });
  });

  it('an emptied zone keeps the zone without a card; a zone that is gone drops focus', () => {
    const st = withCards(table('1v1'), [{ id: 'x', zone: 'exile:s0' }]);
    expect(keepFocus(without(st, 'x'), game, 's0', { zone: 'exile:s0', card: 'x' }, ['x'])).toEqual({ zone: 'exile:s0', card: null });
    expect(keepFocus(table('1v1'), game, 's0', { zone: 'battlefield:s3', card: null }, [])).toBeNull();
    expect(keepFocus(table('1v1'), game, 's0', null, [])).toBeNull();
  });
});
