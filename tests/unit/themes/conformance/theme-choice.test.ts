// The viewer's theme choice (PLAN M4-P6: per-viewer theme picker stored in settings, lazy chunk loading; DESIGN "Themes
// and rendering": "Themes are chosen per viewer, loaded on demand as separate chunks and switchable mid-game without
// reloading; two players at the same table can use different themes").
import { describe, expect, it, vi } from 'vitest';
import type { Theme, ThemeId } from '../../../../src/themes/index';
import { paper } from '../../../../src/themes/paper/index';
import { MemorySettings } from '../../../../src/ui/fakes';
import { parseRoute } from '../../../../src/ui/routes';
import { ThemeChoice, waitsForStoredTheme, type ThemeChoiceState } from '../../../../src/ui/settings/theme';

const fake = (id: ThemeId): Theme => ({ ...paper, id, label: id });

/** A chunk loader whose loads the test settles by hand. */
function gatedLoader() {
  const waiting = new Map<ThemeId, { resolve: (t: Theme) => void; reject: (e: Error) => void }[]>();
  const load = vi.fn((id: ThemeId) => new Promise<Theme>((resolve, reject) => waiting.set(id, [...(waiting.get(id) ?? []), { resolve, reject }])));
  return {
    load,
    finish: (id: ThemeId) => waiting.get(id)?.shift()?.resolve(fake(id)),
    fail: (id: ThemeId, msg = 'network down') => waiting.get(id)?.shift()?.reject(new Error(msg)),
  };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('ThemeChoice', () => {
  it('starts in Paper with only Paper loaded, and loads nothing without a stored choice', async () => {
    const load = vi.fn(async (id: ThemeId) => fake(id));
    const c = new ThemeChoice({ settings: new MemorySettings(), load });
    await c.ready;
    expect(c.id()).toBe('paper');
    expect(c.loaded()).toEqual(['paper']);
    expect(load).not.toHaveBeenCalled();
  });

  it('shows the stored choice once its chunk is loaded, before `ready` settles', async () => {
    const load = vi.fn(async (id: ThemeId) => fake(id));
    const c = new ThemeChoice({ settings: new MemorySettings({ theme: 'wyrm' }), load });
    await c.ready;
    expect(c.id()).toBe('wyrm');
    expect(load.mock.calls).toEqual([['wyrm']]);
    expect(c.loaded()).toEqual(['paper', 'wyrm']);
  });

  it('reads an unknown stored theme as Paper', async () => {
    const load = vi.fn(async (id: ThemeId) => fake(id));
    const c = new ThemeChoice({ settings: new MemorySettings({ theme: 'neon' }), load });
    await c.ready;
    expect(c.id()).toBe('paper');
    expect(load).not.toHaveBeenCalled();
  });

  it('loads a theme chunk the first time it is picked and never again', async () => {
    const load = vi.fn(async (id: ThemeId) => fake(id));
    const settings = new MemorySettings();
    const c = new ThemeChoice({ settings, load });
    await c.set('dusk');
    await c.set('paper');
    await c.set('dusk');
    expect(load.mock.calls).toEqual([['dusk']]);
    expect(c.id()).toBe('dusk');
    expect(settings.writes.map((w) => [w.name, w.value])).toEqual([
      ['theme', 'dusk'],
      ['theme', 'paper'],
      ['theme', 'dusk'],
    ]);
  });

  it('tells subscribers about loading and the switch, and stops after unsubscribe', async () => {
    const g = gatedLoader();
    const c = new ThemeChoice({ load: g.load });
    const seen: ThemeChoiceState[] = [];
    const off = c.subscribe((s) => seen.push(s));
    const p = c.set('stonetable');
    expect(c.state()).toMatchObject({ loading: 'stonetable', error: null });
    expect(c.id()).toBe('paper');
    g.finish('stonetable');
    await p;
    expect(seen.map((s) => [s.theme.id, s.loading])).toEqual([
      ['paper', 'stonetable'],
      ['stonetable', null],
    ]);
    off();
    await c.set('paper');
    expect(seen).toHaveLength(2);
  });

  it('lets the latest pick win when an earlier chunk arrives later', async () => {
    const g = gatedLoader();
    const settings = new MemorySettings();
    const c = new ThemeChoice({ settings, load: g.load });
    const dusk = c.set('dusk');
    const wyrm = c.set('wyrm');
    g.finish('wyrm');
    await wyrm;
    expect(c.id()).toBe('wyrm');
    g.finish('dusk');
    expect((await dusk).id).toBe('wyrm');
    expect(c.id()).toBe('wyrm');
    // The late chunk is kept: picking Dusk now needs no second load.
    expect(c.loaded()).toEqual(['paper', 'dusk', 'wyrm']);
    expect(settings.writes.map((w) => w.value)).toEqual(['wyrm']);
  });

  it('a cached pick overtakes a load still under way', async () => {
    const g = gatedLoader();
    const c = new ThemeChoice({ load: g.load });
    const dusk = c.set('dusk');
    await c.set('paper');
    g.finish('dusk');
    await dusk;
    expect(c.id()).toBe('paper');
    expect(c.state().loading).toBeNull();
  });

  it('keeps the current theme and says why when a chunk cannot be loaded; a retry can succeed', async () => {
    const g = gatedLoader();
    const settings = new MemorySettings();
    const c = new ThemeChoice({ settings, load: g.load });
    const p = c.set('dusk');
    g.fail('dusk', 'Failed to fetch dynamically imported module');
    await expect(p).rejects.toThrow('Failed to fetch');
    expect(c.id()).toBe('paper');
    expect(c.state()).toMatchObject({ loading: null, error: expect.stringContaining('Dusk could not be loaded') });
    expect(c.state().error).toContain('Paper stays; reload the page to try again');
    expect(c.loaded()).toEqual(['paper']);
    expect(settings.writes).toEqual([]);
    const retry = c.set('dusk');
    g.finish('dusk');
    await retry;
    expect(c.state()).toMatchObject({ loading: null, error: null });
    expect(c.id()).toBe('dusk');
  });

  it('refuses a chunk that holds another theme', async () => {
    const c = new ThemeChoice({ load: async () => fake('wyrm') });
    await expect(c.set('dusk')).rejects.toThrow('holds the wyrm theme');
    expect(c.id()).toBe('paper');
  });

  it('refuses unknown theme ids', async () => {
    const c = new ThemeChoice({ load: async (id) => fake(id) });
    await expect(c.set('neon' as ThemeId)).rejects.toThrow('unknown theme neon');
  });

  it('a pick made while the stored choice is still being read wins over it', async () => {
    let release!: (v: string) => void;
    const settings = new MemorySettings({ theme: 'wyrm' });
    vi.spyOn(settings, 'get').mockImplementation(() => new Promise((r) => (release = r as (v: string) => void)) as never);
    const load = vi.fn(async (id: ThemeId) => fake(id));
    const c = new ThemeChoice({ settings, load });
    await c.set('dusk');
    release('wyrm');
    await c.ready;
    await flush();
    expect(c.id()).toBe('dusk');
    expect(load.mock.calls).toEqual([['dusk']]);
  });

  it('settles `ready` even when the settings never answer, showing Paper', async () => {
    const settings = new MemorySettings();
    vi.spyOn(settings, 'get').mockImplementation(() => new Promise(() => undefined) as never);
    const c = new ThemeChoice({ settings, restoreTimeoutMs: 10 });
    await c.ready;
    expect(c.id()).toBe('paper');
  });

  it('a stored theme whose chunk fails leaves Paper and still settles `ready`', async () => {
    const c = new ThemeChoice({ settings: new MemorySettings({ theme: 'dusk' }), load: async () => Promise.reject(new Error('offline')) });
    await c.ready;
    expect(c.id()).toBe('paper');
    expect(c.state().error).toContain('Dusk could not be loaded');
  });

  it('only the pages that build a table scene wait for the stored theme; the start page and the connection check do not', () => {
    expect(waitsForStoredTheme(parseRoute(''))).toBe(true);
    expect(waitsForStoredTheme(parseRoute('#/t/room1/key1'))).toBe(true);
    expect(waitsForStoredTheme(parseRoute('#/lobby'))).toBe(false);
    expect(waitsForStoredTheme(parseRoute('#/diag'))).toBe(false);
    expect(waitsForStoredTheme(parseRoute('#/nowhere'))).toBe(false);
  });

  it('two viewers keep separate choices (one settings store each, as each browser profile has)', async () => {
    const load = async (id: ThemeId) => fake(id);
    const a = new ThemeChoice({ settings: new MemorySettings(), load });
    const b = new ThemeChoice({ settings: new MemorySettings(), load });
    await a.set('stonetable');
    expect(a.id()).toBe('stonetable');
    expect(b.id()).toBe('paper');
  });
});
