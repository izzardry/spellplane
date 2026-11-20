/**
 * M8-P2: Home's pure view for every row of the primary-button table (journey.md 4.1; contracts.md Part G "Matchmaking"
 * items 4 and 5), the nickname, BoosterSetup <-> LobbySettings, and each launcher against fake dependencies.
 */
import { describe, expect, it, vi } from 'vitest';
import type { MatchmakerStatus, Matchmaker } from '../../../src/session/types';
import { DEFAULT_HOME_PREFS, type BoosterSetup, type DeckRecord, type GameStore, type HomePrefs, type SettingsStore, type DeckStore } from '../../../src/store/types';
import { boosterToLobby, COPY, heroPacks, homeView, lobbyToBooster, queuedSetup, queuesFor, stepDeck, type HomeMatchmaking } from '../../../src/ui/home/view';
import { NICK_FIRST, NICK_SECOND, randomNickname } from '../../../src/ui/lobby/names';
import { FirstRunError, launchDraft, launchFirstRun, launchPrivate, launchQuick, launchSolo, makeStarterDeck, SPARRING_FALLBACK, takePendingSetup, type LaunchDeps } from '../../../src/ui/play/launch';

const deck = (id: string, cards: number, extra: Partial<DeckRecord> = {}): DeckRecord => ({
  id,
  name: `Deck ${id}`,
  main: Array.from({ length: cards }, (_, i) => ({ sid: `${id}-${i}` })),
  side: [],
  source: 'built',
  createdAt: 1,
  updatedAt: 1,
  kind: 'custom',
  ...extra,
});
const prefs = (p: Partial<HomePrefs> = {}): HomePrefs => ({ ...DEFAULT_HOME_PREFS, ...p });
const off: HomeMatchmaking = { available: true, status: { phase: 'off' } };
const lobby = { shard: 0, nat: 'open', seekers: [], byQueue: { '1v1.constructed.casual': 1 }, unreachable: 0, otherVersion: 0, full: false } as unknown as Extract<MatchmakerStatus, { phase: 'seeking' }>['lobby'];

