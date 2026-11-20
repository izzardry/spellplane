/**
 * The debug hook's `bot` part (computer.md section 10). Stub by M8-C: no computer game, so no status. M8-P6 owns the
 * file.
 */
import { registerDebug } from '../util/debug';

/** Register `window.__spellplane.bot`. */
export function registerBotDebug(): void {
  registerDebug({ bot: { status: () => null } });
}
