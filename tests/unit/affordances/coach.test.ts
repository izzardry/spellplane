/**
 * PLAN M7-P5, gesture coach marks (ui/hints/coach.ts): "gesture coach marks that appear once at the moment an action
 * becomes relevant (first draw, first land, first attack) … Keys remain as accelerators but no hint text teaches keys";
 * docs/design/m7-hud-proposal.md, First-run hints: "One coach mark at a time … They disappear once you've done it."
 */
import { describe, expect, it } from 'vitest';
import type { CardData } from '../../../src/data/types';
import { MTG_KEYMAP } from '../../../src/games/mtg/keymap';
import type { CoachMarkId } from '../../../src/store/types';
import { COACH_MARK_IDS } from '../../../src/store/types';
import { CoachController, coachDone, coachFacts, coachText, nextCoach, NO_FACTS, TABLE_COACH_MARKS, type CoachFacts } from '../../../src/ui/hints/coach';
import { MemorySettings } from '../../../src/ui/fakes';
import { act, board, ok } from '../combat/helpers';

const f = (over: Partial<CoachFacts>): CoachFacts => ({ ...NO_FACTS, playing: true, myTurn: true, ...over });

describe('the moment of each coach mark', () => {
  it('a newcomer meets draw, then land, then tap, then select, then attack, then the pile actions — one at a time', () => {
    const seen: CoachMarkId[] = [];
    let facts = f({ library: 60 });
    const steps: [Partial<CoachFacts>, CoachMarkId | null][] = [
      [{ library: 60, hand: 0 }, 'coachDraw'],
      [{ library: 53, hand: 7, handLands: 3 }, 'coachPlayLand'],
      [{ library: 53, hand: 6, handLands: 2, field: 1, fieldLands: 1 }, 'coachTap'],
      [{ library: 53, hand: 6, handLands: 2, field: 1, fieldLands: 1, fieldTapped: 1 }, 'coachSelect'],
      [{ library: 53, hand: 5, field: 2, fieldLands: 1, fieldTapped: 1, fieldCreaturesReady: 1, selected: 1 }, 'coachAttack'],
      [{ library: 53, hand: 5, field: 2, fieldLands: 1, fieldTapped: 2, attacking: 1 }, 'coachPileActions'],
      [{ library: 53, hand: 5, field: 2, fieldLands: 1, fieldTapped: 2, attacking: 1, pileActions: true }, null],
    ];
    for (const [over, expected] of steps) {
      const next = f(over);
      for (const id of TABLE_COACH_MARKS) if (!seen.includes(id) && coachDone(id, facts, next)) seen.push(id);
      facts = next;
      expect(nextCoach(seen, facts)).toBe(expected);
    }
    expect(seen).toEqual(['coachDraw', 'coachPlayLand', 'coachTap', 'coachSelect', 'coachAttack', 'coachPileActions']);
  });

  it('a mark whose action was done before it showed never shows', () => {
    const seen: CoachMarkId[] = [];
    const before = f({ library: 53, hand: 7, handLands: 3 });
    // The player dragged a land out before the mark could show, and tapped it.
    const after = f({ library: 53, hand: 6, handLands: 2, field: 1, fieldLands: 1, fieldTapped: 1 });
    for (const id of TABLE_COACH_MARKS) if (coachDone(id, before, after)) seen.push(id);
    expect(seen).toEqual(['coachPlayLand', 'coachTap']);
    expect(nextCoach(seen, after)).toBe('coachSelect');
  });

  it('nothing for a spectator or before the match; the land mark waits for the own turn', () => {
    expect(nextCoach([], { ...NO_FACTS, library: 60 })).toBeNull();
    expect(nextCoach(['coachDraw'], f({ myTurn: false, library: 53, hand: 7, handLands: 2 }))).not.toBe('coachPlayLand');
  });

  it('the HUD\'s own marks (life, next step, tilt) are never shown here', () => {
    expect(TABLE_COACH_MARKS).not.toContain('coachLife');
    expect(TABLE_COACH_MARKS).not.toContain('coachNextStep');
    expect(TABLE_COACH_MARKS).not.toContain('coachTilt');
    expect(TABLE_COACH_MARKS.every((id) => COACH_MARK_IDS.includes(id))).toBe(true);
  });
});

