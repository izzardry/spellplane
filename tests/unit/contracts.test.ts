import { describe, expect, it } from 'vitest';
import { ACTION_FAMILIES, ACTION_TYPES, isUndoable, type Action, type ActionType } from '../../src/core/actions';
import { canonicalJson, stateHash } from '../../src/core/hash';
import { parseZoneId, zoneId } from '../../src/core/ids';
import { DEFAULT_TABLE_SETTINGS, type TableState } from '../../src/core/types';
import { MTG_KEYMAP, chordToString } from '../../src/games/mtg/keymap';
import { tokensToCssVars } from '../../src/themes/index';
import { paper } from '../../src/themes/paper/index';
import { openDb, STORE_NAMES } from '../../src/store/db';
import { tierForScreenHeight } from '../../src/data/types';

function table(): TableState {
  return {
    seq: 3,
    game: 'mtg',
    format: '1v1',
    stage: 'match',
    seats: {
      s0: { id: 's0', index: 0, name: 'Anna', colour: 0, life: 20, counters: {}, ready: true, autoPass: false },
    },
    teams: {},
    cards: {
      c1: { id: 'c1', owner: 's0', controller: 's0', zone: 'battlefield:s0', identity: { sid: 'abc' }, face: 'up', faceIndex: 0, tapped: false, pose: { x: 0, y: -200, rot: 0 }, counters: {} },
    },
    zones: {
      'battlefield:s0': { id: 'battlefield:s0', kind: 'battlefield', owner: 's0', visibility: 'public', ids: ['c1'] },
      'library:s0': { id: 'library:s0', kind: 'library', owner: 's0', visibility: 'nobody', count: 0, ids: [] },
    },
    stack: [],
    lines: {},
    turn: { number: 1, active: 's0', phase: 'main1' },
    confirm: null,
    commitments: {},
    rng: {},
    shuffles: {},
    settings: { ...DEFAULT_TABLE_SETTINGS },
  };
}

/** Reverse key insertion order recursively, to prove hashing ignores it. */
function reversed(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(reversed);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).reverse().map(([k, x]) => [k, reversed(x)]));
  return v;
}

describe('canonicalJson', () => {
  it('sorts keys at every depth and keeps array order', () => {
    expect(canonicalJson({ b: 1, a: { d: [3, { f: 1, e: 2 }], c: 'x' } })).toBe('{"a":{"c":"x","d":[3,{"e":2,"f":1}]},"b":1}');
  });
  it('drops undefined properties like JSON.stringify and writes null in arrays', () => {
    expect(canonicalJson({ a: undefined, b: null, c: [undefined] })).toBe('{"b":null,"c":[null]}');
    expect(canonicalJson({ a: 1 })).toBe(canonicalJson({ a: 1, b: undefined }));
  });
  it('rejects values that are not plain JSON', () => {
    expect(() => canonicalJson({ m: new Map() })).toThrow(/plain object/);
    expect(() => canonicalJson({ n: Number.NaN })).toThrow(/non-finite/);
    expect(() => canonicalJson({ f: () => 1 })).toThrow(/unsupported/);
  });
});

describe('stateHash', () => {
  it('is stable across key order and copies, and changes with content', async () => {
    const a = table();
    const h = await stateHash(a);
    expect(h).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(await stateHash(reversed(a) as TableState)).toBe(h);
    expect(await stateHash(structuredClone(a))).toBe(h);
    const b = table();
    b.cards.c1!.tapped = true;
    expect(await stateHash(b)).not.toBe(h);
  });
});

describe('zone ids', () => {
  it('round-trip', () => {
    expect(zoneId('library', 's1')).toBe('library:s1');
    expect(zoneId('stack')).toBe('stack');
    expect(parseZoneId('library:s1')).toEqual({ kind: 'library', seat: 's1' });
    expect(parseZoneId('stack')).toEqual({ kind: 'stack', seat: null });
  });
});

