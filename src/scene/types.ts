/**
 * The TableScene API (DESIGN "Camera and navigation", "Card manipulation", "Themes and rendering",
 * "Specification: geometry, layout and motion"). Implementer: M0-P3; consumers: M0-P4 (HUD), M0-P7 (session wiring).
 * The scene is a pure view of TableState plus local ViewState; it changes shared state only through `dispatch`.
 */
import type { ActionDraft } from '../core/actions';
import type { Anchor, CardRef, DeckBuild, DraftCard, InstanceId, Line, PackId, PileId, Pose, SeatColourIndex, SeatId, TableState, ZoneId } from '../core/types';
import type { CardData, FaceSource } from '../data/types';
import type { GameDefinition, TableLayout, TextureSource } from '../games/types';
import type { CardDressing, MaterialSpec, PostSettings, QualityId, QualityLevel, Theme, ThemeId } from '../themes/types';
import type { Material, Texture } from 'three';
import type { Pass } from 'three/examples/jsm/postprocessing/Pass.js';
import { CAMERA } from '../core/geometry';

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
  /** Captions to draw (DESIGN "Chat and voice", Placement). Added by M3-C; absent means none; drawn by M3-P4 (scene/captions.ts). */
  captions?: SceneCaption[];
  /**
   * The card with keyboard focus (DESIGN "Input and interaction design", Accessibility: "every card action is reachable
   * from the keyboard by cycling focus through cards in a zone"), drawn with a focus ring distinct from hover and
   * selection; the keymap acts on it like on a hovered card. Added by M5-C; absent means none; M5-P4 (ui/a11y/*).
   */
  focused?: InstanceId | null;
}

/**
 * A caption bubble as the scene draws it (DESIGN "Chat and voice", Dictation and captions: a speech bubble anchored to
 * the card or stack item the speaker last acted on or is hovering, in the speaker's seat colour, upright for every
 * viewer, growing with interim words and fading after the final result; with no card context beside the speaker's
 * avatar; "Specification: geometry, layout and motion", Screen layer: at most 280 px wide and three lines). Added by
 * M3-C; the HUD maps voice/types.ts Caption to it.
 */
export interface SceneCaption {
  id: string;
  text: string;
  final: boolean;
  /** A card or stack item; a seat anchor (or null, or an anchor no longer on the table) places it beside that seat's avatar. */
  anchor: Anchor | null;
  /** The speaking seat, whose avatar is the fallback anchor; null for a spectator (no avatar: the bubble sits at the table's near edge). */
  seat: SeatId | null;
  /** Seat colour index of the speaker (theme seat colours); null for a spectator's neutral colour. */
  colour: SeatColourIndex | null;
  /** 1 while shown, falling to 0 as it fades. */
  opacity: number;
}

/** A caption as the debug hook reports it (DESIGN "Chat and voice", Placement; PLAN M3-P4: the caption is anchored to the last-touched card on every page). Added by M3-C. */
export interface DebugCaption {
  id: string;
  text: string;
  final: boolean;
  /** What it is attached to after the fallback: the card or stack item, or the speaker's seat (its avatar). */
  anchoredTo: Anchor | null;
  /** The bubble's screen rectangle; null while off screen. */
  screen: DOMRect | null;
}

/** Scene callbacks to the HUD (DESIGN "Input and interaction design"). */
export interface SceneEvents {
  hover(card: InstanceId | null): void;
  contextMenu(card: InstanceId | null, at: ScreenPoint): void;
  inspect(card: InstanceId): void;
  pileOpen(id: ZoneId | PileId): void;
  selectionChange(ids: InstanceId[]): void;
  /**
   * A long-press on a card (touch): open the radial menu at `at` (DESIGN "Input and interaction design", Touch;
   * ui/touch/actions.ts RADIAL_SLOTS). A drag after it draws a line instead and the scene calls it with `card` null to
   * close the menu. Added by M5-C; M5-P1.
   */
  radialMenu?(card: InstanceId | null, at: ScreenPoint): void;
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
  /** v2 (M4-C): the viewer's quality setting (Settings.quality); absent means 'high'. Resolved per theme with qualityLevel (themes/types.ts). */
  quality?: QualityId;
  /** v2 (M4-C): the viewer's follow toggles (Settings.followStack, followActive); absent means both off. */
  follow?: FollowOptions;
  /** v2 (M4-C): the rig to start in; absent means the theme's camera.defaultRig. */
  rig?: CameraRig;
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
  setRig(rig: CameraRig, opts?: SetRigOptions): void;
  rig(): CameraRig;
}

