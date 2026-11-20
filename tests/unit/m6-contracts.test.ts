// M6-C contracts: attach, carry and clips; hold-to-talk; table objects, dice, line labels and seat randomness; consent
// rounds; signalling strategies and pack records; printings and Commander/Companion; keyboard routes; line glow
// (PLAN Milestone 6 with its owner decisions; docs/gates/GAPS.md; DESIGN "Card manipulation", "Data model and
// protocol", "Chat and voice", "Specification: geometry, layout and motion").
import { describe, expect, it } from 'vitest';
import { ACTION_FAMILIES, ACTION_TYPES, isUndoable, type Action } from '../../src/core/actions';
import { carryGroup, clipGroup, clipsOf } from '../../src/core/clips';
import { CLIP, GEOMETRY, TUCK_RULE } from '../../src/core/geometry';
import { canonicalJson } from '../../src/core/hash';
import { DEFAULT_DIE_SIDES, DIE_SIDES, firstPlayerOf, seatPermutation } from '../../src/core/objects';
import { createTable, explain } from '../../src/core/reducer';
import { consentGiven } from '../../src/core/stage';
import type { Clip, TableState } from '../../src/core/types';
import { inverse } from '../../src/core/undo';
import { mtg } from '../../src/games/mtg/index';
import { MTG_KEYMAP, chordToString } from '../../src/games/mtg/keymap';
import { MTG_TABLE_OBJECTS } from '../../src/games/mtg/objects';
import { PROTOCOL_VERSION } from '../../src/net/messages';
import { SPECTATOR_ACTIONS } from '../../src/net/roles';
import { SIGNALLING_STRATEGIES } from '../../src/net/types';
import { HOLD_PRESS_TALK_MS } from '../../src/scene/types';
import { DEFAULT_SETTINGS } from '../../src/store/types';
import { MENU_KEYS, RESERVED_KEYS } from '../../src/ui/keymap';
import { FOCUS_KEYS } from '../../src/ui/a11y/index';
import { TALK_HOLD_ALONE_MS } from '../../src/voice/types';

const notImplemented = (pkg: string) => new RegExp(`not implemented: ${pkg}`);
const table = (): TableState => createTable({ game: mtg, format: '1v1', seats: [{ name: 'A', colour: 0 }, { name: 'B', colour: 1 }] });

const clip = (id: string, cards: string[]): Clip => ({ id, cards, anchor: { card: cards[0]!, x: 0, y: 30 }, by: 's0' });

describe('M6-P1 attach, carry and clips', () => {
  it('adds clipAdd and clipRemove as undoable card actions that spectators cannot send', () => {
    expect(ACTION_FAMILIES.clipAdd).toBe('card');
    expect(ACTION_FAMILIES.clipRemove).toBe('card');
    const add: Action = { type: 'clipAdd', by: 's0', cid: 'c1', clip: 'k1', cards: ['a', 'b'], anchor: { card: 'a', x: 0, y: 30 } };
    const remove: Action = { type: 'clipRemove', by: 's1', cid: 'c2', clip: 'k1' };
    expect(isUndoable(add)).toBe(true);
    expect(isUndoable(remove)).toBe(true);
    expect(SPECTATOR_ACTIONS).not.toContain('clipAdd');
    expect(JSON.parse(canonicalJson(add))).toEqual(add);
  });

  it('has the clip reducer of M6-P1 (no stub left): unknown cards and clips are refused for what they are', () => {
    const t = table();
    expect(explain(t, { type: 'clipAdd', by: 's0', cid: 'c1', clip: 'k1', cards: ['a', 'b'], anchor: { card: 'a', x: 0, y: 0 } })).toMatch(/unknown card a/);
    expect(explain(t, { type: 'clipRemove', by: 's0', cid: 'c2', clip: 'k1' })).toMatch(/unknown clip k1/);
    expect(inverse(t, { type: 'clipRemove', by: 's0', cid: 'c2', clip: 'k1' })).toBeNull();
  });

  it('keeps a table without clips free of the `clips` key, so tables saved before M6 hash as before', () => {
    expect(Object.keys(table())).not.toContain('clips');
    expect(canonicalJson(table())).not.toContain('clips');
  });

  it('finds the clips of a card and the chained group around it', () => {
    const t: TableState = { ...table(), clips: { k2: clip('k2', ['c', 'd']), k1: clip('k1', ['a', 'b']), k3: clip('k3', ['b', 'c']), k4: clip('k4', ['x', 'y']) } };
    expect(clipsOf(t, 'b').map((c) => c.id)).toEqual(['k1', 'k3']);
    expect(clipsOf(t, 'z')).toEqual([]);
    expect(clipGroup(t, 'a')).toEqual(['a', 'b', 'c', 'd']);
    expect(clipGroup(t, 'y')).toEqual(['x', 'y']);
    expect(clipGroup(table(), 'a')).toEqual(['a']);
  });

  it('carries nothing for an unknown card (M6-P1 implements the rule: tests/unit/attach)', () => {
    const t = table();
    expect(carryGroup(t, 'nope')).toEqual({ anchor: 'nope', cards: [], reason: {}, leavesPile: null, leavesHost: null });
  });

  it('fixes the clip and tuck constants of the owner decisions', () => {
    expect(CLIP).toMatchObject({ w: 12, h: 32, holdMs: 600, ringFromMs: 200, minCards: 2 });
    expect(CLIP.ringFromMs).toBeLessThan(CLIP.holdMs);
    expect(TUCK_RULE).toEqual({ band: 1 / 3, minOverlap: 0.5 });
    expect(GEOMETRY.attachTuck).toEqual({ x: 10, y: 10 });
  });
});