describe('actions', () => {
  // A typed record: adding an Action type without listing it here fails to compile.
  const ALL: Record<ActionType, true> = {
    move: true, moveTemp: true, settle: true, tap: true, flip: true, transform: true, rotate: true, counter: true, note: true,
    attach: true, detach: true, pile: true, tidy: true, createToken: true, copy: true, remove: true,
    toZone: true, draw: true, reveal: true, revealTo: true, hide: true, shuffleCommit: true, shuffleNonce: true, shuffleDone: true,
    reorder: true, lookAt: true, mulligan: true,
    stackPush: true, stackNote: true, stackResolve: true, stackCounter: true, stackReorder: true,
    lineAdd: true, lineRemove: true, ping: true,
    phaseSet: true, turnPass: true, ask: true, respond: true, autoPass: true,
    life: true, playerCounter: true, seatTake: true, seatLeave: true, ready: true, away: true,
    rngCommit: true, rngReveal: true, commitClose: true,
    packOpen: true, pick: true, packPass: true, pileLook: true, gridTake: true, draftTimeout: true,
    chat: true, caption: true,
    undo: true, snapshotHash: true, sequencerClaim: true, settings: true, stageSet: true, lobbySet: true, formatSet: true,
    recover: true, recoverCommit: true,
    auditPublish: true,
  };

  it('ACTION_FAMILIES covers every action type exactly', () => {
    expect([...ACTION_TYPES].sort()).toEqual(Object.keys(ALL).sort());
  });

  it('includes every action of the design table in its family', () => {
    const design: Record<string, string[]> = {
      card: ['move', 'moveTemp', 'settle', 'tap', 'flip', 'transform', 'rotate', 'counter', 'note', 'attach', 'detach', 'pile', 'tidy', 'createToken', 'copy', 'remove'],
      zone: ['toZone', 'draw', 'reveal', 'revealTo', 'hide', 'shuffleCommit', 'lookAt', 'mulligan', 'shuffleNonce', 'shuffleDone', 'reorder'],
      stack: ['stackPush', 'stackNote', 'stackResolve', 'stackCounter', 'stackReorder'],
      lines: ['lineAdd', 'lineRemove', 'ping'],
      turn: ['phaseSet', 'turnPass', 'ask', 'respond', 'autoPass'],
      players: ['life', 'playerCounter', 'seatTake', 'seatLeave', 'ready'],
      randomness: ['rngCommit', 'rngReveal'],
      draft: ['packOpen', 'pick', 'packPass', 'pileLook', 'gridTake'],
      social: ['chat', 'caption'],
      meta: ['undo', 'snapshotHash', 'sequencerClaim'],
    };
    for (const [family, types] of Object.entries(design)) {
      for (const t of types) expect(ACTION_FAMILIES[t as ActionType], t).toBe(family);
    }
  });

  it('marks shuffles, reveals, dice and coins as not undoable', () => {
    const base = { by: 's0', cid: 'c' };
    const no: Action[] = [
      { ...base, type: 'shuffleCommit', sid: 'x', zone: 'library:s0', h: 'h' },
      { ...base, type: 'shuffleDone', sid: 'x', orderHash: 'h' },
      { ...base, type: 'reveal', instanceId: 'c1', ref: { sid: 'a' }, salt: 's' },
      { ...base, type: 'revealTo', instanceId: 'c1', seats: ['s1'] },
      { ...base, type: 'rngCommit', rid: 'r', purpose: 'die', n: 6, h: 'h' },
      { ...base, type: 'rngReveal', rid: 'r', nonce: 'n' },
      { ...base, type: 'flip', card: 'c1', face: 'up', ref: { sid: 'a' }, salt: 's' },
    ];
    for (const a of no) expect(isUndoable(a), a.type).toBe(false);
    const yes: Action[] = [
      { ...base, type: 'tap', card: 'c1', tapped: true },
      { ...base, type: 'draw', instanceId: 'c9' },
      { ...base, type: 'move', card: 'c1', to: 'graveyard:s0' },
      { ...base, type: 'flip', card: 'c1', face: 'down' },
    ];
    for (const a of yes) expect(isUndoable(a), a.type).toBe(true);
  });
});