describe('texts teach gestures, never keys', () => {
  it('by mouse and by finger, without a key name', () => {
    const keyNames = new Set(MTG_KEYMAP.map((b) => b.chord.key.toUpperCase()).filter((k) => k.length === 1));
    for (const id of TABLE_COACH_MARKS) {
      for (const touch of [false, true]) {
        const t = coachText(id, touch).text;
        expect(t.length).toBeGreaterThan(10);
        expect(t.length).toBeLessThanOrEqual(90);
        expect(t).not.toMatch(/\b(press|key|Ctrl|Shift|Alt)\b/i);
        // No single capital letter standing alone (a key name such as "T" or "D").
        for (const w of t.split(/[\s,.:]+/)) if (w.length === 1) expect(keyNames.has(w)).toBe(false);
        if (touch) expect(t).not.toMatch(/\bclick\b/i);
      }
    }
    expect(coachText('coachDraw', false).text).toContain('Click your library');
    expect(coachText('coachDraw', true).text).toContain('Tap your library');
    expect(coachText('coachTap', true).text).toContain('Double-tap');
    expect(coachText('coachAttack', false).text).toContain('Drag a creature toward your opponent');
  });
});

describe('the facts', () => {
  it('count the own hand, lands, tapped cards, ready creatures and attackers from what this browser may know', () => {
    let s = ok(board(), act('stageSet', { stage: 'match' }));
    s = ok(s, act('tap', { card: 'a02', tapped: true }));
    s = ok(s, act('moveTemp', { card: 'a01', pose: { x: 0, y: -90, rot: 0 }, combat: 'attack', tap: true }));
    const data = (type: string) => ({ type_line: type }) as CardData;
    const facts = coachFacts(s, 's0', {
      identity: (c) => (c.id === 'a00' ? data('Basic Land — Forest') : data('Creature — Elf Druid')),
      selected: ['a00'],
      pileActions: false,
      spectator: false,
      myTurn: true,
    });
    expect(facts).toMatchObject({ playing: true, library: 3, hand: 0, field: 3, fieldLands: 1, fieldTapped: 2, fieldCreaturesReady: 0, attacking: 1, selected: 1 });
    expect(coachFacts(s, 's0', { identity: () => null, selected: [], pileActions: false, spectator: true, myTurn: true }).playing).toBe(false);
    // Before the match (the lobby, a draft, the builder) no coach mark has a moment.
    expect(coachFacts(board(), 's0', { identity: () => null, selected: [], pileActions: false, spectator: false, myTurn: true }).playing).toBe(false);
  });
});

describe('CoachController', () => {
  it('shows nothing until it read what was seen; a done mark is stored with the first-run hints and never shows again', async () => {
    const store = new MemorySettings({ hintsSeen: ['welcome'] });
    const c = new CoachController(store);
    const shown: (CoachMarkId | null)[] = [];
    c.subscribe((id) => shown.push(id));
    c.update(f({ library: 60 }));
    expect(c.current()).toBeNull();
    await c.load();
    expect(c.current()).toBe('coachDraw');
    c.update(f({ library: 59, hand: 1 }));
    expect(c.current()).toBeNull();
    await new Promise((r) => setTimeout(r, 0));
    expect(await store.get('hintsSeen')).toEqual(['welcome', 'coachDraw']);
    expect(c.done()).toEqual(['coachDraw']);
    const again = new CoachController(store);
    await again.load();
    again.update(f({ library: 60 }));
    expect(again.current()).toBeNull();
    expect(shown).toEqual(['coachDraw', null]);
  });

  it('a dismissed mark is done; the next whose moment came follows', async () => {
    const c = new CoachController(null);
    await c.load();
    c.update(f({ library: 53, hand: 7, handLands: 2, field: 1, fieldLands: 0 }));
    expect(c.current()).toBe('coachPlayLand');
    c.dismiss('coachPlayLand');
    expect(c.current()).toBe('coachTap');
    expect(c.done()).toEqual(['coachPlayLand']);
  });
});
