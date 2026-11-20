/**
 * The TableScene API (DESIGN "Camera and navigation", "Card manipulation", "Themes and rendering",
 * "Specification: geometry, layout and motion"). Implementer: M0-P3; consumers: M0-P4 (HUD), M0-P7 (session wiring).
 * The scene is a pure view of TableState plus local ViewState; it changes shared state only through `dispatch`.
 */
import type { ActionDraft } from '../core/actions';
import type { Anchor, CardRef, ClipId, DeckBuild, DraftCard, InstanceId, Line, PackId, PileId, Pose, SeatColourIndex, SeatId, TableState, ZoneId } from '../core/types';
import type { DragGroup } from '../core/clips';
import type { CardData, FaceSource } from '../data/types';
import type { GameDefinition, TableLayout, TextureSource } from '../games/types';
import type { CardDressing, MaterialSpec, PostSettings, QualityId, QualityLevel, SoundCue, Theme, ThemeId } from '../themes/types';
import type { MotionIntensity } from '../store/types';
import type { Material, Texture } from 'three';
import type { Pass } from 'three/examples/jsm/postprocessing/Pass.js';
import { CAMERA, GEOMETRY } from '../core/geometry';

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
  /**
   * Hold-to-talk hook (DESIGN "Chat and voice", Talk modes: "Talk while I hold or drag"; PLAN Milestone 6, owner
   * decisions, Hold-to-talk): 'start' once a mouse-button or finger press on the table has lasted HOLD_PRESS_TALK_MS
   * without being released (card drags, line drags, box selection, camera drags, holding to clip), 'end' when that press
   * ends (release, cancel, blur, pointer capture lost). Never for a quick click or tap, at most one 'start' per press,
   * and an 'end' only after a 'start'. The HUD forwards it to VoiceControls.pressHeld when the setting is on. Added by
   * M6-C; implementer: M6-P2 (scene/presence.ts and the press paths of scene/table-scene.ts).
   */
  pressHold?(phase: 'start' | 'end', kind: TablePressKind): void;
  /**
   * A clip's context menu was asked for (right-click or long-press on the clip; PLAN Milestone 6, owner decisions,
   * Paperclips: "its context menu … Remove clip"). Added by M6-C; implementer: M6-P1.
   */
  clipMenu?(clip: ClipId, at: ScreenPoint): void;
  /**
   * The camera tilt started, changed target or settled (PLAN Milestone 7, Owner decisions, One continuous tilt; DESIGN
   * "Camera and navigation"). Never once per frame: 'start' when a move begins, 'change' when its target changes (a new
   * wheel step, a preset), 'end' when it settles; a HUD handle that follows the camera live reads `camera.tilt()` in its
   * own animation frame and moves with a CSS transform, never through per-frame Svelte state. Added by M7-C; M7-P3.
   */
  tilt?(e: TiltEvent): void;
  /**
   * Where the selection strip sits (PLAN Milestone 7, Owner decisions, Play without memorising keys: "on-card and
   * on-pile actions"; docs/design/m7-hud-proposal.md, Card action strip): the selection's screen box, reported when the
   * selection changes and when the camera or a drag settles; null while there is no selection or while the camera or
   * the selected cards move (the strip hides, then returns). Added by M7-C; M7-P5.
   */
  selectionAnchor?(anchor: SelectionAnchor | null): void;
  /**
   * The pointer rests on, or a tap lands on, a zone pile (library, graveyard, exile, command) or a squared pile; null
   * when it leaves (docs/design/m7-hud-proposal.md, Pile actions: "Hover or tap a pile"). The HUD shows PILE_ACTIONS
   * beside it. Added by M7-C; M7-P5.
   */
  pileHover?(hover: PileHover | null): void;
  /**
   * A life scrub on a seat's life total drawn in the scene (docs/design/m7-hud-proposal.md, Life steppers; PLAN
   * Milestone 7, Owner decisions: "life totals you click or scrub"): 'start' on press, 'move' with the whole steps
   * scrubbed so far, 'end' on release (the HUD dispatches one life change of `steps`), 'cancel' on Esc or a lost
   * pointer. The scene reports it only where it draws life; the HUD's DOM plates scrub by themselves with LIFE_SCRUB.
   * Added by M7-C; M7-P5.
   */
  lifeScrub?(e: LifeScrubEvent): void;
  /**
   * The screen anchors of each seat's edge, where the life plates sit (docs/design/m7-hud-proposal.md, Opponent plate:
   * "at the opponent's edge of the table"; PLAN M7-P2 "life plates at seat edges"), reported after a layout change and
   * whenever the camera settles, never per frame. Added by M7-C; M7-P3 reports, M7-P2 places the plates.
   */
  seatAnchors?(anchors: SeatAnchor[]): void;
  /** "Look, do not touch" was switched on or off (TableScene.setReadOnly): the HUD hides its coach marks and on-card controls while on. */ // [M7-P5]
  readOnly?(on: boolean): void;
}

