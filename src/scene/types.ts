/**
 * The TableScene API (DESIGN "Camera and navigation", "Card manipulation", "Themes and rendering",
 * "Specification: geometry, layout and motion"). Implementer: M0-P3; consumers: M0-P4 (HUD), M0-P7 (session wiring).
 * The scene is a pure view of TableState plus local ViewState; it changes shared state only through `dispatch`.
 */
import type { ActionDraft } from '../core/actions';
import type { Anchor, CardRef, DeckBuild, DraftCard, InstanceId, Line, PackId, PileId, Pose, SeatId, TableState, ZoneId } from '../core/types';
import type { CardData, FaceSource } from '../data/types';
import type { GameDefinition, TableLayout } from '../games/types';
import type { Theme } from '../themes/types';

/** A point in CSS pixels relative to the viewport (DESIGN "Camera and navigation"). */
export interface ScreenPoint {
  x: number;
  y: number;
}

/** A point on the table in mm, canonical frame (DESIGN "Specification: geometry, layout and motion"). */
export interface TablePoint {
  x: number;
  y: number;
}

/** A world point: table x, y and height z in mm (DESIGN "Specification: geometry, layout and motion"). */
export interface TablePoint3 extends TablePoint {
  z: number;
}

/** [x, y, z] (DESIGN "Specification: code interfaces", SpellplaneDebug.camera). */
export type Vec3 = [number, number, number];

/** A ping being shown, kept by the session for its fade time (DESIGN "Combat and annotation", Ping). */
export interface ActivePing {
  id: string;
  target: Anchor;
  seat: SeatId;
}

/** Local-only view state, never shared (DESIGN "Data model and protocol", Not actions; "Table model", Face-down). */
export interface ViewState {
  selection: InstanceId[];
  hovered: InstanceId | null;
  /** Identities this viewer may see but shared state lacks: own hand, own face-down cards (drawn dimmed), peeks, targeted reveals. */
  privateFaces: Record<InstanceId, CardRef>;
  reducedMotion: boolean;
  pings: ActivePing[];
  /** A pile or zone fanned open in place, or null (DESIGN "Card manipulation"). */
  openPile: PileId | ZoneId | null;
}

/** Scene callbacks to the HUD (DESIGN "Input and interaction design"). */
export interface SceneEvents {
  hover(card: InstanceId | null): void;
  contextMenu(card: InstanceId | null, at: ScreenPoint): void;
  inspect(card: InstanceId): void;
  pileOpen(id: ZoneId | PileId): void;
  selectionChange(ids: InstanceId[]): void;
}

/** Options for createTableScene (DESIGN "Specification: code interfaces"). */
export interface TableSceneOptions {
  game: GameDefinition;
  layout: TableLayout;
  /** Seat shown at the bottom; null for a spectator (seat 0's view). */
  viewerSeat: SeatId | null;
  theme: Theme;
  faces: FaceSource;
  /** Shared-state changes (moves, taps, piles...); the session stamps by, cid and seq. */
  dispatch(action: ActionDraft): void;
  events: Partial<SceneEvents>;
}

/** Camera rig name (DESIGN "Camera and navigation"). */
export type CameraRig = 'birdseye' | 'ego';

/** Camera controls (DESIGN "Camera and navigation", Navigation gestures). Screen coordinates are CSS px. */
export interface CameraControls {
  /** Fit the whole table with a 5% margin (key 0). */
  fit(animate?: boolean): void;
  /** Zoom by `factor` (>1 zooms in) keeping the table point under (x, y) fixed. */
  zoomAt(x: number, y: number, factor: number): void;
  panBy(dx: number, dy: number): void;
  /** Ease to a seat's territory (keys 1-4, Home). */
  goToSeat(seat: SeatId): void;
  /** Zoom to a card or pile (key Z). */
  zoomTo(target: InstanceId | PileId | ZoneId): void;
  /** Switch rig (key P); M0 has bird's-eye only, the ego rig arrives in M4-P1. */
  setRig(rig: CameraRig): void;
  rig(): CameraRig;
}

/** One card as the debug hook reports it (DESIGN "Specification: code interfaces", SpellplaneDebug.cards). */
export interface DebugCard {
  id: InstanceId;
  pose: Pose;
  screen: DOMRect;
  visible: boolean;
}

/** Camera as the debug hook reports it (DESIGN "Specification: code interfaces"). */
export interface DebugCamera {
  rig: string;
  fov: number;
  position: Vec3;
  pitch: number;
}

/** Render statistics (DESIGN "Specification: code interfaces", frameStats). */
export interface FrameStats {
  drawCalls: number;
  textureBytes: number;
  frameMs: number;
}

/** The scene's parts of the debug hook (DESIGN "Specification: code interfaces"). */
export interface SceneDebugParts {
  cards(): DebugCard[];
  camera(): DebugCamera;
  lines(): Line[];
  frameStats(): FrameStats;
}

/** A live table scene (DESIGN "Specification: code interfaces"; "Themes and rendering"). */
export interface TableScene {
  /** Render this state and view; cheap when nothing changed. */
  update(state: TableState, view: ViewState): void;
  /** Swap theme without reload, state preserved (DESIGN "Themes and rendering"). */
  setTheme(theme: Theme): void;
  /** Change layout or viewer seat (lobby, format change). */
  setLayout(layout: TableLayout, viewerSeat: SeatId | null): void;
  readonly camera: CameraControls;
  /** Topmost card under a screen point, or null. */
  cardAt(x: number, y: number): InstanceId | null;
  /** Zone pile, stack lane or avatar under a screen point (drop targets), or null. */
  zoneAt(x: number, y: number): ZoneId | null;
  /** Take over a drag that started in the HUD (hand fan) at a screen point (DESIGN "Camera and navigation", Screen-anchored layer). */
  startDrag(card: InstanceId, x: number, y: number): void;
  worldToScreen(p: TablePoint3): ScreenPoint | null;
  screenToTable(x: number, y: number): TablePoint | null;
  readonly debug: SceneDebugParts;
  dispose(): void;
}