describe('homeView: the primary button table', () => {
  it('ready: the label per mode, never RESUME', () => {
    const d = [deck('a', 60)];
    for (const [mode, label] of [['solo', 'PLAY'], ['quick', 'FIND MATCH'], ['private', 'CREATE TABLE'], ['draft', 'OPEN DRAFT TABLE']] as const) {
      const v = homeView(prefs({ mode, deckId: 'a' }), d, true, true, { ...off, searched: true });
      expect(v.primary).toMatchObject({ label, disabled: false, waiting: false });
    }
  });

  it('no deck in Solo: PLAY with the starter line; other modes disabled with the links', () => {
    const v = homeView(prefs(), [], true, true, off);
    expect(v).toMatchObject({ hero: 'empty', primary: { label: 'PLAY', disabled: false, action: 'firstRun' }, line: COPY.noDeckSolo });
    const q = homeView(prefs({ mode: 'private' }), [], true, true, off);
    expect(q).toMatchObject({ primary: { label: 'CREATE TABLE', disabled: true }, line: COPY.noDeck, links: ['starter', 'boosters'] });
    // Draft night needs no deck.
    expect(homeView(prefs({ mode: 'draft' }), [], true, true, off)).toMatchObject({ hero: 'boosters', primary: { disabled: false } });
  });

  it('an empty deck disables; a short deck warns unranked and blocks ranked', () => {
    expect(homeView(prefs({ deckId: 'e' }), [deck('e', 0)], true, true, off)).toMatchObject({ primary: { disabled: true }, line: COPY.empty });
    const short = [deck('s', 38)];
    expect(homeView(prefs({ mode: 'private', deckId: 's' }), short, true, true, off)).toMatchObject({ primary: { disabled: false }, line: '38 cards. Most decks have 40 or more.' });
    const ranked = prefs({ mode: 'quick', deckId: 's', quick: { format: '1v1', ranked: true } });
    expect(homeView(ranked, short, true, true, off)).toMatchObject({ primary: { disabled: true }, line: COPY.rankedSize });
    // A booster deck needs 40, a custom one 60.
    expect(homeView(ranked, [deck('s', 40, { kind: 'sealed' })], true, true, off).primary.disabled).toBe(false);
    expect(homeView(ranked, [deck('s', 40)], true, true, off).primary.disabled).toBe(true);
  });

  it('the honesty lines: before the first search, and with RANKED; ranked is 1v1 only', () => {
    const d = [deck('a', 60)];
    expect(homeView(prefs({ mode: 'quick', deckId: 'a' }), d, true, true, off).line).toBe(COPY.firstSearch);
    expect(COPY.firstSearch).toBe('Connects your browser directly to other players who are looking. They see your name and network address.');
    const r = homeView(prefs({ mode: 'quick', deckId: 'a', quick: { format: '1v1', ranked: true } }), d, true, true, { ...off, searched: true });
    expect(r).toMatchObject({ ranked: true, line: 'Ranked counts only when the loser concedes.' });
    const f = homeView(prefs({ mode: 'quick', deckId: 'a', quick: { format: 'ffa4', ranked: true } }), d, true, true, off);
    expect(f).toMatchObject({ ranked: false, line: COPY.rankedOnly1v1 });
    expect(queuesFor({ format: 'ffa4', ranked: true }, 'custom', false)).toEqual(['ffa4.constructed.casual']);
    expect(queuesFor({ format: '1v1', ranked: true }, 'sealed', true)).toEqual(['1v1.limited.ranked', '1v1.limited.casual']);
  });

  it('offline, storage blocked, no matchmaking in this build', () => {
    const d = [deck('a', 60)];
    expect(homeView(prefs({ mode: 'private', deckId: 'a' }), d, false, true, off)).toMatchObject({ primary: { label: 'OFFLINE', disabled: true }, line: COPY.offline });
    expect(homeView(prefs({ deckId: 'a' }), d, false, true, off).primary.disabled).toBe(false);
    expect(homeView(prefs({ deckId: 'a' }), d, true, false, off)).toMatchObject({ primary: { label: 'PLAY', disabled: false }, line: COPY.storage });
    expect(homeView(prefs({ mode: 'quick', deckId: 'a' }), d, true, false, off).primary.disabled).toBe(true);
    expect(homeView(prefs({ mode: 'quick', deckId: 'a' }), d, true, true, { available: false, status: { phase: 'off' } })).toMatchObject({
      primary: { label: 'FIND MATCH', disabled: true },
      line: 'Matchmaking is not in this build yet.',
    });
  });

  it('searching: pressed in with the timer, cancel, locked options and a locked deck (the queued one)', () => {
    const d = [deck('a', 60, { updatedAt: 5 }), deck('b', 60, { updatedAt: 9 })];
    const status: MatchmakerStatus = { phase: 'seeking', lobby, since: 1234, window: { rating: null, band: null }, alone: false, deckId: 'a', queues: ['1v1.constructed.casual'] };
    const v = homeView(prefs({ mode: 'solo', deckId: 'b' }), d, true, true, { available: true, status });
    expect(v).toMatchObject({ mode: 'quick', primary: { label: 'SEARCHING', waiting: true }, cancel: true, deckLocked: true, optionsLocked: true, since: 1234, deck: { id: 'a' } });
    expect(v.line).toBe('1 LOOKING NOW · 1 IN YOUR QUEUE');
    expect(homeView(prefs(), d, true, true, { available: true, status: { ...status, alone: true } }).line).toBe(COPY.alone);
    expect(homeView(prefs(), d, true, true, { available: true, status: { phase: 'connecting' } })).toMatchObject({ primary: { label: 'CONNECTING…', waiting: true }, deckLocked: true });
    expect(homeView(prefs(), d, true, true, { available: true, status: { phase: 'failed', problem: 'otherTab', text: 'x' } })).toMatchObject({ useHere: true, primary: { label: COPY.otherTab } });
  });

  it('the selected deck falls back to the most recently used; arrows step by last use and stop at the ends', () => {
    const d = [deck('old', 60, { updatedAt: 1 }), deck('new', 60, { updatedAt: 3 }), deck('mid', 60, { lastPlayedAt: 2, updatedAt: 0 })];
    const v = homeView(prefs({ deckId: 'gone' }), d, true, true, off);
    expect(v).toMatchObject({ deck: { id: 'new' }, deckIndex: 0, deckCount: 3 });
    expect(stepDeck(d, 'new', 1)?.id).toBe('mid');
    expect(stepDeck(d, 'old', 1)?.id).toBe('old');
    expect(stepDeck(d, 'new', -1)?.id).toBe('new');
  });

  it('without a computer SOLO plays ALONE', () => {
    expect(homeView(prefs(), [], true, true, off, { computer: false }).opponent).toBe('alone');
    expect(homeView(prefs(), [], true, true, off, { computer: true }).opponent).toBe('sparring');
  });
});

