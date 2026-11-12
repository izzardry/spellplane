/**
 * The lobby settings panel's model (DESIGN "Pre-game: draft, sealed and deck building", Lobby settings and mode table;
 * "Specification: card data, packs and draft formats": Setup defaults, featured sets first, a different set per pack).
 * Every value the panel writes must pass the reducer's `lobbySet` (core/stage.ts lobbyProblem), and only the host in the
 * lobby may write.
 */
import { describe, expect, it } from 'vitest';
import { lobbyProblem, LOBBY_LIMITS } from '../../../../src/core/stage';
import { DEFAULT_LOBBY_SETTINGS, type LobbySettings } from '../../../../src/core/types';
import { FEATURED_SETS, type SetSummary } from '../../../../src/data/types';
import { LocalTable } from '../../../../src/ui/draft/fakes';
import {
  canonicalSets,
  fieldsOf,
  lobbyEditable,
  lobbyModes,
  mixedSets,
  modeOf,
  packCount,
  PASS_TIMER_CHOICES,
  passTimerChoices,
  seatHint,
  setOptions,
  setsPerPack,
  withMode,
  withNumber,
  withPackSet,
  withSet,
  type LobbyMode,
} from '../../../../src/ui/draft/settings';

const ALL_MODES: LobbyMode[] = ['booster', 'pickTwo', 'sealed', 'rochester', 'winston', 'grid', 'teamDraft', 'teamSealed', 'constructed'];

describe('modes and their defaults (DESIGN "Pre-game", mode table; "Specification: card data, packs and draft formats", Setup)', () => {
  it('each mode starts from the design defaults and keeps the chosen sets and pick timer', () => {
    const base: LobbySettings = { ...DEFAULT_LOBBY_SETTINGS, sets: ['M20'], pickTimer: true };
    expect(withMode(base, 'booster').draft).toEqual({ format: 'pass', packs: 3, picks: 1 });
    expect(withMode(base, 'pickTwo').draft).toEqual({ format: 'pass', packs: 3, picks: 2 });
    expect(withMode(base, 'sealed').draft).toEqual({ format: 'sealed', packs: 6 });
    expect(withMode(base, 'rochester').draft).toEqual({ format: 'rochester', packs: 3, burn: 0 });
    expect(withMode(base, 'winston').draft).toEqual({ format: 'winston', packs: 6 });
    expect(withMode(base, 'grid').draft).toEqual({ format: 'grid', grids: 18 });
    expect(withMode(base, 'constructed').draft).toBeNull();
    for (const m of ALL_MODES) {
      const l = withMode(base, m);
      expect(l.sets).toEqual(['M20']);
      expect(l.pickTimer).toBe(true);
      expect(lobbyProblem(l)).toBeNull();
      expect(modeOf(l.draft)).toBe(m);
    }
  });

  it('the defaults are a booster draft of three packs, pick one, pick timer off', () => {
    expect(modeOf(DEFAULT_LOBBY_SETTINGS.draft)).toBe('booster');
    expect(DEFAULT_LOBBY_SETTINGS.pickTimer).toBe(false);
  });

  it('a pass draft of 3 packs with 2 picks shows as the Pick-Two preset; other pass drafts as booster drafts', () => {
    expect(modeOf({ format: 'pass', packs: 3, picks: 2 })).toBe('pickTwo');
    expect(modeOf({ format: 'pass', packs: 4, picks: 2 })).toBe('booster');
    expect(modeOf({ format: 'pass', packs: 3, picks: 3 })).toBe('booster');
  });

  it('Two-Headed Giant modes are offered only at a Two-Headed Giant table', () => {
    expect(lobbyModes('1v1')).not.toContain('teamDraft');
    expect(lobbyModes('2hg')).toContain('teamDraft');
    expect(lobbyModes('2hg')).toContain('teamSealed');
    expect(lobbyModes('ffa4')).toContain('constructed');
  });

  it('each format shows its own number fields', () => {
    expect(fieldsOf({ format: 'pass', packs: 3, picks: 1 })).toEqual(['packs', 'picks']);
    expect(fieldsOf({ format: 'rochester', packs: 3, burn: 0 })).toEqual(['packs', 'burn']);
    expect(fieldsOf({ format: 'grid', grids: 18 })).toEqual(['grids']);
    expect(fieldsOf({ format: 'sealed', packs: 6 })).toEqual(['packs']);
    expect(fieldsOf(null)).toEqual([]);
  });
});