/** What a held table press is doing (PLAN Milestone 6, owner decisions, Hold-to-talk). Added by M6-C. */
export type TablePressKind = 'card' | 'line' | 'marquee' | 'camera' | 'clip' | 'other';

/**
 * A press on the table held at least this long talks under "Talk while I hold or drag"; quicker clicks and taps never
 * do (PLAN Milestone 6, owner decisions, Hold-to-talk: "held longer than 200 ms"). Added by M6-C.
 */
export const HOLD_PRESS_TALK_MS = 200;

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
  /** Added by M7-C: the tilt to start at (Settings.tilt); absent means the theme's camera tilt. Wins over `rig`. M7-P3. */
  tilt?: Tilt;
  /** Added by M7-C: motion intensity and reduced motion (Settings.motion resolved by resolveMotion); absent means full motion unless ViewState.reducedMotion. M7-P4. */
  motion?: MotionSettings;
  /** Added by M8-C (m7-adjustments.md section 2): look, do not touch: the scene proposes no action; camera, hover, inspect and selection still work. M7-P5. */
  readOnly?: boolean;
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

// ---------------------------------------------------------------------------------------------------------------------
// One continuous tilt (PLAN Milestone 7, Owner decisions after the first design round, One continuous tilt: "One tilt
// control moves continuously and smoothly from first person … to bird's-eye … with the hand kept in reach throughout; it
// works the same in all three looks, by mouse, touch and keyboard"). Added by M7-C. The tilt replaces the two-rig switch
// at the API level: the HUD, gestures and keys drive `setTilt`; `setRig` stays for older callers and maps onto it
// (birdseye = 1, ego = 0). M7-P3 implements the rig (scene/camera/*); until then the table scene maps a tilt onto the
// nearer rig.
// ---------------------------------------------------------------------------------------------------------------------

/** A camera tilt in [0, 1]: 0 first person (seated, looking across the table), 1 bird's-eye (straight down) (PLAN Milestone 7, Owner decisions, One continuous tilt). Added by M7-C. */
export type Tilt = number;

/** Named stops on the tilt (PLAN Milestone 7, gate M7-G: "first person, mid-tilt and bird's-eye"). Added by M7-C. */
export type TiltPresetId = 'firstPerson' | 'midTilt' | 'birdseye';

/** A named stop on the tilt (PLAN Milestone 7, Owner decisions, One continuous tilt; gate M7-G). Added by M7-C. */
export interface TiltPreset {
  id: TiltPresetId;
  tilt: Tilt;
  label: string;
}

/** The tilt presets, first person to bird's-eye (PLAN Milestone 7, gate M7-G screenshots). Added by M7-C; M7-P3 may tune `midTilt`. */
export const TILT_PRESETS: readonly TiltPreset[] = [
  { id: 'firstPerson', tilt: 0, label: 'First person' },
  { id: 'midTilt', tilt: 0.5, label: 'Leaning in' },
  { id: 'birdseye', tilt: 1, label: "Bird's-eye" },
];

/** The tilt of a rig's view (DESIGN "Camera and navigation": bird's-eye looks straight down, ego from the seat). Added by M7-C. */
export function tiltForRig(rig: CameraRig): Tilt {
  return rig === 'birdseye' ? 1 : 0;
}

