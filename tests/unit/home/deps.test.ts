/** M8-P2: Home's launcher dependencies from the page, with the harness's overrides first (ui/home/deps.ts). */
import { describe, expect, it, vi } from 'vitest';
import type { CardDataSource, FaceSource } from '../../../src/data/types';
import type { Matchmaker } from '../../../src/session/types';
import type { GameStore, SettingsStore } from '../../../src/store/types';
import { launchDeps, newComputerRoom, pageFaces, starterSourceOf } from '../../../src/ui/home/deps';
import type { TableDeps } from '../../../src/ui/table/types';

const mm = { seek: vi.fn() } as unknown as Matchmaker;

describe('launchDeps', () => {
  it('takes the overrides first and the page after', () => {
    const settings = { get: vi.fn() } as unknown as SettingsStore;
    const page = { settings, decks: null, cardData: { searchCards: vi.fn(async () => []) } } as unknown as TableDeps;
    const games = {} as GameStore;
    const go = vi.fn();
    const d = launchDeps({}, { games, go, now: () => 7, page, matchmaker: mm, newRoom: () => ({ roomId: 'amber-fox-river-1', roomKey: 'K', roomUrl: '' }) as never });
    expect(d.games).toBe(games);
    expect(d.settings).toBe(settings);
    expect(d.now()).toBe(7);
    expect(d.newRoom()).toEqual({ roomId: 'amber-fox-river-1', roomKey: 'K' });
    expect(d.starterSource).toBeDefined();
    const over = launchDeps({ games: null, settings: null, go: vi.fn() }, { games, go, now: () => 7, page, matchmaker: mm });
    expect(over.games).toBeNull();
    expect(over.settings).toBeNull();
    expect(over.go).not.toBe(go);
  });

  it('the starter pool is one set searched in the page card source; none without a search', async () => {
    const searchCards = vi.fn(async () => []);
    await starterSourceOf({ cardData: { searchCards } as unknown as CardDataSource } as TableDeps)!.pool('M19');
    expect(searchCards).toHaveBeenCalledWith('e:m19');
    expect(starterSourceOf({ cardData: {} as CardDataSource } as TableDeps)).toBeUndefined();
    expect(starterSourceOf(null)).toBeUndefined();
  });

  it('computer rooms and face images', async () => {
    expect(newComputerRoom(() => 0.5)).toMatch(/^c-[0-9a-z]{12}$/);
    const faces: FaceSource = { faceFor: async (r) => (r.sid === 'u' ? { kind: 'url', url: 'blob:x' } : ({ kind: 'placeholder', face: {} } as never)) };
    const f = pageFaces({ faces } as TableDeps);
    expect(await f({ sid: 'u' })).toBe('blob:x');
    expect(await f({ sid: 'p' })).toBeNull();
    expect(await pageFaces(null)({ sid: 'u' })).toBeNull();
  });
});