describe('numbers (packs per player, picks per pass, burn, grids)', () => {
  const booster = withMode(DEFAULT_LOBBY_SETTINGS, 'booster');
  it('are clamped to what lobbySet accepts and rounded', () => {
    expect(withNumber(booster, 'packs', 99).draft).toEqual({ format: 'pass', packs: LOBBY_LIMITS.packs, picks: 1 });
    expect(withNumber(booster, 'packs', 0).draft).toEqual({ format: 'pass', packs: 1, picks: 1 });
    expect(withNumber(booster, 'picks', 2.6).draft).toEqual({ format: 'pass', packs: 3, picks: 3 });
    expect(withNumber(withMode(booster, 'rochester'), 'burn', -4).draft).toEqual({ format: 'rochester', packs: 3, burn: 0 });
    expect(withNumber(withMode(booster, 'grid'), 'grids', 40).draft).toEqual({ format: 'grid', grids: LOBBY_LIMITS.grids });
    for (const [f, v] of [
      ['packs', 1e9],
      ['picks', -1],
      ['burn', 1e9],
      ['grids', 0],
    ] as const) {
      for (const m of ALL_MODES) expect(lobbyProblem(withNumber(withMode(booster, m), f, v))).toBeNull();
    }
  });

  it('a field the format lacks, or a non-number, leaves the settings as they are', () => {
    expect(withNumber(booster, 'burn', 3)).toBe(booster);
    expect(withNumber(booster, 'packs', Number.NaN)).toBe(booster);
    const constructed = withMode(booster, 'constructed');
    expect(withNumber(constructed, 'packs', 4)).toBe(constructed);
  });
});

describe('sets (DESIGN: a set per pack, a different set per pack allowed; the ten featured sets first)', () => {
  const booster: LobbySettings = { ...DEFAULT_LOBBY_SETTINGS, sets: ['M19'] };

  it('one set for every pack, or one per pack; a shorter list repeats its last entry', () => {
    expect(setsPerPack(booster)).toEqual(['M19', 'M19', 'M19']);
    const mixed = withPackSet(booster, 1, 'ORI');
    expect(mixed.sets).toEqual(['M19', 'ORI', 'M19']);
    expect(mixedSets(mixed)).toBe(true);
    expect(setsPerPack(mixed)).toEqual(['M19', 'ORI', 'M19']);
    const last = withPackSet(booster, 2, 'M21');
    expect(last.sets).toEqual(['M19', 'M19', 'M21']);
    // Pack 3 back to M19 collapses the list again.
    expect(withPackSet(last, 2, 'M19').sets).toEqual(['M19']);
    expect(withSet(mixed, 'M20').sets).toEqual(['M20']);
    expect(withPackSet(booster, 5, 'ORI')).toBe(booster);
    for (const l of [mixed, last]) expect(lobbyProblem(l)).toBeNull();
  });

  it('fewer packs drop the sets of packs that no longer exist', () => {
    const mixed = withPackSet(withPackSet(booster, 1, 'ORI'), 2, 'M21');
    expect(withNumber(mixed, 'packs', 2).sets).toEqual(['M19', 'ORI']);
    expect(withNumber(mixed, 'packs', 1).sets).toEqual(['M19']);
    expect(withMode(mixed, 'grid').sets).toEqual(['M19']);
  });

  it('canonical lists drop trailing repeats only', () => {
    expect(canonicalSets(['A', 'B', 'B', 'B'])).toEqual(['A', 'B']);
    expect(canonicalSets(['A', 'A', 'B'])).toEqual(['A', 'A', 'B']);
    expect(canonicalSets(['A'])).toEqual(['A']);
  });

  it('Grid has no per-pack sets; Winston counts the packs of its stack', () => {
    expect(packCount({ format: 'grid', grids: 18 })).toBeNull();
    expect(packCount({ format: 'winston', packs: 6 })).toBe(6);
    expect(packCount(null)).toBeNull();
  });

  it('the picker lists M10, M11, M12, M13, M14, M15, Magic Origins, M19, M20, M21 first, whatever order the source gives', () => {
    const src: SetSummary[] = [
      { code: 'DOM', name: 'Dominaria', releaseDate: '2018-04-27', featured: false },
      ...[...FEATURED_SETS].reverse().map((code) => ({ code, name: code, releaseDate: '', featured: true })),
      { code: 'KLD', name: 'Kaladesh', releaseDate: '2016-09-30', featured: false },
    ];
    const o = setOptions(src, ['M19']);
    expect(o.featured.map((s) => s.code)).toEqual(['M10', 'M11', 'M12', 'M13', 'M14', 'M15', 'ORI', 'M19', 'M20', 'M21']);
    expect(o.others.map((s) => s.code)).toEqual(['DOM', 'KLD']);
  });

  it('a chosen set the list lacks (loading, offline) stays selectable', () => {
    const o = setOptions([], ['M19', 'XYZ']);
    expect(o.featured).toEqual([]);
    expect(o.others.map((s) => s.code)).toEqual(['M19', 'XYZ']);
  });
});