/** The rig a tilt is nearer to, for callers that still speak rigs (debug `rig()`, DebugCamera.rig). Added by M7-C. */
export function rigForTilt(t: Tilt): CameraRig {
  return t >= 0.5 ? 'birdseye' : 'ego';
}

/** Clamp a tilt into [0, 1]; a non-finite value is 1 (bird's-eye). Added by M7-C. */
export function clampTilt(t: number): Tilt {
  return Number.isFinite(t) ? Math.min(1, Math.max(0, t)) : 1;
}

/**
 * Where the old perspective key (P, "Switch perspective"; DESIGN "Input and interaction design", View) sends the tilt:
 * from the upper half to first person, from the lower half to bird's-eye (PLAN Milestone 7, Owner decisions: keys stay
 * as optional accelerators). Added by M7-C.
 */
export function perspectiveToggleTilt(current: Tilt): Tilt {
  return current >= 0.5 ? 0 : 1;
}

/** One key step of the tilt (keyboard accelerators, PLAN M7-P3 "keys"), and one wheel notch with the tilt modifier. Added by M7-C; M7-P3 may tune. */
export const TILT_STEP = 0.125;

/** What moved the tilt (PLAN M7-P3: "drag, wheel, pinch or two-finger swipe, a HUD handle, keys"). Added by M7-C. */
export type TiltSource = 'drag' | 'wheel' | 'touch' | 'handle' | 'key' | 'preset' | 'theme' | 'api';

/** Options of a tilt change (DESIGN "Camera and navigation", Switching: the point under the cursor stays put; reduced motion cuts). Added by M7-C. */
export interface SetTiltOptions {
  /** false cuts instead of easing (reduced motion always cuts). */
  animate?: boolean;
  /** Screen point whose table point stays fixed while the tilt moves; absent means the viewport centre. */
  anchor?: ScreenPoint;
  /** What asked for it (reported back in TiltEvent); absent means 'api'. */
  source?: TiltSource;
}

/** A tilt event (SceneEvents.tilt; PLAN Milestone 7, Owner decisions, One continuous tilt). Added by M7-C. */
export interface TiltEvent {
  phase: 'start' | 'change' | 'end';
  /** The tilt now. */
  tilt: Tilt;
  /** Where it is going (equal to `tilt` on 'end'). */
  target: Tilt;
  source: TiltSource;
}

/** The tilt part of the table camera (PLAN Milestone 7, Owner decisions, One continuous tilt; PLAN M7-P3). Added by M7-C; stubbed by the table scene until M7-P3. */
export interface TiltControls {
  /** The current tilt (mid-move it is the eased value). */
  tilt(): Tilt;
  /** Move the tilt to `t` (clamped), easing unless `animate` is false or motion is reduced. */
  setTilt(t: Tilt, opts?: SetTiltOptions): void;
  /** Move the tilt by `dt` from its current target (wheel, keys, drag). */
  tiltBy(dt: number, opts?: SetTiltOptions): void;
  /** The named stops (TILT_PRESETS unless the theme moves `midTilt`). */
  tiltPresets(): readonly TiltPreset[];
}

/** The table scene's camera controls, a superset of the surfaces' (DESIGN "Camera and navigation"). Added by M4-C; the additions are M4-P1's. */
export interface TableCameraControls extends CameraControls, TiltControls {
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
  /**
   * Added by M7-C: frames drawn since the scene was created (PLAN Milestone 7, gate M7-G: "Idle frames stop (render on
   * demand)"): a test reads it twice across an idle wait and expects no change. Implemented by the table scene.
   */
  framesDrawn?(): number;
}

