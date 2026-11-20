/**
 * The `games` part of the debug hook (contracts.md Part C "Debug hook": registered by debug/index.ts through
 * `registerGamesDebug`): the History summaries of this profile. M8-P2.
 */
import type { GameStore, GameSummary } from '../store/types';
import { registerDebug } from '../util/debug';

export interface GamesDebug {
  list(): Promise<GameSummary[]>;
  get(code: string): Promise<GameSummary | null>;
}

/** Register `window.__spellplane.games` over `games` (nothing without a store). */
export function registerGamesDebug(games: GameStore | null): void {
  if (!games) return;
  registerDebug({ games: { list: () => games.list(), get: (code: string) => games.get(code) } } as never);
}