// ---------------------------------------------------------------------------------------------------------------------
// Camera rigs, materials, post-processing and quality (DESIGN "Camera and navigation", "Themes and rendering",
// "Specification: geometry, layout and motion", Camera rigs). Added by M4-C. Rigs and blending are M4-P1's
// (scene/camera/*); materials, post-processing and quality are M4-P2's (scene/materials.ts, post.ts, quality.ts).
// ---------------------------------------------------------------------------------------------------------------------

/**
 * Ego rig parameters (DESIGN "Specification: geometry, layout and motion", Camera rigs: field of view 45°, 260 behind
 * the viewer's table edge, 620 above the table, pitched 35°, pitch 25°–60°; "Camera and navigation", Ego perspective:
 * lean, dolly and pitch within limits, never below the table edge or behind the seat). mm and degrees. Added by M4-C.
 */
export interface EgoRigParams {
  fovDeg: number;
  /** Seat position behind the viewer's table edge. */
  behindEdge: number;
  /** Seat eye height above the table. */
  height: number;
  /** Default pitch below horizontal. */
  pitchDeg: number;
  minPitchDeg: number;
  maxPitchDeg: number;
  /** Largest sideways lean (pan) from the seat's centre line, each way. */
  leanMm: number;
  /** Dolly along the view ray toward the table: 0 at the seat, at most `maxDollyMm` forward; the camera never moves behind the seat. */
  maxDollyMm: number;
  /** Lowest camera height above the table plane; the camera never passes below the table edge. */
  minHeight: number;
}

/** Ego rig defaults from the geometry spec (DESIGN "Specification: geometry, layout and motion", Camera rigs); lean, dolly and minimum height are M4-C's choice (docs/DECISIONS.md). */
export const DEFAULT_EGO_RIG: EgoRigParams = {
  fovDeg: CAMERA.ego.fovDeg,
  behindEdge: CAMERA.ego.behindEdge,
  height: CAMERA.ego.height,
  pitchDeg: CAMERA.ego.pitchDeg,
  minPitchDeg: CAMERA.ego.minPitchDeg,
  maxPitchDeg: CAMERA.ego.maxPitchDeg,
  leanMm: 400,
  // From the raised seat (M5-P7) a dolly of 1200 along the 35° view ray still comes down to about 170 mm, as close as
  // the spec's seat came with 700.
  maxDollyMm: 1200,
  minHeight: 120,
};

/**
 * A camera pose in table space (DESIGN "Camera and navigation", Switching: "interpolating position, tilt and field of
 * view"): position and look-at target as [x, y, z] mm (table x, y in the canonical frame, z up), field of view and pitch
 * below horizontal in degrees (90 = straight down). Both rigs reduce to one; the blend interpolates two. Added by M4-C.
 */
export interface CameraPose {
  position: Vec3;
  target: Vec3;
  fovDeg: number;
  pitchDeg: number;
}

/** Options of a rig switch (DESIGN "Camera and navigation", Switching: the point under the cursor stays under the cursor; reduced motion cuts). Added by M4-C. */
export interface SetRigOptions {
  /** false cuts instead of blending (reduced motion always cuts). */
  animate?: boolean;
  /** Screen point whose table point stays fixed during the blend; absent means the viewport centre. */
  anchor?: ScreenPoint;
}

/** A blend in progress (DESIGN "Camera and navigation", Switching: about 400 ms, continuous). Added by M4-C. */
export interface CameraBlendState {
  from: CameraRig;
  to: CameraRig;
  /** Progress 0..1, after easing. */
  t: number;
  durationMs: number;
  /** The fixed table point and the screen point it is held under, or null. */
  anchor: { table: TablePoint; screen: ScreenPoint } | null;
}