/** The rig part of the debug hook (`window.__spellplane.rig`): camera rig, blend and follow toggles. Registered by the table scene; M4-P1's. Added by M4-C. */
export interface RigDebug {
  rig(): CameraRig;
  setRig(rig: CameraRig, opts?: SetRigOptions): void;
  blend(): CameraBlendState | null;
  follow(): FollowOptions;
  setFollow(next: Partial<FollowOptions>): void;
  pose(): CameraPose;
  /** Added by M7-C: the camera tilt (PLAN Milestone 7, One continuous tilt); stubbed from the rig until M7-P3. */
  tilt?(): Tilt;
  /** Added by M7-C: move the tilt, like TiltControls.setTilt. */
  setTilt?(t: Tilt, opts?: SetTiltOptions): void;
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
  /** Added by M7-C: the camera tilt, 0 first person to 1 bird's-eye (PLAN Milestone 7, One continuous tilt); absent before M7-P3 reports it. */
  tilt?: Tilt;
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
  /** Added by M6-C: paperclips, the hold ring, the drag group and the drop preview (M6-P1). Optional until M6-P1 draws them. */
  clips?(): ClipDebugState;
  /** Added by M7-C: card motion and the frames it holds (PLAN M7-P4; gate M7-G "Idle frames stop"). Optional until M7-P4. */
  motion?(): MotionDebugState;
  /** Added by M7-C: the on-card and on-pile affordances the scene reports (PLAN M7-P5). Optional until M7-P5. */
  affordances?(): AffordanceDebugState;
}

/**
 * A paperclip as the debug hook reports it (PLAN Milestone 6, owner decisions, Paperclips). Added by M6-C; M6-P1.
 */
export interface DebugClip {
  id: ClipId;
  cards: InstanceId[];
  /** Where the clip lies on the table (its centre, mm). */
  at: { x: number; y: number };
  /** Its screen rectangle; null while off screen. */
  screen: DOMRect | null;
}

/**
 * Where a drag in progress would land (PLAN Milestone 6, owner decisions, Preview: "the landing spot of every snap
 * (pile, cascade, tuck) is shown as a ghost outline, and a tuck also shows a small attach glyph"). Added by M6-C; M6-P1.
 */
export interface DropPreview {
  kind: 'squared' | 'cascade' | 'tuck';
  /** The card the drop snaps to (the host of a tuck). */
  target: InstanceId;
  /** The ghost outline's pose. */
  pose: Pose;
}

/** The clip part of the scene's debug parts (PLAN Milestone 6 acceptance: clips, carry and attach asserted through the hook). Added by M6-C; M6-P1. */
export interface ClipDebugState {
  clips: DebugClip[];
  /** A press-and-hold in progress on an overlap: its progress 0..1 (the ring shows from CLIP.ringFromMs), else null. */
  hold: { at: ScreenPoint; progress: number; cards: InstanceId[] } | null;
  /** The group a drag in progress moves, else null. */
  drag: DragGroup | null;
  /** The snap the drag in progress would make, else null. */
  preview: DropPreview | null;
}

// ---------------------------------------------------------------------------------------------------------------------
// Card feel and on-demand animation (PLAN Milestone 7, Owner decisions after the first design round, Almost haptic card
// handling: "they lift on pickup, sway with movement, are pulled into snap slots as they near them, settle with a small
// bounce, and every common move has a short animation and sound … Reduced motion is respected"; DESIGN "Specification:
// geometry, layout and motion", Motion). Added by M7-C; M7-P4 implements (scene/motion.ts, scene/cards.ts, scene/snap.ts).
// ---------------------------------------------------------------------------------------------------------------------

/**
 * The card feel parameters (PLAN Milestone 7, Owner decisions, Almost haptic card handling; DESIGN "Specification:
 * geometry, layout and motion": lift 12, tilt 4°, spring 320/36/1, snap radius 12). mm, degrees, ms. Added by M7-C.
 */
export interface CardFeel {
  /** Height a picked-up card rises to, mm (DESIGN geometry: lift while dragged 12). */
  liftMm: number;
  /** Time the card takes to rise on pickup and to come down on drop, ms. */
  liftMs: number;
  /** Sway: the card leans into its motion, `degPerMmPerS` of lean per mm/s of pointer speed, at most `maxDeg`, relaxing with `relaxMs`. */
  sway: { maxDeg: number; degPerMmPerS: number; relaxMs: number };
  /** The spring a held card follows the pointer with (a light lag, never a rubber band). */
  follow: { stiffness: number; damping: number; mass: number };
  /** Magnetic snap: within `radiusMm` of a snap slot the card is pulled toward it by `strength` (0 none, 1 onto it); the slot's ghost shows from `previewMm`. */
  magnet: { radiusMm: number; strength: number; previewMm: number };
  /** Settle: the overshoot of the landing bounce as a fraction of the lift (0 none) and how long the card settles, ms. */
  settle: { bounce: number; ms: number };
  /** Durations of the move animations, ms (draw from library to hand, a shuffle's riffle, a play from hand, a card going to a pile). */
  durations: { draw: number; shuffle: number; play: number; toPile: number; attach: number; clip: number };
}

