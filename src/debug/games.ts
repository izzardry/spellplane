/**
 * The debug hook's `games` part (persistence.md section 3: History's summaries). Stub by M8-C: lists the store. M8-P2
 * owns the file.
 */
import type { GameStore } from '../store/types';
import { registerDebug } from '../util/debug';

/** Register `window.__spellplane.games` over the page's games store (null when storage cannot be opened). */
export function registerGamesDebug(games: GameStore | null): void {
  registerDebug({ games: { list: async () => (games ? games.list() : []) } });
}
