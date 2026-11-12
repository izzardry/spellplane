/**
 * M0-P5 acceptance: settings round-trip through IndexedDB with defaults filled in; the deck library round-trips
 * (DESIGN "Specification: network protocol and secrecy", Local persistence; "Pre-game", Local deck library).
 */
import { afterEach, describe, expect, it } from 'vitest';
import { newDeckId } from '../../../src/store/decks';
import { openStores, type LocalStores } from '../../../src/store/stores';
import { DEFAULT_SETTINGS, type DeckRecord, type Settings } from '../../../src/store/types';
import { uniqueDbName } from './helpers';

const open: LocalStores[] = [];
async function stores(name = uniqueDbName('settings')): Promise<LocalStores> {
  const s = await openStores(name);
  open.push(s);
  return s;
}
afterEach(() => {
  for (const s of open.splice(0)) s.close();
});

const CHANGED: Settings = {
  theme: 'dusk',
  keymap: [
    { action: 'tap', context: 'card', chord: { key: 'Space' } },
    { action: 'draw', context: 'table', chord: { key: 'd', ctrl: true, shift: true } },
  ],
  talkMode: 'dictation',
  speechEngine: 'local',
  speechLang: 'de',
  quality: 'low',
  followStack: true,
  followActive: true,
  talk: { gate: 'turn', voice: true, dictation: true, muted: false, mouseButton: 3 },
  micDevice: 'mic-2',
  peerAudio: { '0123456789abcdef': { volume: 0.5, muted: true } },
};

describe('settings', () => {
  it('reads the defaults before anything is stored', async () => {
    const s = await stores();
    expect(await s.settings.all()).toEqual(DEFAULT_SETTINGS);
    for (const name of Object.keys(DEFAULT_SETTINGS) as (keyof Settings)[]) expect(await s.settings.get(name)).toEqual(DEFAULT_SETTINGS[name]);
  });

  it('round-trips every setting across a reopened database', async () => {
    const name = uniqueDbName('settings');
    const s = await stores(name);
    for (const key of Object.keys(CHANGED) as (keyof Settings)[]) await s.settings.set(key, CHANGED[key] as never);
    s.close();
    const again = await stores(name);
    expect(await again.settings.all()).toEqual(CHANGED);
    expect(await again.settings.get('keymap')).toEqual(CHANGED.keymap);
    expect(await again.settings.get('followStack')).toBe(true);
  });

  it('fills defaults around the settings that were changed', async () => {
    const s = await stores();
    await s.settings.set('theme', 'wyrm');
    await s.settings.set('followActive', true);
    expect(await s.settings.all()).toEqual({ ...DEFAULT_SETTINGS, theme: 'wyrm', followActive: true });
  });

  it('overwrites a setting and stores false values', async () => {
    const s = await stores();
    await s.settings.set('followStack', true);
    await s.settings.set('followStack', false);
    expect(await s.settings.get('followStack')).toBe(false);
    expect(await s.db.count('settings')).toBe(1);
  });

  it('hands out copies of the defaults, never the shared default objects', async () => {
    const s = await stores();
    (await s.settings.get('keymap')).push({ action: 'x', context: 'card', chord: { key: 'x' } });
    (await s.settings.all()).keymap.push({ action: 'y', context: 'card', chord: { key: 'y' } });
    expect(DEFAULT_SETTINGS.keymap).toEqual([]);
    expect(await s.settings.get('keymap')).toEqual([]);
  });

  it('ignores stored records of settings it does not know and rejects unknown names', async () => {
    const s = await stores();
    await s.db.put('settings', { name: 'retired', value: 1 } as never);
    expect(await s.settings.all()).toEqual(DEFAULT_SETTINGS);
    await expect(s.settings.get('retired' as keyof Settings)).rejects.toThrow(RangeError);
    await expect(s.settings.set('retired' as 'theme', 'x')).rejects.toThrow(RangeError);
  });
});

function deck(id: string, updatedAt: number, extra: Partial<DeckRecord> = {}): DeckRecord {
  return {
    id,
    name: `Deck ${id}`,
    main: [{ sid: 'aaaa' }, { sid: 'bbbb', foil: true }, { sid: 'aaaa' }],
    side: [{ sid: 'cccc' }],
    source: 'pasted',
    text: '2 Island\n1 Forest (M19) 280',
    createdAt: 1000,
    updatedAt,
    ...extra,
  };
}

describe('decks', () => {
  it('round-trips a deck with refs, sideboard, source and timestamps across a reopened database', async () => {
    const name = uniqueDbName('decks');
    const s = await stores(name);
    await s.decks.put(deck('d1', 2000));
    s.close();
    expect(await (await stores(name)).decks.get('d1')).toEqual(deck('d1', 2000));
  });

  it('lists the most recently updated deck first', async () => {
    const s = await stores();
    await s.decks.put(deck('a', 3000));
    await s.decks.put(deck('b', 1000, { source: 'drafted' }));
    await s.decks.put(deck('c', 2000, { source: 'built' }));
    expect((await s.decks.list()).map((d) => d.id)).toEqual(['a', 'c', 'b']);
    await s.decks.put(deck('b', 4000, { name: 'Renamed' }));
    const list = await s.decks.list();
    expect(list.map((d) => d.id)).toEqual(['b', 'a', 'c']);
    expect(list[0]!.name).toBe('Renamed');
  });

  it('returns null for a missing deck, deletes, and rejects a deck without id', async () => {
    const s = await stores();
    expect(await s.decks.get('nope')).toBeNull();
    await s.decks.put(deck('x', 1));
    await s.decks.delete('x');
    await s.decks.delete('never-existed');
    expect(await s.decks.get('x')).toBeNull();
    expect(await s.decks.list()).toEqual([]);
    await expect(s.decks.put(deck('', 1))).rejects.toThrow(TypeError);
  });

  it('makes unique deck ids', () => {
    const ids = new Set(Array.from({ length: 100 }, () => newDeckId()));
    expect(ids.size).toBe(100);
  });
});