/** The default card feel (DESIGN "Specification: geometry, layout and motion" for lift, tilt, spring and snap radius; the rest M7-C's choice, tuned by M7-P4). Added by M7-C. */
export const DEFAULT_CARD_FEEL: CardFeel = {
  liftMm: GEOMETRY.dragLift,
  liftMs: 120,
  sway: { maxDeg: GEOMETRY.dragTiltDeg * 2, degPerMmPerS: 0.01, relaxMs: 180 },
  follow: { stiffness: 320, damping: 36, mass: 1 },
  magnet: { radiusMm: GEOMETRY.snapRadius * 2, strength: 0.35, previewMm: GEOMETRY.snapRadius * 3 },
  settle: { bounce: 0.15, ms: 260 },
  durations: { draw: 320, shuffle: 480, play: 260, toPile: 280, attach: 220, clip: 160 },
};

/**
 * How strongly the viewer wants motion (Settings.motion): 'system' follows prefers-reduced-motion, 'full' all feel,
 * 'subtle' half the sway and bounce and shorter animations, 'reduced' cuts (DESIGN "Specification: geometry, layout and
 * motion": "With reduced motion, all of these are cuts"). Re-exported from store/types.ts. Added by M7-C.
 */
export type { MotionIntensity } from '../store/types';

/** The resolved motion setting the scene applies (PLAN Milestone 7, Owner decisions: "Reduced motion is respected"). Added by M7-C. */
export interface MotionSettings {
  /** Every change is a cut, no sway, no bounce. */
  reduced: boolean;
  /** Scale of sway, bounce and animation durations, 0..1 (0 with `reduced`). */
  scale: number;
}

/** Resolve the viewer's motion setting against the system's reduced-motion preference (PLAN Milestone 7, Owner decisions: reduced motion respected). Added by M7-C. */
export function resolveMotion(intensity: MotionIntensity, systemReduced: boolean): MotionSettings {
  const level = intensity === 'system' ? (systemReduced ? 'reduced' : 'full') : intensity;
  if (level === 'reduced') return { reduced: true, scale: 0 };
  return { reduced: false, scale: level === 'subtle' ? 0.5 : 1 };
}

/** The card feel a theme asks for, over the defaults, scaled by the motion setting (sway, bounce, durations; reduced: none). Added by M7-C; M7-P4 reads it. */
export function cardFeel(theme: { feel?: Partial<CardFeel> }, motion: MotionSettings): CardFeel {
  const f: CardFeel = { ...DEFAULT_CARD_FEEL, ...theme.feel };
  const k = motion.reduced ? 0 : motion.scale;
  const d = f.durations;
  return {
    ...f,
    sway: { ...f.sway, maxDeg: f.sway.maxDeg * k },
    settle: { ...f.settle, bounce: f.settle.bounce * k, ms: f.settle.ms * k },
    liftMs: f.liftMs * k,
    durations: { draw: d.draw * k, shuffle: d.shuffle * k, play: d.play * k, toPile: d.toPile * k, attach: d.attach * k, clip: d.clip * k },
  };
}

/** The card animations the scene plays (PLAN Milestone 7, Owner decisions: "draw, shuffle, tap and untap, play, to graveyard, attach, clip"). Added by M7-C. */
export type CardAnimationKind = 'draw' | 'shuffle' | 'tap' | 'untap' | 'play' | 'toGraveyard' | 'toExile' | 'toHand' | 'toLibrary' | 'attach' | 'detach' | 'clip' | 'unclip' | 'flip' | 'counter';

/**
 * A request to animate cards (TableScene.animate; PLAN M7-P4). Most animations start from the scene itself when state
 * changes; the HUD asks for the ones it starts (a draw from the hand fan's side, a shuffle). Added by M7-C.
 */
