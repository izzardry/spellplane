// The debug hook's registration lives in util/debug.ts so every module can register its part.
// This folder holds the full SpellplaneDebug type (M0 contracts) and app-level assembly (M0-P7).
export * from '../util/debug';
export * from './types';
export * from './session';
export { FixtureCardDataSource, injectedCardData, type InjectedFixtures } from './fixture-cards';
export * from './net';
export * from './draft';
export * from './speech';
export { fixtureSetSource, injectedSets } from './fixture-sets';
export { registerInputDebug } from './input';
export { pageClock, type PageClock } from './net';

// M8-C (contracts.md Part C "Debug hook"): the parts of the M8 packages, registered through stubs at fixed paths that
// their owners fill (mm: M8-P7, bot: M8-P6, decks: M8-P3, games and home: M8-P2). No package edits this file.
import type { Matchmaker } from '../session/types';
import type { DeckStore, GameStore } from '../store/types';
import { registerBotDebug } from './bot';
import { registerDecksDebug } from './decks';
import { registerGamesDebug } from './games';
import { registerHomeDebug } from './home';
import { registerMmDebug } from './mm';

/** What the M8 parts of the hook read (main.ts). */
export interface M8DebugDeps {
  matchmaker: Matchmaker;
  decks: DeckStore | null;
  games: GameStore | null;
}

/** Register `mm`, `bot`, `decks`, `games` and `home`. */
export function registerM8Debug(deps: M8DebugDeps): void {
  registerMmDebug(deps.matchmaker);
  registerBotDebug();
  registerDecksDebug(deps.decks);
  registerGamesDebug(deps.games);
  registerHomeDebug();
}
