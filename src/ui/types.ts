/**
 * Props of the app shell src/ui/App.svelte (PLAN M0-P4 HUD, M0-P7 wiring in main.ts; DESIGN "Technology stack and
 * project structure": Svelte draws the HUD around the imperative scene).
 */
import type { CardDataSource, FaceSource } from '../data/types';
import type { GameDefinition } from '../games/types';
import type { createTableScene } from '../scene/index';
import type { TableSession } from '../session/types';

/** What main.ts hands the app shell (PLAN M0-P4, M0-P7). */
export interface AppProps {
  session: TableSession;
  createScene: typeof createTableScene;
  faces: FaceSource;
  cardData: CardDataSource;
  game: GameDefinition;
}