export interface CardAnimationRequest {
  kind: CardAnimationKind;
  /** The cards; a shuffle names none (the library pile animates). */
  cards: InstanceId[];
  /** The zone the cards come from and go to, when it is a pile (draw: library to hand; shuffle: the library). */
  from?: ZoneId | null;
  to?: ZoneId | null;
  /** The sound cue to play with it; absent means the kind's own cue (M7-P4's table), null for none. */
  cue?: SoundCue | null;
}

/** A hold on the frame loop (FrameScheduler.hold): frames are drawn until it is released. Added by M7-C. */
export interface FrameHold {
  release(): void;
}

/**
 * Render on demand (PLAN Milestone 7, A0 steps: "render on demand"; gate M7-G: "Idle frames stop"): the scene draws a
 * frame only when something changed. Anything that animates asks for frames here instead of running its own loop.
 * Added by M7-C; M7-P4 implements it on the table scene's tick (keeping M7-A0's frame meter and on-demand behaviour).
 */
export interface FrameScheduler {
  /** Draw one more frame (something changed once). */
  invalidate(): void;
  /** Keep drawing until the hold is released, or until `active` returns false (checked once per frame). `reason` names it in the debug hook. */
  hold(reason: string, active?: () => boolean): FrameHold;
}

/** Card motion as the debug hook reports it (PLAN M7-P4; gate M7-G: a magnetic snap and a draw animation). Added by M7-C. */
export interface MotionDebugState {
  motion: MotionSettings;
  /** Animations running now, oldest first. */
  running: { kind: CardAnimationKind; cards: InstanceId[]; progress: number }[];
  /** Reasons holding frames now (FrameScheduler.hold); empty when the scene is idle. */
  holds: string[];
  /** The held card's lift (mm) and sway (degrees) during a drag, else null. */
  held: { card: InstanceId; liftMm: number; swayDeg: number } | null;
  /**
   * The snap slot pulling the dragged card (its kind and pull 0..1), else null. M7-P4 added 'zone' (a library, graveyard
   * or exile pile under the pointer) and 'hand' (an avatar, or the hand fan, which makes room: pull 1).
   */
  magnet: { kind: DropPreview['kind'] | 'align' | 'zone' | 'hand'; target: InstanceId | null; pull: number } | null;
}

// ---------------------------------------------------------------------------------------------------------------------
// Affordances (PLAN Milestone 7, Owner decisions after the first design round, Play without memorising keys: "Every
// everyday action is reachable by direct manipulation with visible affordances: drag, drop, double-click or tap,
// on-card and on-pile actions, life totals you click or scrub"; docs/design/m7-hud-proposal.md). Added by M7-C; M7-P5.
// ---------------------------------------------------------------------------------------------------------------------

/** A screen rectangle in CSS px relative to the viewport (the HUD positions DOM over it). Added by M7-C. */
export interface ScreenRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The selection strip's anchor (SceneEvents.selectionAnchor; docs/design/m7-hud-proposal.md, Card action strip: "A small strip above the card"). Added by M7-C. */
export interface SelectionAnchor {
  cards: InstanceId[];
  /** The selection's screen box. */
  rect: ScreenRect;
  /** The zone the selection is in when it is one zone (it picks the strip's actions), else null. */
  zone: ZoneId | null;
  /** Place the strip above the box (false: below, when the box is at the top of the screen). */
  above: boolean;
}

/** A pile under the pointer (SceneEvents.pileHover; docs/design/m7-hud-proposal.md, Pile actions). Added by M7-C. */
export interface PileHover {
  /** The zone pile (library, graveyard, exile, command), or null for a squared pile on the battlefield. */
  zone: ZoneId | null;
  /** The squared pile, or null for a zone pile. */
  pile: PileId | null;
  /** The pile's owner, null for table zones. */
  owner: SeatId | null;
  count: number;
  rect: ScreenRect;
  /** How it was found: the mouse resting on it, or a tap (touch keeps the actions until another tap). */
  via: 'hover' | 'tap';
}

/** The actions a pile offers on hover or tap (docs/design/m7-hud-proposal.md, Pile actions: "Library: Draw · Shuffle · Search…; Graveyard and Exile: Open"). Added by M7-C. */
export type PileActionId = 'draw' | 'drawN' | 'shuffle' | 'search' | 'open' | 'mill' | 'revealTop';

