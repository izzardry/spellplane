/**
 * The `home` part of the debug hook (contracts.md Part C "Debug hook": registered by debug/index.ts through
 * `registerHomeDebug`): Home's prefs and what `live()` counts (on Home every count is 0). M8-P2.
 */
import type { HomePrefs, SettingsStore } from '../store/types';
import { live } from '../util/lifecycle';
import { registerDebug } from '../util/debug';

export interface HomeDebug {
  prefs(): Promise<HomePrefs | null>;
  live(): Record<string, number>;
}

/** Register `window.__spellplane.home`. */
export function registerHomeDebug(settings: SettingsStore | null): void {
  registerDebug({ home: { prefs: () => settings?.get('home') ?? Promise.resolve(null), live: () => ({ ...live() }) } } as never);
}
