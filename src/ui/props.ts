/**
 * Props of the table HUD (src/ui/Hud.svelte): the seams it codes against (PLAN M0-P4: TableSession, TableScene,
 * FaceSource and CardDataSource interfaces only).
 */
import type { CardDataSource, FaceSource } from '../data/types';
import type { GameDefinition } from '../games/types';
import type { CreateTableScene } from '../scene/types';
import type { TableSession } from '../session/types';
import type { SettingsStore } from '../store/types';
import type { Theme } from '../themes/types';
import type { ParseDecklist } from './deck';

export interface HudProps {
  session: TableSession;
  createScene: CreateTableScene;
  faces: FaceSource;
  cardData: CardDataSource;
  game: GameDefinition;
  theme: Theme;
  /** Persists remapped keys; without it remaps last for the page. */
  settings?: SettingsStore | undefined;
  /** Decklist parser (data/, M0-P2); defaults to the plain-list parser in ui/deck.ts. */
  parseDecklist?: ParseDecklist | undefined;
  /** Voice controls (hold Ctrl, Shift+Ctrl, M); milestone 3 connects the voice module. */
  onVoice?: ((action: 'talk' | 'teamTalk' | 'mute', phase: 'start' | 'end') => void) | undefined;
  /** Ids for new objects (tokens, stack items, rounds); defaults to seat-prefixed random ids. */
  newId?: ((prefix: string) => string) | undefined;
}