describe('who edits (DESIGN "Specification: card data, packs and draft formats", Evening stages: the host advances from lobby)', () => {
  it('the host (lowest seated index) edits in the lobby; nobody edits outside it', () => {
    const t = new LocalTable(['Anna', 'Ben']);
    expect(lobbyEditable(t.state, 's0')).toBe(true);
    expect(lobbyEditable(t.state, 's1')).toBe(false);
    expect(lobbyEditable({ ...t.state, stage: 'draft' }, 's0')).toBe(false);
    const empty0 = { ...t.state, seats: { ...t.state.seats, s0: { ...t.state.seats.s0!, name: '' } } };
    expect(lobbyEditable(empty0, 's1')).toBe(true);
  });

  it('the panel’s writes round-trip through the reducer; a guest’s write is refused', () => {
    const t = new LocalTable(['Anna', 'Ben', 'Cleo']);
    const next = withPackSet(withNumber(withMode(DEFAULT_LOBBY_SETTINGS, 'pickTwo'), 'packs', 4), 3, 'M21');
    t.dispatch('s0', { type: 'lobbySet', lobby: next });
    expect(t.state.lobby).toEqual(next);
    expect(t.refused).toEqual([]);
    t.dispatch('s1', { type: 'lobbySet', lobby: withMode(next, 'sealed') });
    expect(t.state.lobby).toEqual(next);
    expect(t.refused[0]!.reason).toMatch(/host/);
  });

  it('every pass timer choice is a value the table accepts', () => {
    const t = new LocalTable(['Anna', 'Ben']);
    for (const ms of PASS_TIMER_CHOICES) {
      t.dispatch('s0', { type: 'settings', settings: { passTimerMs: ms } });
      expect(t.state.settings.passTimerMs).toBe(ms);
    }
    expect(t.refused).toEqual([]);
  });

  it('a pass timer outside the choices (set elsewhere) is offered too, in order, so the select never shows blank', () => {
    expect(passTimerChoices(5000)).toEqual(PASS_TIMER_CHOICES);
    expect(passTimerChoices(null)).toEqual(PASS_TIMER_CHOICES);
    expect(passTimerChoices(4000)).toEqual([null, 2000, 3000, 4000, 5000, 8000, 10000, 15000, 20000, 30000]);
    expect(passTimerChoices(25000)).toContain(25000);
  });

  it('a mode that does not suit the seated players says so plainly', () => {
    const three = new LocalTable(['Anna', 'Ben', 'Cleo']).state;
    expect(seatHint('winston', three)).toMatch(/Winston draft is for 2 players; 3 are seated/);
    expect(seatHint('pickTwo', three)).toMatch(/4 players/);
    expect(seatHint('booster', three)).toBeNull();
    expect(seatHint('constructed', three)).toBeNull();
  });
});
