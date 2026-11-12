/**
 * M2-C contracts: the pure draft rules, the stage machine, lobby settings and the M2 slots of the state (DESIGN
 * "Pre-game: draft, sealed and deck building"; "Specification: card data, packs and draft formats", Draft formats,
 * pick timer, Evening stages). Package acceptance tests live with M2-P1..P7.
 */
import { describe, expect, it } from 'vitest';
import { createDraftState, draftDeadlines, draftersOf, passDirection, passTarget, pickTimerMs, rochesterOrder, setForPack } from '../../../src/core/drafting';
import { canMove, enterStage, hostSeat, lobbyOf, lobbyProblem, nextStage, STAGE_EDGES, STAGES, stageProblem } from '../../../src/core/stage';
import { canonicalJson } from '../../../src/core/hash';
import { DEFAULT_LOBBY_SETTINGS, type LobbySettings, type Stage } from '../../../src/core/types';
import { DRAFT_PRESETS } from '../../../src/draft/types';
import { FEATURED_SETS } from '../../../src/data/types';
import { act, fresh, no, ok } from './helpers';

describe('pick timer and pass direction', () => {
  it('45 s for the first pick, 3 s less per pick, 10 s floor', () => {
    expect(pickTimerMs(0)).toBe(45_000);
    expect(pickTimerMs(1)).toBe(42_000);
    expect(pickTimerMs(11)).toBe(12_000);
    expect(pickTimerMs(12)).toBe(10_000);
    expect(pickTimerMs(40)).toBe(10_000);
  });

  it('passes left, right, left; left is the next seat clockwise', () => {
    expect([0, 1, 2].map(passDirection)).toEqual(['left', 'right', 'left']);
    const d = ['s0', 's1', 's2', 's3'];
    expect(passTarget(d, 's0', 0)).toBe('s1');
    expect(passTarget(d, 's3', 0)).toBe('s0');
    expect(passTarget(d, 's0', 1)).toBe('s3');
    expect(passTarget(d, 's2', 2)).toBe('s3');
    expect(() => passTarget(d, 'x', 0)).toThrow();
  });

  it('picks the set per pack, repeating the last entry', () => {
    expect(setForPack(['M19', 'M20'], 0)).toBe('M19');
    expect(setForPack(['M19', 'M20'], 1)).toBe('M20');
    expect(setForPack(['M19', 'M20'], 5)).toBe('M20');
    expect(() => setForPack([], 0)).toThrow();
  });
});

describe('initial draft state', () => {
  it('is null for constructed and empty for a pass draft', () => {
    const s = fresh('1v1', 2);
    expect(createDraftState(s, { ...DEFAULT_LOBBY_SETTINGS, draft: null }, 3)).toBeNull();
    const d = createDraftState(s, DEFAULT_LOBBY_SETTINGS, 3)!;
    expect(d.drafters).toEqual(['s0', 's1']);
    expect(d.queues).toEqual({ s0: [], s1: [] });
    expect(d.pools).toEqual({ s0: 0, s1: 0 });
    expect(d).toMatchObject({ round: 0, packs: {}, startSeq: 3, done: false, sets: ['M19'], pickTimer: false });
    expect(d.rochester ?? d.winston ?? d.grid).toBeUndefined();
    // Plain JSON (hashable).
    expect(() => canonicalJson({ ...s, draft: d })).not.toThrow();
  });

  it('gives the open formats their sub-state, and teams draft as teams', () => {
    const s = fresh('1v1', 2);
    expect(createDraftState(s, { ...DEFAULT_LOBBY_SETTINGS, draft: DRAFT_PRESETS.rochester.settings }, 0)!.rochester).toEqual({ pack: null, opener: 's0', turn: 0, opened: 0 });
    expect(createDraftState(s, { ...DEFAULT_LOBBY_SETTINGS, draft: DRAFT_PRESETS.winston.settings }, 0)!.winston).toMatchObject({ piles: [0, 0, 0], active: 's0' });
    expect(createDraftState(s, { ...DEFAULT_LOBBY_SETTINGS, draft: DRAFT_PRESETS.grid.settings }, 0)!.grid).toMatchObject({ index: 0, first: 's0' });
    expect(draftersOf(fresh('2hg', 4), true)).toEqual(['t0', 't1']);
  });

  it('leaves the package stubs naming their package', () => {
    // rochesterOrder is M2-P3's (tests/unit/draft/open/rochester.test.ts).
    expect(rochesterOrder(['s0', 's1'], 's0')).toEqual(['s0', 's1', 's1', 's0']);
    expect(draftDeadlines(fresh())).toEqual([]);
  });
});