/** The two follow toggles (DESIGN "Camera and navigation", Follow options: both off by default; never while dragging). Added by M4-C. */
export interface FollowOptions {
  /** Ease to include a new stack item when it is off screen. */
  stack: boolean;
  /** Ease to the active player's territory on turn change. */
  activePlayer: boolean;
}

/** The table scene's camera controls, a superset of the surfaces' (DESIGN "Camera and navigation"). Added by M4-C; the additions are M4-P1's. */
export interface TableCameraControls extends CameraControls {
  /** Pitch the ego rig by `deg` (right-drag; positive looks further down), clamped to the rig's limits; no-op in bird's-eye. */
  pitchBy(deg: number): void;
  follow(): FollowOptions;
  setFollow(next: Partial<FollowOptions>): void;
  /** The blend in progress, or null. */
  blend(): CameraBlendState | null;
  /** The camera's current pose. */
  pose(): CameraPose;
}

/**
 * Shared three.js materials built from theme specs (DESIGN "Themes and rendering": card faces near-unlit, tables and
 * sleeves lit; "Card faces are never restyled"). Implemented by M4-P2 (scene/materials.ts). Added by M4-C.
 */
export interface MaterialLibrary {
  /** One shared material per distinct spec (by canonical JSON); `release` when no longer used. */
  get(spec: MaterialSpec): Material;
  /** The card-face material for `map`: near-unlit, shaded at most by `shade` (≤ CARD_FACE_MAX_SHADE), never tinted. */
  cardFace(map: Texture, shade: number): Material;
  /** Sleeve and edge materials of a card box for this dressing. */
  cardSides(dressing: CardDressing): { sleeve: Material; edge: Material };
  release(material: Material): void;
  /** Live materials and the textures they own, for the leak check (PLAN M4-P2: no GPU textures leak after ten theme switches). */
  stats(): { materials: number; textures: number };
  dispose(): void;
}

/**
 * The post-processing chain (DESIGN "Themes and rendering", Lighting and post-processing: bloom, vignette, tone
 * mapping), built from three's examples/jsm passes. With post off (quality or settings) `render` is a plain
 * renderer.render. Implemented by M4-P2 (scene/post.ts). Added by M4-C.
 */
export interface PostPipeline {
  /** True while any pass besides the render and output passes runs. */
  readonly active: boolean;
  /** Apply the theme's bloom and vignette within what the quality level allows. */
  configure(settings: PostSettings, quality: QualityLevel): void;
  /** A theme-specific pass (Wyrm's heat shimmer), inserted before the output pass in ascending `order`; a theme removes its passes on dispose. */
  addPass(id: string, pass: Pass, order?: number): void;
  removePass(id: string): void;
  setSize(width: number, height: number, pixelRatio: number): void;
  render(dt: number): void;
  /** Pass ids in render order (the debug hook's RenderStats.passes). */
  passes(): string[];
  dispose(): void;
}

/** Render statistics for the debug hook (DESIGN "Specification: code interfaces", frameStats; PLAN M4 Performance: draw calls, texture memory, main-thread frame work). Added by M4-C. */
export interface RenderStats extends FrameStats {
  /** renderer.info.render.triangles of the last frame. */
  triangles: number;
  /** renderer.info.memory.textures and .geometries: live GPU objects. */
  textures: number;
  geometries: number;
  /** Compiled shader programs. */
  programs: number;
  /** Post passes in render order, [] with post off. */
  passes: string[];
  shadows: boolean;
  quality: QualityId;
  theme: ThemeId;
}

/** The render part of the debug hook (`window.__spellplane.render`): stats and quality. Registered by the table scene; quality is M4-P2's. Added by M4-C. */
export interface RenderDebug {
  stats(): RenderStats;
  quality(): QualityId;
  /** Apply a quality level at once (no reload). */
  setQuality(id: QualityId): void;
}

