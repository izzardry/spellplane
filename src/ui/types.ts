/**
 * Props of the app shell src/ui/App.svelte (PLAN M0-P4 HUD, M0-P7 wiring in main.ts; DESIGN "Technology stack and
 * project structure": Svelte draws the HUD around the imperative scene).
 */
import type { CardDataSource, FaceSource, ParseResult } from '../data/types';
import type { GameDefinition } from '../games/types';
import type { createTableScene } from '../scene/index';
import type { TableSession } from '../session/types';
import type { SettingsStore } from '../store/types';

/** What main.ts hands the app shell (PLAN M0-P4, M0-P7). */
export interface AppProps {
  session: TableSession;
  createScene: typeof createTableScene;
  faces: FaceSource;
  cardData: CardDataSource;
  game: GameDefinition;
  /** Persists keymap remapping (DESIGN "Input and interaction design": all keys remappable). Added by M0-P4; without it remaps last for the page. */
  settings?: SettingsStore;
  /** data/'s decklist parser (M0-P2) for the deck import dialog. Added by M0-P4; without it a plain "4 Name" parser is used. */
  parseDecklist?: (text: string) => ParseResult;
}
