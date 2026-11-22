/**
 * Props of the table HUD (src/ui/Hud.svelte): the seams it codes against (PLAN M0-P4: TableSession, TableScene,
 * FaceSource and CardDataSource interfaces only).
 */
import type { Snippet } from 'svelte';
import type { SeatId } from '../core/types';
import type { CardDataSource, FaceSource } from '../data/types';
import type { GameDefinition } from '../games/types';
import type { CreateTableScene } from '../scene/types';
import type { EveningControls, TableSession } from '../session/types';
import type { SettingsStore } from '../store/types';
import type { Theme } from '../themes/types';
import type { ParseDecklist } from './deck';
import type { MenuGroup } from './design/menu';

/** What the shell tells the HUD (docs/design/m8/m7-adjustments.md section 2; contracts.md Part C). All optional: harness pages and old specs pass none. */
export interface HudShellProps {
  /** Leave to Home. The table keeps running and stays in History. Passed: a back arrow shows, top left. */
  onleave?: () => void;
  /** Menu groups shown first, above the HUD's own (journey 4.10 "This game": Leave to home, Invite…, Concede, Declare result…). */
  menuTop?: () => MenuGroup[];
  /** True at `#/solo`: the no-deck line opens the paste dialog (journey.md 4.10: `Import deck…` is not in the Menu). */
  sandbox?: boolean;
  /** Opens the shell's deck picker for a table without a deck (not in the sandbox). */
  onchoosedeck?: () => void;
  /** Seats whose player is away; their plates dim. Seats not listed are here. */
  seatPresence?: Readonly<Record<SeatId, 'here' | 'away'>>;
  /** The top section of a plate's "⋯" menu (connection state, Bring back…, Leave table). The second argument closes the menu. */
  plateMenuTop?: Snippet<[SeatId, () => void]>;
  /** Badges on a plate, beside the name (RE-INVITE, NOT SAVING, SEAT MOVED). At most 28 px high. */
  plateBadge?: Snippet<[SeatId]>;
  /** One line under the turn tracker (the queue pill, "Waiting for Ben · Bring back · Play on"). Empty takes no space. */
  status?: Snippet;
  /** A message through the HUD's one toast place ("Ben left the table. The game is saved."), with an optional action. */
  notice?: { id: number; text: string; action?: { label: string; run: () => void } } | null;
  /** 'plates': only the plates, their menus and the status line (a waiting room or a gathering over the arena). Default 'full'. */
  chrome?: 'full' | 'plates';
  /** Look, do not touch: no primary button, no strip, no pile actions; the scene proposes no action. */
  readOnly?: boolean;
  /** When set, the primary button shows this label and runs it instead of its own turn step (the computer game's combat cues). */
  primaryOverride?: { label: string; run(): void; quiet?: boolean } | null;
}

export interface HudProps extends HudShellProps {
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
  /**
   * Added by M7-P2: the evening's proposals (ui/flow, M2-P7) for a networked table. "Next game" and "New draft" are
   * offered in the HUD's Menu behind a confirmation (docs/design/m7-hud-proposal.md, What goes away: the "Next game /
   * New draft" corner panel during play).
   */
  evening?: EveningControls | undefined;
}
