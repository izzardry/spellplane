/**
 * The one hint the start page shows (PLAN M5-P5: first-run hints, one at a time; M5-P3: the Home Screen hint on iPhone
 * and iPad and the storage-persistence prompt; M5 gate). The storage hints come first; the welcome shows only when
 * neither does. Nothing is decided until both sources have loaded, so no hint shows and is then replaced by another.
 */
import type { FirstRunHint } from '../hints/hints';

export type StartPageHint = 'installHomeScreen' | 'persistStorage' | 'welcome' | 'none';

/**
 * `storage`: what the storage hints show once decided (null: neither), undefined while they still read what was
 * answered; `welcome`: whether the first-run hints have read what was seen, and their hint for the start page.
 * Returns undefined while either is still loading.
 */
export function startPageHint(storage: 'installHomeScreen' | 'persistStorage' | null | undefined, welcome: { loaded: boolean; hint: FirstRunHint | null }): StartPageHint | undefined {
  if (storage === undefined || !welcome.loaded) return undefined;
  if (storage) return storage;
  return welcome.hint === 'welcome' ? 'welcome' : 'none';
}