describe('stage machine', () => {
  it('follows the evening: lobby → draft → build → match → build …', () => {
    expect(nextStage('lobby', 'start')).toBe('draft');
    expect(nextStage('lobby', 'start', { ...DEFAULT_LOBBY_SETTINGS, draft: null })).toBe('match');
    expect(nextStage('draft', 'draftDone')).toBe('build');
    expect(nextStage('build', 'allReady')).toBe('match');
    expect(nextStage('match', 'nextGame')).toBe('build');
    expect(nextStage('match', 'newDraft')).toBe('lobby');
    expect(nextStage('build', 'newDraft')).toBe('lobby');
    expect(nextStage('lobby', 'newDraft')).toBeNull();
    expect(nextStage('build', 'draftDone')).toBeNull();
  });

  it('every event result is an edge', () => {
    for (const from of STAGES)
      for (const ev of ['start', 'draftDone', 'allReady', 'nextGame', 'newDraft'] as const) {
        const to = nextStage(from, ev);
        if (to !== null) expect(canMove(from, to), `${from} ${ev}`).toBe(true);
      }
    expect(Object.keys(STAGE_EDGES).sort()).toEqual([...STAGES].sort());
  });

  it('names the host and keeps the M1 stageSet behaviour until M2-P7', () => {
    const s = fresh();
    expect(hostSeat(s)).toBe('s0');
    expect(lobbyOf(s)).toBe(DEFAULT_LOBBY_SETTINGS);
    expect(stageProblem(s, act('stageSet', { stage: 'match' }))).toBeNull();
    expect(enterStage(s, 'match' as Stage, 1).stage).toBe('match');
  });
});

describe('lobby settings', () => {
  it('accepts the defaults and every preset', () => {
    expect(lobbyProblem(DEFAULT_LOBBY_SETTINGS)).toBeNull();
    for (const p of Object.values(DRAFT_PRESETS)) expect(lobbyProblem({ ...DEFAULT_LOBBY_SETTINGS, draft: p.settings }), p.id).toBeNull();
    expect(lobbyProblem({ ...DEFAULT_LOBBY_SETTINGS, draft: null })).toBeNull();
  });

  it('refuses malformed settings without throwing', () => {
    const bad: unknown[] = [
      null,
      [],
      { ...DEFAULT_LOBBY_SETTINGS, sets: [] },
      { ...DEFAULT_LOBBY_SETTINGS, sets: ['M 19'] },
      { ...DEFAULT_LOBBY_SETTINGS, pickTimer: 'no' },
      { ...DEFAULT_LOBBY_SETTINGS, extra: 1 },
      { ...DEFAULT_LOBBY_SETTINGS, draft: { format: 'pass', packs: 0, picks: 1 } },
      { ...DEFAULT_LOBBY_SETTINGS, draft: { format: 'pass', packs: 3, picks: 1.5 } },
      { ...DEFAULT_LOBBY_SETTINGS, draft: { format: 'rochester', packs: 3, burn: -1 } },
      { ...DEFAULT_LOBBY_SETTINGS, draft: { format: 'grid', grids: 3, packs: 2 } },
      { ...DEFAULT_LOBBY_SETTINGS, draft: { format: 'cube', packs: 3 } },
      { ...DEFAULT_LOBBY_SETTINGS, draft: { format: 'toString' } },
    ];
    for (const b of bad) expect(lobbyProblem(b), JSON.stringify(b)).not.toBeNull();
  });

  it('lobbySet: host only, lobby only, stored as given', () => {
    const s = fresh();
    const lobby: LobbySettings = { draft: { format: 'sealed', packs: 6 }, sets: ['M19', 'M20'], pickTimer: true };
    const next = ok(s, act('lobbySet', { lobby }));
    expect(next.lobby).toEqual(lobby);
    expect(next.lobby).not.toBe(lobby);
    no(s, act('lobbySet', { lobby }, 's1'), /host/);
    no(s, act('lobbySet', { lobby: { ...lobby, sets: [] } }), /sets/);
    const inMatch = ok(s, act('stageSet', { stage: 'match' }));
    no(inMatch, act('lobbySet', { lobby }), /lobby/);
  });

  it('a table without M2 slots hashes as before (no lobby, draft or games keys)', () => {
    const s = fresh();
    expect('lobby' in s || 'draft' in s || 'games' in s).toBe(false);
  });
});

describe('draft actions route to their packages', () => {
  it('pass formats to M2-P2, open formats to M2-P3', () => {
    const s = fresh();
    no(s, act('packOpen', { packId: 'p', commits: [], count: 0 }), /M2-P2/);
    no(s, act('draftTimeout', { packId: 'p', picks: 0 }), /M2-P2/);
    // The open-format reducers (M2-P3) refuse outside a draft of their format.
    no(s, act('pileLook', { pile: 0, take: true }), /no draft/);
    no(s, act('gridTake', { grid: 0, line: 'row', index: 0 }), /no draft/);
  });
});

describe('featured sets', () => {
  it('lists the ten target sets in the design order', () => {
    expect(FEATURED_SETS).toEqual(['M10', 'M11', 'M12', 'M13', 'M14', 'M15', 'ORI', 'M19', 'M20', 'M21']);
  });
});
