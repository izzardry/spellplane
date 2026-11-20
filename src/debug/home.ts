/**
 * The `home` part of the debug hook (contracts.md Part C "Debug hook": registered by debug/index.ts through
 * `registerHomeDebug`): the route shown, Home's prefs and what `live()` counts (on Home every count is 0). M8-P2.
 */
import type { SettingsStore } from '../store/types';
import { parseRoute } from '../ui/routes';
import { live } from '../util/lifecycle';
import { registerDebug } from '../util/debug';

/** Register `window.__spellplane.home` (the prefs only where a settings store is given: the harness page). */
export function registerHomeDebug(settings: SettingsStore | null = null): void {
  registerDebug({
    home: {
      route: () => parseRoute(location.hash).name,
      prefs: () => (settings ? settings.get('home') : Promise.resolve(null)),
      live: () => ({ ...live() }),
    },
  });
}
