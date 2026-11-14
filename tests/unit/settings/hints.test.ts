// First-run hints (PLAN M5-P5: "first-run hints (short, dismissible, never blocking)"; store/types.ts HintId and
// Settings.hintsSeen: each shows once; PLAN Milestone 5, owner decisions, Talk key: hints say Ctrl, and the key stays
// remappable, so the hint names the player's own key).
import { describe, expect, it } from 'vitest';
import { MTG_KEYMAP } from '../../../src/games/mtg/keymap';
import { CTRL_KEY_CHORD } from '../../../src/games/types';
import { MemorySettings } from '../../../src/ui/fakes';
import { FIRST_RUN_HINTS, HintController, hintsSeenOf, hintText, nextHint } from '../../../src/ui/hints/hints';
import { applyOverrides, keyLabel } from '../../../src/ui/keymap';
import { startPageHint } from '../../../src/ui/lobby/start-hint';

const table = { where: 'table' as const, touch: false, voice: false };

describe('which hint shows', () => {
  it('welcome first, then the keys on a desktop or the gestures on a touch screen, then the talk key at a table with voice', () => {
    expect(nextHint([], table)).toBe('welcome');
    expect(nextHint(['welcome'], table)).toBe('tableKeys');
    expect(nextHint(['welcome'], { ...table, touch: true })).toBe('touchGestures');
    expect(nextHint(['welcome', 'tableKeys'], table)).toBeNull();
    expect(nextHint(['welcome', 'tableKeys'], { ...table, voice: true })).toBe('talkKey');
    expect(nextHint([...FIRST_RUN_HINTS], { ...table, voice: true, touch: true })).toBeNull();
  });

  it('the start page shows only the welcome; a spectator gets no key, gesture or talk hint', () => {
    expect(nextHint([], { where: 'start', touch: false, voice: true })).toBe('welcome');
    expect(nextHint(['welcome'], { where: 'start', touch: false, voice: true })).toBeNull();
    expect(nextHint(['welcome'], { ...table, voice: true, spectator: true })).toBeNull();
  });

  it('ignores ids of other packages and builds', () => {
    expect(nextHint(['installHomeScreen', 'somethingNew'], table)).toBe('welcome');
    expect(hintsSeenOf(['welcome', 'welcome', 3, null, 'x'])).toEqual(['welcome', 'x']);
    expect(hintsSeenOf('welcome')).toEqual([]);
  });
});

describe('texts', () => {
  it('are short and name the player\'s keys, remapped ones included', () => {
    const key = (map: typeof MTG_KEYMAP) => (a: Parameters<typeof keyLabel>[1]) => keyLabel(map, a);
    expect(hintText('tableKeys', key(MTG_KEYMAP)).text).toContain('T taps it');
    const remapped = applyOverrides(MTG_KEYMAP, [
      { action: 'tap', context: 'table', chord: { key: 'j' } },
      { action: 'talk', context: 'table', chord: CTRL_KEY_CHORD },
    ]);
    expect(hintText('tableKeys', key(remapped)).text).toContain('J taps it');
    // The talk hint names whatever the talk key is (Ctrl by the owner's decision).
    expect(hintText('talkKey', key(remapped)).text).toMatch(/^Hold (Ctrl|Control) to talk/);
    for (const id of FIRST_RUN_HINTS) {
      const t = hintText(id, key(MTG_KEYMAP));
      expect(t.title.length).toBeLessThanOrEqual(30);
      expect(t.text.length).toBeLessThanOrEqual(200);
    }
  });
});

