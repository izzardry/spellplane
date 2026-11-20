/**
 * The debug hook's `home` part (journey.md 4.1). Stub by M8-C: the route shown. M8-P2 owns the file.
 */
import { parseRoute } from '../ui/routes';
import { registerDebug } from '../util/debug';

/** Register `window.__spellplane.home`. */
export function registerHomeDebug(): void {
  registerDebug({ home: { route: () => parseRoute(location.hash).name } });
}