describe('MTG keymap', () => {
  it('has no duplicate chord within a context', () => {
    const seen = new Map<string, string>();
    for (const b of MTG_KEYMAP) {
      const key = `${b.context}|${chordToString(b.chord)}`;
      expect(seen.get(key), `${key} bound to ${seen.get(key)} and ${b.action}`).toBeUndefined();
      seen.set(key, b.action);
    }
  });

  it('covers every key of the canonical table (DESIGN "Input and interaction design")', () => {
    // [context, chord, action]
    const canonical: [string, string, string][] = [
      ['table', 'T', 'tap'], ['table', 'F', 'flip'], ['table', 'Shift+F', 'transform'], ['table', 'Shift+T', 'rotate180'],
      ['table', '+', 'counterAdd'], ['table', '-', 'counterRemove'], ['table', 'N', 'note'], ['table', 'X', 'copy'],
      ['table', 'W', 'revealTo'], ['table', 'Alt+F', 'peek'], ['table', 'I', 'ping'], ['table', 'Z', 'zoomTo'], ['table', 'Space', 'inspect'],
      ['table', 'G', 'toGraveyard'], ['table', 'E', 'toExile'], ['table', 'H', 'toHand'], ['table', 'L', 'toLibraryTop'],
      ['table', 'Shift+L', 'toLibraryBottom'], ['table', 'C', 'cast'],
      ['table', 'D', 'draw'], ['table', 'Shift+D', 'drawN'], ['table', 'S', 'shuffle'], ['table', 'Ctrl+M', 'mulligan'],
      ['table', 'A', 'attack'], ['table', 'Shift+A', 'attackNoTap'], ['table', 'B', 'settle'],
      ['table', 'Q', 'ability'], ['table', 'R', 'resolve'], ['table', 'Shift+R', 'counterTop'],
      ['table', 'Tab', 'nextPhase'], ['table', 'Ctrl+Enter', 'nextTurn'], ['table', 'Ctrl+U', 'untapAll'], ['table', 'F6', 'autoPass'],
      ['table', 'K', 'ask'], ['prompt', 'Enter', 'confirmOk'], ['prompt', 'Escape', 'confirmHold'], ['prompt', 'H', 'confirmHold'],
      ['table', 'Y', 'tidy'], ['table', 'Ctrl+T', 'token'], ['table', 'Ctrl+I', 'rollDie'], ['table', 'Ctrl+Shift+I', 'flipCoin'], ['table', 'Ctrl+Z', 'undo'],
      ['table', 'V', 'talk'], ['table', 'Shift+V', 'teamTalk'], ['table', 'M', 'mute'], ['table', 'Enter', 'focusChat'],
      ['table', 'P', 'perspective'], ['table', '0', 'fitTable'], ['table', '1', 'seat1'], ['table', '2', 'seat2'], ['table', '3', 'seat3'],
      ['table', '4', 'seat4'], ['table', 'Home', 'ownSide'], ['table', '?', 'help'],
    ];
    const bound = new Map(MTG_KEYMAP.map((b) => [`${b.context}|${chordToString(b.chord)}`, b.action]));
    for (const [ctx, chord, action] of canonical) expect(bound.get(`${ctx}|${chord}`), `${ctx} ${chord}`).toBe(action);
    expect(MTG_KEYMAP.find((b) => b.action === 'inspect')?.trigger).toBe('hold');
    expect(MTG_KEYMAP.find((b) => b.action === 'talk')?.trigger).toBe('hold');
  });
});

describe('themes, data, store contracts', () => {
  it('maps Paper tokens to CSS variables', () => {
    const vars = tokensToCssVars(paper.tokens);
    expect(vars['--sp-bg']).toBe('#ffffff');
    expect(vars['--sp-fg']).toBe('#111111');
    for (let i = 0; i < 8; i++) expect(vars[`--sp-seat-${i}`]).toMatch(/^#/);
    expect(vars['--sp-radius-md']).toBe('4px');
    expect(paper.tokens.colours.seats).toHaveLength(8);
    expect(new Set(paper.tokens.colours.seats.map((s) => s.pattern)).size).toBe(8);
  });

  it('picks texture tiers by on-screen height', () => {
    expect(tierForScreenHeight(100)).toBe('small');
    expect(tierForScreenHeight(160)).toBe('normal');
    expect(tierForScreenHeight(560)).toBe('normal');
    expect(tierForScreenHeight(561)).toBe('large');
    expect(tierForScreenHeight(50, true)).toBe('large');
  });

  it('creates every store of schema v1', async () => {
    const db = await openDb('contracts-test');
    expect([...db.objectStoreNames].sort()).toEqual([...STORE_NAMES].sort());
    await db.put('log', { roomId: 'r', seq: 1, action: { type: 'tap', by: 's0', cid: 'a', card: 'c1', tapped: true }, at: 0 });
    expect((await db.get('log', ['r', 1]))?.seq).toBe(1);
    db.close();
  });
});