/** The rig part of the debug hook (`window.__spellplane.rig`): camera rig, blend and follow toggles. Registered by the table scene; M4-P1's. Added by M4-C. */
export interface RigDebug {
  rig(): CameraRig;
  setRig(rig: CameraRig, opts?: SetRigOptions): void;
  blend(): CameraBlendState | null;
  follow(): FollowOptions;
  setFollow(next: Partial<FollowOptions>): void;
  pose(): CameraPose;
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
  /** Captions on screen (PLAN M3-P4). Added by M3-C; optional until M3-P4 draws them. */
  captions?(): DebugCaption[];
}

/** A live table scene (DESIGN "Specification: code interfaces"; "Themes and rendering"). */
export interface TableScene {
  /** Render this state and view; cheap when nothing changed. */
  update(state: TableState, view: ViewState): void;
  /** Swap theme without reload, state preserved (DESIGN "Themes and rendering"). */
  setTheme(theme: Theme): void;
  /** Change layout or viewer seat (lobby, format change). */
  setLayout(layout: TableLayout, viewerSeat: SeatId | null): void;
  /** v2 (M4-C): apply the viewer's quality setting without reload (DESIGN "Themes and rendering", Renderer); M4-P2. */
  setQuality(id: QualityId): void;
  /** v2 (M4-C): the quality level in use for the current theme; M4-P2. */
  quality(): QualityLevel;
  /** v2 (M4-C): render statistics of the last frame (the debug hook's `render.stats`). */
  renderStats(): RenderStats;
  /**
   * Draw other players' hidden cards with this back instead of the theme's or game's (DESIGN "Card data and images",
   * Card back: the official back is an opt-in setting loaded from backs.scryfall.io); null returns to the default.
   * The source draws the loaded image whole, never cropped or tinted. Added by M5-C; implementer: M5-P5 (optional
   * until it lands).
   */
  setCardBack?(back: TextureSource | null): void;
  readonly camera: TableCameraControls;
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

/**
 * Far-zoom stack (DESIGN "The effect stack", Reading it: "at far zoom it collapses to a count badge that expands on
 * hover"; "Camera and navigation", Level of detail; PLAN Milestone 5, owner decisions, Far-zoom stack: expands on hover,
 * or on tap on touch). The lane collapses while a stack card would be drawn shorter than this on screen, CSS px (its
 * title bar is then too small to read). Value chosen by M5-C (72); tuned by M5-P7 to 36: the fitted three- and
 * four-player views draw stack cards at about 25 px (the M3 gate's unreadable stack) and collapse, while the fitted 1v1
 * and Two-Headed Giant views (about 40-44 px at 1440 × 900 and on the iPad), where the gates of M1 to M4 draw lines
 * from stack items, keep the lane (DECISIONS [M5-P7]). Added by M5-C.
 */
export const STACK_COLLAPSE_CARD_PX = 36;

/** The stack's far-zoom badge for the debug hook (`stackBadge()`; PLAN Milestone 5, owner decisions, Far-zoom stack). Added by M5-C; M5-P7. */
export interface StackBadgeState {
  /** Items on the stack. */
  count: number;
  /** The lane is drawn as the badge (far zoom). */
  collapsed: boolean;
  /** The badge is expanded (hover, or tap on touch) and shows the items readably. */
  expanded: boolean;
  /** The badge's screen rectangle while collapsed, else null. */
  screen: DOMRect | null;
}

/**
 * Viewports at which the default ego view must show the viewer's own pile column (library, graveyard, exile, command)
 * and whole battlefield row (PLAN Milestone 5, owner decisions, Ego framing: "at 1440x900 and on an iPad landscape
 * viewport"; iPad Pro 11" landscape is 1194 × 834 CSS px). M5-P7 reframes the rig (DEFAULT_EGO_RIG, CAMERA.ego values,
 * within DESIGN's limits) until both hold. Added by M5-C.
 */
export const EGO_FRAMING_VIEWPORTS: readonly { width: number; height: number }[] = [
  { width: 1440, height: 900 },
  { width: 1194, height: 834 },
];

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