describe('queuedSetup', () => {
  it('names the queued setup as text', () => {
    expect(queuedSetup(['1v1.constructed.casual'])).toBe('QUICK MATCH · 1V1 · UNRANKED');
    expect(queuedSetup(['1v1.limited.ranked', '1v1.limited.casual'])).toBe('QUICK MATCH · 1V1 · RANKED');
    expect(queuedSetup(['ffa4.constructed.casual'])).toBe('QUICK MATCH · 4 FFA · UNRANKED');
    expect(queuedSetup([])).toBe('QUICK MATCH');
  });
});

describe('randomNickname', () => {
  it('two capitalised words from the lists, deterministic for a source', () => {
    expect(randomNickname(() => 0)).toBe(`${NICK_FIRST[0]} ${NICK_SECOND[0]}`);
    expect(randomNickname(() => 0.999999)).toBe(`${NICK_FIRST.at(-1)} ${NICK_SECOND.at(-1)}`);
    for (let i = 0; i < 50; i++) expect(randomNickname()).toMatch(/^[A-Z][a-z]+ [A-Z][a-z]+$/);
    expect(Math.max(...NICK_FIRST.map((a) => a.length)) + 1 + Math.max(...NICK_SECOND.map((a) => a.length))).toBeLessThanOrEqual(24);
  });
});

describe('BoosterSetup <-> LobbySettings', () => {
  it('round-trips every kind', () => {
    const setups: BoosterSetup[] = [
      { how: 'pass', packs: 3, picks: 1, sets: ['M19'], pickTimer: true },
      { how: 'pass', packs: 3, picks: 2, sets: ['M19', 'DOM'], pickTimer: false },
      { how: 'sealed', packs: 6, picks: 1, sets: ['M19'], pickTimer: false },
      { how: 'rochester', packs: 3, picks: 1, sets: ['M19'], pickTimer: false },
      { how: 'winston', packs: 6, picks: 1, sets: ['M19'], pickTimer: false },
      { how: 'grid', packs: 18, picks: 1, sets: ['M19'], pickTimer: true },
    ];
    for (const b of setups) expect(lobbyToBooster(boosterToLobby(b))).toEqual(b);
    expect(boosterToLobby(setups[0]!)).toEqual({ draft: { format: 'pass', packs: 3, picks: 1 }, sets: ['M19'], pickTimer: true });
    expect(heroPacks(setups[0]!)).toEqual(['M19', 'M19', 'M19']);
  });
});

function fakeDeps(over: Partial<LaunchDeps> = {}): LaunchDeps & { calls: string[]; store: Map<string, string> } {
  const calls: string[] = [];
  const store = new Map<string, string>();
  const games: GameStore = {
    create: vi.fn(async (m) => void calls.push(`create:${m.kind}:${m.code}`)),
    put: vi.fn(async () => undefined),
    get: vi.fn(async () => null),
    list: vi.fn(async () => []),
    remove: vi.fn(async () => undefined),
    restore: vi.fn(async () => undefined),
    purge: vi.fn(async () => undefined),
    endOlderSolo: vi.fn(async (n: number) => void calls.push(`endOlderSolo:${n}`)),
  };
  const decks: DeckStore = { list: vi.fn(async () => []), get: vi.fn(async () => null), put: vi.fn(async (d: DeckRecord) => void calls.push(`deck:${d.id}`)), delete: vi.fn(async () => undefined) };
  const settings = { get: vi.fn(async () => []), set: vi.fn(async (k: string) => void calls.push(`set:${k}`)), all: vi.fn() } as unknown as SettingsStore;
  return {
    calls,
    store,
    games,
    decks,
    settings,
    go: (h) => void calls.push(`go:${h}`),
    toast: (t) => void calls.push(`toast:${t}`),
    now: () => 1000,
    newRoom: () => ({ roomId: 'amber-fox-river-12', roomKey: 'K'.repeat(22) }),
    newPracticeId: () => 'p-abc',
    pending: { setItem: (k: string, v: string) => void store.set(k, v) },
    ...over,
  };
}

