/**
 * The `games` part of the debug hook (contracts.md Part C "Debug hook": registered by debug/index.ts through
 * `registerGamesDebug`): the History summaries of this profile. M8-P2.
 */
import type { GameStore } from '../store/types';
import { registerDebug } from '../util/debug';

/** Register `window.__spellplane.games` over the page's games store (empty when storage cannot be opened). */
export function registerGamesDebug(games: GameStore | null): void {
  registerDebug({ games: { list: async () => (games ? games.list() : []), get: async (code: string) => (games ? games.get(code) : null) } });
}
