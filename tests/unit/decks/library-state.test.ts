/** The library model (journey.md 4.2; decks.md D1; contracts.md Part E search lock; PLAN M8-P3 library acceptance at the model level). */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { importLibrary } from '../../../src/store/decks';
import { DEFAULT_HOME_PREFS, type DeckRecord, type DeckStore, type Settings, type SettingsStore } from '../../../src/store/types';
import { DeckLibrary, SEARCH_LOCK_TEXT, UNDO_WINDOW_MS } from '../../../src/ui/decks/state/library';
import { source } from './fixture-decks';

const FILE = readFileSync(join(fileURLToPath(new URL('../../fixtures/decks', import.meta.url)), 'library-v1.json'), 'utf8');

function stores(): { decks: DeckStore & { map: Map<string, DeckRecord> }; settings: SettingsStore & { home: Settings['home'] } } {
  const map = new Map<string, DeckRecord>(importLibrary(FILE).decks.map((d) => [d.id, d]));
  const decks = {
    map,
    list: () => Promise.resolve([...map.values()].sort((a, b) => b.updatedAt - a.updatedAt)),
    get: (id: string) => Promise.resolve(map.get(id) ?? null),
    put: (d: DeckRecord) => (map.set(d.id, d), Promise.resolve()),
    delete: (id: string) => (map.delete(id), Promise.resolve()),
  };
  const settings = {
    home: { ...DEFAULT_HOME_PREFS },
    get(name: keyof Settings) {
      return Promise.resolve(name === 'home' ? this.home : undefined) as never;
    },
    set(name: keyof Settings, v: unknown) {
      if (name === 'home') this.home = v as Settings['home'];
      return Promise.resolve();
    },
    all: () => Promise.reject(new Error('unused')),
  };
  return { decks, settings };
}

function library(searching = false) {
  const s = stores();
  let n = 0;
  const lib = new DeckLibrary({ decks: s.decks, settings: s.settings, cardData: source, newId: () => `n${++n}`, now: () => 5_000_000_000_000, searching: () => searching });
  return { lib, ...s };
}

describe('DeckLibrary', () => {
  it('a seeded profile shows one CUSTOM and one BOOSTER deck, filtered', async () => {
    const { lib } = library();
    await lib.load();
    expect(lib.visible.map((d) => d.kind).sort()).toEqual(['custom', 'sealed']);
    lib.setFilter('sealed');
    expect(lib.visible.map((d) => d.id)).toEqual(['drafted-ur']);
    lib.setFilter('custom');
    expect(lib.visible.map((d) => d.id)).toEqual(['pasted-gw']);
    // Summaries were filled from card data and saved.
    expect(lib.decks.every((d) => d.summary && d.summary.cards === d.main.length)).toBe(true);
  });

  it('a click selects the deck Home plays with; while a search runs it answers the lock line', async () => {
    const { lib, settings } = library();
    await lib.load();
    expect(await lib.select('pasted-gw')).toBe(true);
    expect(settings.home.deckId).toBe('pasted-gw');
    const locked = library(true);
    await locked.lib.load();
    expect(await locked.lib.select('drafted-ur')).toBe(SEARCH_LOCK_TEXT);
    expect(locked.settings.home.deckId).toBeNull();
  });

  it('delete then UNDO restores; delete and the clock run on removes the record', async () => {
    vi.useFakeTimers();
    try {
      const { lib, decks } = library();
      await lib.load();
      lib.remove('pasted-gw');
      expect(lib.visible.map((d) => d.id)).toEqual(['drafted-ur']);
      expect(decks.map.has('pasted-gw')).toBe(true);
      expect(lib.undoRemove('pasted-gw')).toBe(true);
      expect(lib.visible).toHaveLength(2);
      lib.remove('pasted-gw');
      await vi.advanceTimersByTimeAsync(UNDO_WINDOW_MS);
      expect(decks.map.has('pasted-gw')).toBe(false);
      expect(lib.undoRemove('pasted-gw')).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('convert keeps the booster deck and adds a custom copy; duplicate and rename save', async () => {
    const { lib, decks } = library();
    await lib.load();
    const before = JSON.stringify(decks.map.get('drafted-ur'));
    const copy = await lib.convert('drafted-ur');
    expect(copy?.kind).toBe('custom');
    expect(copy?.name).toBe('Thursday Draft (custom)');
    expect(JSON.stringify(decks.map.get('drafted-ur'))).toBe(before);
    const dup = await lib.duplicate('pasted-gw');
    expect(decks.map.get(dup!.id)?.name).toBe('Green-White Pasted (copy)');
    await lib.rename('pasted-gw', '  Selesnya  ');
    expect(decks.map.get('pasted-gw')?.name).toBe('Selesnya');
  });
});