describe('launchers', () => {
  it('SOLO ALONE: a solo summary, endOlderSolo(3), then the practice route', async () => {
    const deps = fakeDeps();
    expect(await launchSolo(deps, prefs({ solo: { opponent: 'alone' } }), deck('a', 60))).toBe('#/p/p-abc');
    const i = deps.calls.indexOf('create:solo:p-abc');
    expect(i).toBeGreaterThanOrEqual(0);
    expect(deps.calls.indexOf('endOlderSolo:3')).toBeGreaterThan(i);
    expect(deps.calls.at(-1)).toBe('go:#/p/p-abc');
  });

  it('SOLO SPARRING opens the computer table, and falls back to ALONE with a toast while it rejects', async () => {
    const ok = fakeDeps({ openComputer: async () => 'c-room' });
    expect(await launchSolo(ok, prefs(), deck('a', 60))).toBe('#/c/c-room');
    expect(ok.calls).toContain('endOlderSolo:3');
    const no = fakeDeps({ openComputer: () => Promise.reject(new Error('not implemented')) });
    expect(await launchSolo(no, prefs(), deck('a', 60))).toBe('#/p/p-abc');
    expect(no.calls).toContain(`toast:${SPARRING_FALLBACK}`);
    expect(no.calls).toContain('endOlderSolo:3');
  });

  it('CREATE TABLE makes a room with autoSetup and a private GameSummary', async () => {
    const deps = fakeDeps();
    const hash = await launchPrivate(deps, prefs({ mode: 'private', private: { format: 'ffa3', decks: 'any' } }), deck('a', 60));
    expect(hash).toBe(`#/t/amber-fox-river-12/${'K'.repeat(22)}`);
    expect(vi.mocked(deps.games!.create).mock.calls[0]![0]).toMatchObject({ code: 'amber-fox-river-12', key: 'K'.repeat(22), kind: 'private', format: 'ffa3', decks: 'constructed', deck: { id: 'a' } });
    const setup = takePendingSetup('amber-fox-river-12', { getItem: (k) => deps.store.get(k) ?? null, removeItem: (k) => void deps.store.delete(k) });
    expect(setup).toMatchObject({ autoSetup: true, format: 'ffa3', lobby: { draft: null }, deckId: 'a' });
    expect(takePendingSetup('amber-fox-river-12', { getItem: (k) => deps.store.get(k) ?? null, removeItem: () => undefined })).toBeNull();
  });

  it('OPEN DRAFT TABLE writes the lobby settings of the booster setup', async () => {
    const deps = fakeDeps();
    const boosters: BoosterSetup = { how: 'pass', packs: 3, picks: 1, sets: ['DOM'], pickTimer: false };
    await launchDraft(deps, prefs({ mode: 'draft', draft: { format: 'ffa4', boosters } }));
    const setup = JSON.parse(deps.store.get('spellplane.pending.amber-fox-river-12')!);
    expect(setup.lobby).toEqual(boosterToLobby(boosters));
    expect(setup.format).toBe('ffa4');
    expect(vi.mocked(deps.games!.create).mock.calls[0]![0]).toMatchObject({ kind: 'private', decks: 'draftLive' });
  });

  it('FIND MATCH seeks with the queues of the prefs and the deck', async () => {
    const seek = vi.fn();
    const deps = fakeDeps({ matchmaker: { seek } as unknown as Matchmaker });
    await launchQuick(deps, prefs({ mode: 'quick', quick: { format: '2hg', ranked: false } }), deck('a', 40, { kind: 'sealed' }));
    expect(seek).toHaveBeenCalledWith({ queues: ['2hg.limited.casual'], deckId: 'a' });
  });

  it('first run saves the starter deck before it starts; a failing source rejects with FirstRunError', async () => {
    const deps = fakeDeps({
      starterSource: { pool: async () => [] },
      buildStarterDeck: async () => ({ name: 'Starter · Green', main: [{ sid: 'x' }], colour: 'G', set: 'M19' }),
      openComputer: () => Promise.reject(new Error('no')),
    });
    const { deck: d, hash } = await launchFirstRun(deps, prefs());
    expect(hash).toBe('#/p/p-abc');
    const saved = deps.calls.indexOf(`deck:${d.id}`);
    expect(saved).toBeGreaterThanOrEqual(0);
    expect(saved).toBeLessThan(deps.calls.indexOf('go:#/p/p-abc'));
    expect(d).toMatchObject({ kind: 'custom', name: 'Starter · Green' });
    const bad = fakeDeps({ starterSource: { pool: async () => [] } });
    await expect(launchFirstRun(bad, prefs())).rejects.toBeInstanceOf(FirstRunError);
    expect(bad.calls.some((c) => c.startsWith('go:'))).toBe(false);
  });

  it('STARTER DECK builds, saves and selects a starter deck without starting a table', async () => {
    const deps = fakeDeps({
      starterSource: { pool: async () => [] },
      buildStarterDeck: async () => ({ name: 'Starter · Green', main: [{ sid: 'x' }], colour: 'G', set: 'M19' }),
    });
    const d = await makeStarterDeck(deps, prefs({ mode: 'quick' }));
    expect(deps.calls).toEqual([`deck:${d.id}`, 'set:home']);
    expect(vi.mocked(deps.settings!.set).mock.calls[0]![1]).toMatchObject({ mode: 'quick', deckId: d.id });
    expect(deps.games!.create).not.toHaveBeenCalled();
  });
});