describe('M6-P2 hold-to-talk', () => {
  it('adds the setting, off by default, and the 200 ms press threshold', () => {
    expect(DEFAULT_SETTINGS.talkWhileHolding).toBe(false);
    expect(HOLD_PRESS_TALK_MS).toBe(200);
    expect(HOLD_PRESS_TALK_MS).toBe(TALK_HOLD_ALONE_MS);
  });
});

describe('M6-P3 table objects, dice, labels and seat randomness', () => {
  it('offers dice of any size, d6 by default', () => {
    expect(DIE_SIDES).toEqual([4, 6, 8, 10, 12, 20, 100]);
    expect(DEFAULT_DIE_SIDES).toBe(6);
    expect(DEFAULT_SETTINGS.dieSides).toBe(DEFAULT_DIE_SIDES);
  });

  it('adds lineLabel (undoable, lines family) and rngApply (randomness, not undoable), refused until M6-P3', () => {
    expect(ACTION_FAMILIES.lineLabel).toBe('lines');
    expect(ACTION_FAMILIES.rngApply).toBe('randomness');
    const label: Action = { type: 'lineLabel', by: 's0', cid: 'c1', line: 'l1', label: 'lifelink' };
    const apply: Action = { type: 'rngApply', by: 's0', cid: 'c2', rid: 'r1' };
    expect(isUndoable(label)).toBe(true);
    expect(isUndoable(apply)).toBe(false);
    expect(explain(table(), label)).toMatch(notImplemented('M6-P3'));
    expect(explain(table(), apply)).toMatch(notImplemented('M6-P3'));
  });

  it('numbers every seat permutation once', () => {
    for (const k of [1, 2, 3, 4]) {
      const n = [1, 1, 2, 6, 24][k]!;
      const seen = new Set<string>();
      for (let i = 0; i < n; i++) {
        const p = seatPermutation(i, k);
        expect([...p].sort()).toEqual(Array.from({ length: k }, (_, j) => j));
        seen.add(p.join(','));
      }
      expect(seen.size).toBe(n);
      expect(seatPermutation(n, k)).toEqual(seatPermutation(0, k));
    }
    expect(seatPermutation(0, 3)).toEqual([0, 1, 2]);
    expect(seatPermutation(5, 3)).toEqual([2, 1, 0]);
  });

  it('reads the first player from a finished round over the seated seats', () => {
    const t = table();
    const round = { id: 'r1', purpose: 'firstPlayer' as const, n: 2, by: 's0', startSeq: 1, commits: {}, reveals: {}, result: 1 };
    expect(firstPlayerOf({ ...t, rng: { r1: round } }, 'r1')).toBe('s1');
    expect(firstPlayerOf({ ...t, rng: { r1: { ...round, result: null } } }, 'r1')).toBeNull();
    expect(firstPlayerOf({ ...t, rng: { r1: { ...round, purpose: 'die' } } }, 'r1')).toBeNull();
    expect(firstPlayerOf(t, 'toString')).toBeNull();
  });

  it('names Magic table objects without card data', () => {
    expect(MTG_TABLE_OBJECTS.map((o) => o.label)).toContain('Monarch');
    expect(MTG_TABLE_OBJECTS.every((o) => o.kind === 'counter')).toBe(true);
    expect(mtg.tableObjects).toBe(MTG_TABLE_OBJECTS);
  });
});

describe('M6-P4 integrity and connectivity', () => {
  it('signals over Nostr first, BitTorrent trackers second', () => {
    expect(SIGNALLING_STRATEGIES).toEqual(['nostr', 'torrent']);
  });
  it('stubs consent as not given, so no stage change relies on it before M6-P4', () => {
    expect(consentGiven(table())).toBe(false);
  });
});

describe('M6-P6 keyboard routes', () => {
  const chosen: [string, string, string][] = [
    ['table', 'Shift+M', 'place'],
    ['table', 'O', 'attach'],
    ['table', 'Shift+P', 'clip'],
    ['table', 'Shift+W', 'hide'],
    ['table', 'Shift+C', 'toCommand'],
    ['table', 'Shift+E', 'exileFaceDown'],
    ['table', 'Alt+M', 'tempMove'],
    ['table', 'Alt+L', 'line'],
    ['table', 'Alt+Shift+L', 'mark'],
    ['table', 'Shift+N', 'stickyNote'],
    ['table', 'Shift+X', 'counterObject'],
  ];

  it('binds every new action to the chosen key', () => {
    for (const [context, chord, action] of chosen) {
      const b = MTG_KEYMAP.filter((x) => x.action === action);
      expect(b.map((x) => [x.context, chordToString(x.chord)]), action).toEqual([[context, chord]]);
    }
  });

  it('collides with no other binding, reserved key, menu key or focus key', () => {
    const seen = new Map<string, string>();
    for (const b of MTG_KEYMAP) {
      const key = `${b.context}|${chordToString(b.chord)}`;
      expect(seen.get(key), `${key}: ${seen.get(key)} and ${b.action}`).toBeUndefined();
      seen.set(key, b.action);
    }
    const others = [...RESERVED_KEYS.map((r) => r.chord), ...MENU_KEYS, ...Object.values(FOCUS_KEYS).map((key) => ({ key }))].map((c) => `table|${chordToString(c)}`);
    for (const [context, chord] of chosen) expect(others).not.toContain(`${context}|${chord}`);
  });
});

describe('M6 protocol', () => {
  it('speaks protocol 3: an M5 reducer refuses the new actions', () => {
    // M8-C bumped it to 4 (contracts.md Part D); 3 was M6's.
    expect(PROTOCOL_VERSION).toBeGreaterThanOrEqual(3);
    for (const t of ['clipAdd', 'clipRemove', 'lineLabel', 'rngApply']) expect(ACTION_TYPES).toContain(t);
  });
});
