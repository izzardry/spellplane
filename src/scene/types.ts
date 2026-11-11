/**
 * The TableScene API (DESIGN "Camera and navigation", "Card manipulation", "Themes and rendering",
 * "Specification: geometry, layout and motion"). Implementer: M0-P3; consumers: M0-P4 (HUD), M0-P7 (session wiring).
 * The scene is a pure view of TableState plus local ViewState; it changes shared state only through `dispatch`.
 */
import type { ActionDraft } from '../core/actions';
import type { Anchor, CardRef, InstanceId, Line, PileId, Pose, SeatId, TableState, ZoneId } from '../core/types';
import type { FaceSource } from '../data/types';
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