/** Create a scene in `host` (DESIGN "Specification: code interfaces"). Implemented in scene/index.ts by M0-P3. */
export type CreateTableScene = (host: HTMLElement, opts: TableSceneOptions) => TableScene;

// ---------------------------------------------------------------------------------------------------------------------
// Draft and builder surfaces (DESIGN "Pre-game: draft, sealed and deck building", Drafting interaction, Deck building).
// Added by M2-C. The draft surface is M2-P4's (scene/draft.ts), the builder table M2-P5's (scene/builder.ts). Both draw
// local data the HUD hands them (identities this viewer may see) and report gestures through events; like the table
// scene they never touch the network or the secret store.
// ---------------------------------------------------------------------------------------------------------------------

/** Sort keys for the builder's solitaire columns and the list view (DESIGN "Pre-game", Deck building: "by colour, mana value or type"). */
export type BuilderSort = 'colour' | 'manaValue' | 'type';

/** What the draft surface shows (DESIGN "Pre-game", Drafting interaction). */
export interface DraftSurfaceView {
  /**
   * The pack to pick from: a fan on the private table for a held pack, the shared table for a Rochester pack, or the
   * 3×3 grid (Grid draft; null cells are taken); null while waiting.
   */
  pack: { packId: PackId; cards: (DraftCard | null)[]; layout: 'fan' | 'grid'; shared: boolean } | null;
  /** Marked cards (first click marks, a second click or Enter confirms). */
  marked: InstanceId[];
  /** Cards one confirm takes. */
  picks: number;
  /** The own pool, laid out by the surface sorted by colour; stays visible while drafting. */
  pool: CardRef[];
  /** Packs waiting behind each seat (DESIGN: "Waiting packs queue visibly behind each seat"). */
  waiting: Record<SeatId, number>;
  reducedMotion: boolean;
}

/** Gestures the draft surface reports (DESIGN "Pre-game", Drafting interaction). */
export interface DraftSurfaceEvents {
  mark(cards: InstanceId[]): void;
  confirm(cards: InstanceId[]): void;
  /** Grid draft: a row or column was chosen. */
  takeLine(line: 'row' | 'col', index: 0 | 1 | 2): void;
  inspect(ref: CardRef): void;
}

/** Options for createDraftSurface (DESIGN "Pre-game: draft, sealed and deck building", Drafting interaction; M2-P4). */
export interface DraftSurfaceOptions {
  game: GameDefinition;
  layout: TableLayout;
  viewerSeat: SeatId | null;
  theme: Theme;
  faces: FaceSource;
  events: Partial<DraftSurfaceEvents>;
}

/** A live draft surface (DESIGN "Pre-game", Drafting interaction: pack fan or grid, pool area, waiting packs). */
export interface DraftSurface {
  update(state: TableState, view: DraftSurfaceView): void;
  setTheme(theme: Theme): void;
  readonly camera: CameraControls;
  /** Draft cards on screen for the debug hook (pack cards by instance id, pool cards as `pool:<index>`). */
  readonly debug: { cards(): DebugCard[] };
  dispose(): void;
}

/** Create the draft surface in `host` (DESIGN "Pre-game", Drafting interaction; M2-P4, scene/draft.ts). */
export type CreateDraftSurface = (host: HTMLElement, opts: DraftSurfaceOptions) => DraftSurface;

/** What the builder table shows (DESIGN "Pre-game", Deck building: pool on a private table, deck and sideboard areas, basic-land dispenser). */
export interface BuilderSurfaceView {
  build: DeckBuild;
  reducedMotion: boolean;
}

/** Gestures the builder table reports (DESIGN "Pre-game", Deck building: the same gestures as play). */
export interface BuilderSurfaceEvents {
  /** The build changed: a card moved between deck and sideboard, a basic was dispensed or removed, cards were re-laid. */
  change(build: DeckBuild): void;
  inspect(ref: CardRef): void;
}

/** Options for createBuilderSurface (DESIGN "Pre-game: draft, sealed and deck building", Deck building; M2-P5). */
export interface BuilderSurfaceOptions {
  theme: Theme;
  faces: FaceSource;
  /** Card data for sorting (colour, mana value, type); null while loading. */
  card(ref: CardRef): CardData | null;
  events: Partial<BuilderSurfaceEvents>;
}

/** The builder table (DESIGN "Pre-game", Deck building: builder table). */
export interface BuilderSurface {
  update(view: BuilderSurfaceView): void;
  /** Sort into cascade columns by `key`, stable; a second sort by the same key restores the previous layout (PLAN M2-P5: sorting is stable and reversible). */
  sort(key: BuilderSort): void;
  /** Basic-land dispenser: add one basic of the given printing to the deck (unlimited). */
  dispenseBasic(ref: CardRef): void;
  setTheme(theme: Theme): void;
  readonly camera: CameraControls;
  readonly debug: { cards(): DebugCard[] };
  dispose(): void;
}

/** Create the builder table in `host` (DESIGN "Pre-game", Deck building; M2-P5, scene/builder.ts). */
export type CreateBuilderSurface = (host: HTMLElement, opts: BuilderSurfaceOptions) => BuilderSurface;
