// The viewer's quality level and follow toggles (DESIGN "Themes and rendering", Renderer: "a per-theme quality setting
// drops shadows and post-processing first"; "Camera and navigation", Follow options: two personal toggles, off by
// default; "Local persistence": quality and follow toggles are per-browser settings).
import { describe, expect, it } from 'vitest';
import type { FollowOptions } from '../../../src/scene/types';
import type { QualityId } from '../../../src/themes/types';
import { MemorySettings } from '../../../src/ui/fakes';
import { DEFAULT_VIEW, qualityIdOf, ViewSettings, viewPrefsOf, type ViewTarget } from '../../../src/ui/settings/view';

function recorder(): { target: ViewTarget; calls: unknown[][] } {
  const calls: unknown[][] = [];
  return {
    calls,
    target: {
      setQuality: (id: QualityId) => void calls.push(['setQuality', id]),
      camera: { setFollow: (next: Partial<FollowOptions>) => void calls.push(['setFollow', next]) },
    },
  };
}

describe('viewPrefsOf', () => {
  it('reads stored values and falls back to the defaults for anything unexpected', () => {
    expect(viewPrefsOf({})).toEqual(DEFAULT_VIEW);
    expect(viewPrefsOf({ quality: 'low', followStack: true, followActive: false })).toEqual({ quality: 'low', followStack: true, followActive: false });
    expect(viewPrefsOf({ quality: 'ultra' as never, followStack: 'yes' as never })).toEqual(DEFAULT_VIEW);
    expect(qualityIdOf('medium')).toBe('medium');
    expect(qualityIdOf(undefined)).toBe('high');
  });
});

describe('ViewSettings', () => {
  it('hands nothing to a scene when the stored settings are the defaults (the scene starts at high, follow off)', async () => {
    const view = new ViewSettings(new MemorySettings());
    const { target, calls } = recorder();
    view.attach(target);
    await view.refresh();
    expect(calls).toEqual([]);
  });

  it('hands the stored quality and follow toggles to the scene once loaded, whichever comes first', async () => {
    const early = new ViewSettings(new MemorySettings({ quality: 'medium', followActive: true }));
    const a = recorder();
    early.attach(a.target);
    await early.refresh();
    expect(a.calls).toEqual([
      ['setQuality', 'medium'],
      ['setFollow', { stack: false, activePlayer: true }],
    ]);

    const late = new ViewSettings(new MemorySettings({ quality: 'low' }));
    await late.refresh();
    const b = recorder();
    late.attach(b.target);
    expect(b.calls).toEqual([['setQuality', 'low']]);
    expect(late.state()).toEqual({ quality: 'low', followStack: false, followActive: false });
  });

  it('a change is shown, handed to the scene and stored; turning a follow toggle off reaches the scene too', async () => {
    const store = new MemorySettings();
    const view = new ViewSettings(store);
    const { target, calls } = recorder();
    const seen: unknown[] = [];
    view.subscribe((p) => seen.push(p));
    view.attach(target);
    await view.set('quality', 'low');
    await view.set('followStack', true);
    await view.set('followStack', false);
    expect(calls).toEqual([
      ['setQuality', 'low'],
      ['setFollow', { stack: true, activePlayer: false }],
      ['setFollow', { stack: false, activePlayer: false }],
    ]);
    expect(store.writes).toEqual([
      { name: 'quality', value: 'low' },
      { name: 'followStack', value: true },
      { name: 'followStack', value: false },
    ]);
    expect(seen).toHaveLength(3);
    expect(await store.get('quality')).toBe('low');
  });

  it('a refresh hands over only what changed elsewhere (another tab), and nothing when nothing did', async () => {
    const store = new MemorySettings();
    const view = new ViewSettings(store);
    const { target, calls } = recorder();
    view.attach(target);
    await view.refresh();
    await store.set('quality', 'medium');
    await view.refresh();
    await view.refresh();
    expect(calls).toEqual([['setQuality', 'medium']]);
  });

  it('a change on this page wins over a read that started before it', async () => {
    const store = new MemorySettings({ quality: 'medium' });
    const view = new ViewSettings(store);
    const { target, calls } = recorder();
    view.attach(target);
    const reading = view.refresh();
    await view.set('quality', 'low');
    await reading;
    expect(view.state().quality).toBe('low');
    expect(calls).toEqual([['setQuality', 'low']]);
  });

  it('a new scene gets the current settings; a detached or disposed one gets nothing', async () => {
    const view = new ViewSettings(new MemorySettings());
    await view.set('quality', 'low');
    const first = recorder();
    view.attach(first.target);
    expect(first.calls).toEqual([['setQuality', 'low']]);
    view.attach(null);
    await view.set('followActive', true);
    expect(first.calls).toHaveLength(1);
    const second = recorder();
    view.attach(second.target);
    expect(second.calls).toEqual([
      ['setQuality', 'low'],
      ['setFollow', { stack: false, activePlayer: true }],
    ]);
    view.dispose();
    await view.set('quality', 'high');
    expect(second.calls).toHaveLength(2);
  });

  it('without a store the settings last for the page', async () => {
    const view = new ViewSettings(null);
    await view.refresh();
    await view.set('quality', 'medium');
    expect(view.state().quality).toBe('medium');
  });
});
