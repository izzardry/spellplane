/**
 * Settings module test page (`?harness=settings`, dev and test builds only; see src/main.ts): the settings panel, the
 * About panel, first-run hints and every empty and error state (PLAN M5-P5 acceptance). Playwright reads it through
 * `window.__settingsHarness`.
 *
 * Query: `section=<settings section>`, `storage=ok|nearly|full|unknown|error` (the storage numbers shown),
 * `touch=1` and `voice=1` (the hint context), `where=start|table`. Settings live in localStorage, so a reload keeps
 * them; `fresh=1` clears them first.
 */
import { mount as mountSvelte } from 'svelte';
import { mtg } from '../../games/index';
import type { StorageStatus } from '../../store/quota';
import type { Settings } from '../../store/types';
import { FakeCardData, FakeFaces, MemorySettings } from '../fakes';
import { HintController } from '../hints/hints';
import { CardBackSetting } from './back';
import Harness from './Harness.svelte';
import { KeymapSettings } from './keys';
import { settingsSectionOf } from './sections';

export interface SettingsHarness {
  settingsWrites(): { name: string; value: unknown }[];
  settings(): Promise<Settings>;
}

declare global {
  interface Window {
    __settingsHarness?: SettingsHarness;
  }
}

const STORAGE: Record<string, StorageStatus | null> = {
  ok: { usage: 12_400_000, quota: 2_000_000_000, persisted: true, imageEntries: 312 },
  nearly: { usage: 930_000_000, quota: 1_000_000_000, persisted: false, imageEntries: 1980 },
  full: { usage: 999_000_000, quota: 1_000_000_000, persisted: false, imageEntries: 2000 },
  unknown: { usage: null, quota: null, persisted: false, imageEntries: null },
  error: null,
};

export function mount(target: HTMLElement): void {
  target.textContent = '';
  document.documentElement.style.cssText = 'margin:0;height:100%';
  document.body.style.cssText = 'margin:0;height:100%;background:#fff;color:#111';
  const params = new URLSearchParams(location.search);
  if (params.get('fresh') === '1') {
    try {
      localStorage.removeItem('spellplane-settings-harness');
    } catch {
      /* storage blocked: settings start fresh anyway */
    }
  }
  let storage: Storage | null;
  try {
    storage = localStorage;
  } catch {
    storage = null;
  }
  const settings = new MemorySettings({}, storage, 'spellplane-settings-harness');
  const keys = new KeymapSettings(mtg.keymap, settings);
  void keys.load();
  const cardBack = new CardBackSetting({ settings });
  void cardBack.refresh();
  const hints = new HintController(settings, {
    where: params.get('where') === 'start' ? 'start' : 'table',
    touch: params.get('touch') === '1',
    voice: params.get('voice') === '1',
  });
  void hints.load();
  const which = params.get('storage') ?? 'ok';
  const status = (): Promise<StorageStatus> => {
    const s = STORAGE[which];
    return s ? Promise.resolve({ ...s }) : Promise.reject(new Error('storage estimate unavailable'));
  };
  const data = new FakeCardData();
  const faces = new FakeFaces(data);
  const failingFaces = { faceFor: () => Promise.reject(new Error('cards.scryfall.io unreachable')) };

  mountSvelte(Harness, {
    target,
    props: { settings, keys, cardBack, neutralBack: mtg.cardBack, hints, storage: status, faces, failingFaces, section: settingsSectionOf(params.get('section')) },
  });

  window.__settingsHarness = {
    settingsWrites: () => JSON.parse(JSON.stringify(settings.writes)) as { name: string; value: unknown }[],
    settings: () => settings.all(),
  };
}