describe('HintController', () => {
  it('shows nothing until it read what was seen, so a returning player never sees a flash', async () => {
    const h = new HintController(new MemorySettings({ hintsSeen: ['welcome', 'tableKeys'] }), table);
    expect(h.current()).toBeNull();
    await h.load();
    expect(h.current()).toBeNull();
  });

  it('a dismissed hint is stored and never shows again; the next one follows', async () => {
    const store = new MemorySettings();
    const h = new HintController(store, table);
    const seen: (string | null)[] = [];
    h.subscribe((x) => seen.push(x));
    await h.load();
    expect(h.current()).toBe('welcome');
    await h.dismiss('welcome');
    expect(h.current()).toBe('tableKeys');
    expect(await store.get('hintsSeen')).toEqual(['welcome']);
    await h.dismiss('tableKeys');
    expect(h.current()).toBeNull();
    expect(seen).toEqual(['welcome', 'tableKeys', null]);
    const again = new HintController(store, table);
    await again.load();
    expect(again.current()).toBeNull();
  });

  it('keeps ids another page or package stored meanwhile', async () => {
    const store = new MemorySettings();
    const h = new HintController(store, table);
    await h.load();
    await store.set('hintsSeen', ['installHomeScreen']);
    await h.dismiss('welcome');
    expect(await store.get('hintsSeen')).toEqual(['installHomeScreen', 'welcome']);
  });

  it('the talk hint appears once voice is there', async () => {
    const h = new HintController(new MemorySettings({ hintsSeen: ['welcome', 'tableKeys'] }), table);
    await h.load();
    expect(h.current()).toBeNull();
    h.setContext({ voice: true });
    expect(h.current()).toBe('talkKey');
  });

  it('without a settings store a dismissal lasts for the page', async () => {
    const h = new HintController(null, table);
    await h.load();
    await h.dismiss('welcome');
    expect(h.current()).toBe('tableKeys');
  });
});

describe('M5 gate: hints that fit the evening and the touch screen', () => {
  it('the welcome ("import a deck to try it alone") waits for the start page or the solo table, not a networked evening', () => {
    expect(nextHint([], { where: 'table', touch: true, voice: true, networked: true })).toBe('touchGestures');
    expect(nextHint([], { where: 'table', touch: false, voice: true, networked: true })).toBe('tableKeys');
    expect(nextHint([], { where: 'table', touch: false, voice: false })).toBe('welcome');
    expect(nextHint([], { where: 'start', touch: true, voice: false, networked: true })).toBe('welcome');
  });

  it('on a touch screen the talk hint names the thumb bar, not a key', () => {
    const touch = hintText('talkKey', () => 'Ctrl', true);
    expect(touch.text).not.toMatch(/Ctrl|key/i);
    expect(touch.text).toContain('Talk');
    expect(hintText('talkKey', () => 'Ctrl').text).toContain('Hold Ctrl');
  });
});

// M5 review: the start page shows one hint at a time and decides which in one step, once the storage hints (M5-P3) and
// the first-run hints have both read what was answered, so the welcome never flashes before a storage hint.
describe('the start page decides on its one hint once both sources have loaded', () => {
  const loaded = { loaded: true, hint: 'welcome' as const };
  it('nothing while either source still loads', () => {
    expect(startPageHint(undefined, loaded)).toBeUndefined();
    expect(startPageHint(null, { loaded: false, hint: null })).toBeUndefined();
    expect(startPageHint('persistStorage', { loaded: false, hint: null })).toBeUndefined();
  });
  it('a storage hint first; the welcome only when neither storage hint shows', () => {
    expect(startPageHint('installHomeScreen', loaded)).toBe('installHomeScreen');
    expect(startPageHint('persistStorage', loaded)).toBe('persistStorage');
    expect(startPageHint(null, loaded)).toBe('welcome');
    expect(startPageHint(null, { loaded: true, hint: null })).toBe('none');
  });
  it('the welcome controller reports when it has loaded', async () => {
    const c = new HintController(new MemorySettings(), { where: 'start', touch: false, voice: false });
    expect(c.loaded).toBe(false);
    await c.load();
    expect(c.loaded).toBe(true);
    expect(startPageHint(null, { loaded: c.loaded, hint: c.current() })).toBe('welcome');
  });
});