/** Pile actions by zone kind, the first is the double-click or tap action (docs/design/m7-hud-proposal.md: "Double-click a library draws"). Added by M7-C; M7-P5 may extend. */
export const PILE_ACTIONS: Readonly<Record<'library' | 'graveyard' | 'exile' | 'command' | 'pile', readonly PileActionId[]>> = {
  // M7-P5: Reveal top joins the library's actions (PLAN M7-P5: "Draw, Shuffle, Search, Reveal top").
  library: ['draw', 'shuffle', 'search', 'revealTop'],
  graveyard: ['open'],
  exile: ['open'],
  command: ['open'],
  pile: ['open'],
};

/** A life scrub (SceneEvents.lifeScrub; docs/design/m7-hud-proposal.md, Life steppers). Added by M7-C. */
export interface LifeScrubEvent {
  seat: SeatId;
  phase: 'start' | 'move' | 'end' | 'cancel';
  /** Whole life points scrubbed since 'start' (up or right is positive). */
  steps: number;
}

/** Life scrubbing (docs/design/m7-hud-proposal.md, Life steppers; PLAN Milestone 7, Owner decisions: "life totals you click or scrub"): one point per `pxPerPoint` of drag, a press shorter than `clickMs` and `slopPx` is a click. Added by M7-C; M7-P5 may tune. */
export const LIFE_SCRUB = { pxPerPoint: 12, slopPx: 6, clickMs: 250 } as const;

/** A seat's edge on screen, where its life plate sits (SceneEvents.seatAnchors; docs/design/m7-hud-proposal.md, Opponent plate). Added by M7-C. */
export interface SeatAnchor {
  seat: SeatId;
  /** The midpoint of the seat's table edge on screen, clamped into the viewport; null when the edge is behind the camera. */
  at: ScreenPoint | null;
  /** The screen direction pointing out of the table at that edge, degrees clockwise from up (0: plate above the edge). */
  outwardDeg: number;
}

/** The affordances as the debug hook reports them (PLAN M7-P5; gate M7-G: a game played with no key pressed). Added by M7-C. */
export interface AffordanceDebugState {
  selection: SelectionAnchor | null;
  pile: PileHover | null;
  /** A life scrub in progress, else null. */
  scrub: LifeScrubEvent | null;
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
  /**
   * Take over a clip dragged out of the HUD's clip tray at a screen point (PLAN Milestone 6, owner decisions,
   * Paperclips: "drag a clip from a clip tray button in the HUD toolbar onto an overlap"); dropped where two or more
   * cards overlap it clips them, elsewhere it vanishes. Added by M6-C; implementer: M6-P1 (optional until it lands).
   */
  startClipDrag?(x: number, y: number): void;
  /** Every card under a screen point, top first (the cards a clip there would pin). Added by M6-C; implementer: M6-P1. */
  cardsAt?(x: number, y: number): InstanceId[];
  /** The paperclip under a screen point, or null. Added by M6-C; implementer: M6-P1. */
  clipAt?(x: number, y: number): ClipId | null;
  /**
   * Play a card animation (PLAN Milestone 7, Owner decisions, Almost haptic card handling: "every common move has a
   * short animation and sound"); the scene draws frames until it ends, then stops (render on demand). With reduced
   * motion it cuts. Added by M7-C; implementer: M7-P4 (optional until it lands).
   */
  animate?(req: CardAnimationRequest): void;
  /** Apply the viewer's motion setting without a rebuild (Settings.motion). Added by M7-C; implementer: M7-P4 (optional until it lands). */
  setMotion?(motion: MotionSettings): void;
  /** Added by M8-C (m7-adjustments.md section 2): switch "look, do not touch" on or off. No-op until M7-P5. */
  setReadOnly?(on: boolean): void;
  /** Ask for frames: anything that moves outside the scene's own state holds them (PLAN Milestone 7, A0: "render on demand"). Added by M7-C; implementer: M7-P4 (optional until it lands). */
  readonly frames?: FrameScheduler;
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
