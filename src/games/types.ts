/**
 * The game-definition seam (DESIGN "Specification: code interfaces", "Table model": Game definition;
 * "Specification: geometry, layout and motion": Tables and seats; "Input and interaction design": keymap).
 * games/ may import core/ and util/ only, so card data is described structurally here.
 */
import type { CardInstance, CoreGameSpec, Format, PhaseSpec, Pose, StackItem, ZoneId, ZoneSpec } from '../core/types';
import type { TextureSource } from '../util/texture';

export type { ZoneSpec, PhaseSpec, TextureSource };

/** An oriented rectangle in the canonical table frame: centre, width along its own x, depth along its own y, rotation in degrees clockwise (DESIGN "Specification: geometry, layout and motion"). */
export interface Rect {
  x: number;
  y: number;
  w: number;
  d: number;
  rot: number;
}

/** Per-seat zone anchors in the canonical frame (DESIGN "Specification: geometry, layout and motion": library, graveyard, exile column at the right edge, command area at the left, avatar outside the near edge). */
export interface SeatZoneAnchors {
  library: Pose;
  graveyard: Pose;
  exile: Pose;
  command: Rect;
  /** Avatar with the life total, outside the near edge, centred. */
  avatar: Pose;
  /** Where other viewers see this seat's hand as a row of card backs. */
  handRow: Rect;
}

/** One seat's place at the table (DESIGN "Specification: geometry, layout and motion", Tables and seats). */
export interface SeatLayout {
  index: number;
  /** Seat angle in degrees: 0 at the near edge as seen by seat 0, clockwise. Cards of this seat rest at rot = angle. */
  angle: number;
  territory: Rect;
  zones: SeatZoneAnchors;
}

/** Table geometry for one format (DESIGN "Specification: geometry, layout and motion", Tables and seats). */
export interface TableLayout {
  format: Format;
  table: { w: number; d: number };
  /** In seat-index order. */
  seats: SeatLayout[];
  /** 200 x 320 at the table centre; each viewer rotates it to cascade toward them. */
  stackLane: Rect;
}

/** The card facts the default resolve destination depends on; Scryfall CardData (data/types.ts) satisfies it (DESIGN "The effect stack", Resolving). */
export interface DestinationCard {
  type_line: string;
}

/** Keymap action ids: the actions of the canonical default keymap (DESIGN "Input and interaction design"). */
export type ActionId =
  // Card
  | 'tap'
  | 'flip'
  | 'transform'
  | 'rotate180'
  | 'counterAdd'
  | 'counterRemove'
  | 'note'
  | 'copy'
  | 'revealTo'
  | 'peek'
  | 'ping'
  | 'zoomTo'
  | 'inspect'
  // Zones
  | 'toGraveyard'
  | 'toExile'
  | 'toHand'
  | 'toLibraryTop'
  | 'toLibraryBottom'
  | 'cast'
  // Library
  | 'draw'
  | 'drawN'
  | 'shuffle'
  | 'mulligan'
  // Combat
  | 'attack'
  | 'attackNoTap'
  | 'settle'
  // Stack
  | 'ability'
  | 'resolve'
  | 'counterTop'
  // Turn
  | 'nextPhase'
  | 'nextTurn'
  | 'untapAll'
  | 'autoPass'
  // Confirm
  | 'ask'
  | 'confirmOk'
  | 'confirmHold'
  // Table
  | 'tidy'
  | 'token'
  | 'rollDie'
  | 'flipCoin'
  | 'undo'
  // Talk
  | 'talk'
  | 'teamTalk'
  | 'mute'
  | 'focusChat'
  // View
  | 'perspective'
  | 'fitTable'
  | 'seat1'
  | 'seat2'
  | 'seat3'
  | 'seat4'
  | 'ownSide'
  | 'help';

/**
 * A key chord (DESIGN "Input and interaction design"). `key` is KeyboardEvent.key normalised: letters lower case
 * ('t'), named keys as the browser names them ('Tab', 'Enter', 'Escape', 'Home', 'F6', ' ' for Space), and
 * non-letter printable keys as the produced character ('+', '-', '?', '0'); for those, Shift is implied by the
 * character and is not part of the chord. `ctrl` means the Control key on every platform.
 */
export interface KeyChord {
  key: string;
  ctrl?: boolean;
  shift?: boolean;
  alt?: boolean;
}

/** Where a binding is live: on the table (hovered card or selection), or only while a confirmation prompt shows, which takes precedence (DESIGN "Input and interaction design"). */
export type KeyContext = 'table' | 'prompt';

/** How a binding fires: on press, while held (inspect, talk), or on a double press (ping) (DESIGN "Input and interaction design", "Combat and annotation"). */
export type KeyTrigger = 'press' | 'hold' | 'double';

/** One key binding (DESIGN "Input and interaction design"). An action may have several bindings. */
export interface KeyBinding {
  action: ActionId;
  chord: KeyChord;
  context: KeyContext;
  trigger: KeyTrigger;
  /** Cheat-sheet group, as in the canonical table. */
  group: 'Card' | 'Zones' | 'Library' | 'Combat' | 'Stack' | 'Turn' | 'Confirm' | 'Table' | 'Talk' | 'View';
  label: string;
}

/** A keymap: all bindings; no chord twice within one context (DESIGN "Input and interaction design"). */
export type Keymap = readonly KeyBinding[];

/** A game definition (DESIGN "Specification: code interfaces"). Extends the engine's CoreGameSpec (id, zones, phases, startingLife). */
export interface GameDefinition extends CoreGameSpec {
  zones: ZoneSpec[];
  phases: PhaseSpec[];
  startingLife(format: Format): number;
  layout(format: Format): TableLayout;
  cardBack: TextureSource;
  /**
   * Where a resolving item goes by default; null means it vanishes (markers) (DESIGN "The effect stack", Resolving).
   * `instance` (added by M0-C) supplies the owner for "owner's graveyard".
   */
  defaultDestination(item: StackItem, card?: DestinationCard, instance?: CardInstance): ZoneId | null;
  keymap: Keymap;
}
