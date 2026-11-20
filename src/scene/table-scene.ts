/**
 * The table scene (DESIGN "Camera and navigation", "Card manipulation", "Themes and rendering", "Input and interaction
 * design", "Specification: geometry, layout and motion"). A pure view of TableState plus local ViewState: every
 * gesture becomes ActionDrafts through `opts.dispatch`; the scene never mutates state. Own drags and drops move with
 * the critically damped spring, taps and flips with their timed animations, remote changes ease out over 180 ms.
 *
 * Draw calls (Paper): table plane, hairline zone outlines, zone labels (SDF text under the cards), ghost outlines of
 * displaced cards, all cards (one instanced mesh over texture arrays), SDF text over the cards (one batch, plus its
 * outline pass), displacement markers and connection lines: at most nine, whatever the card count; ping rings add
 * one more while a ping shows.
 *
 * Combat and annotation (M1-P4): dropping another seat's creature onto an attacker blocks it (scene/combat.ts),
 * right-drag from a card draws a line (Shift: a persistent mark), pings ring the pinged thing, settled cards go home
 * with the settle timing.
 *
 * Lit pipeline (M4-P2): two scenes. The world (theme table, lights, card boxes and contact shadows, zone markings,
 * ghost outlines) goes through the theme's post-processing; the overlay (card faces, text over the cards,
 * displacement markers, lines and pings) is drawn after it without tone mapping, so printed faces keep their colours
 * (DESIGN "Card faces are never restyled"). scene/theme-runtime.ts owns the theme, materials, post chain and quality.
 * Paper stays one cheap pass: no lights, boxes, shadows or post, the same draw calls as before.
 */
import { lifecycleRender, registerBaseRender, trackContext, untrackContext } from './lifecycle';
import { track, untrack } from '../util/lifecycle';
import * as THREE from 'three';
import type { ActionDraft } from '../core/actions';
import { CAMERA, CLIP, GEOMETRY, SCREEN_LAYER } from '../core/geometry';
import { carryGroup, clipGroup, type DragGroup } from '../core/clips';
import type { CardInstance, ClipId, InstanceId, Pose, SeatId, StackItemId, TableState, ZoneId } from '../core/types';
import { parseZoneId } from '../core/ids';
import type { Rect, TableLayout, TextureSource } from '../games/types';
import type { QualityId } from '../themes/types';
import { registerDebug } from '../util/debug';
import { feelCues, forgetMotion, handRoom, reportMotion, tableTheme } from '../util/feel';
import { frameMeter, type RenderInfo } from '../util/frame-meter';
import { NO_INSETS, type Insets } from './camera';
import { followRequests, type FollowRequest } from './camera/follow';
import { basis } from './camera/pose';
import { TableRig, lateralOf } from './camera/rig';
import { CardBoxes, CardLayer, ContactShadows, boxShape, legibleOutlineMm, type CardDraw } from './cards';
import { BACK_KEY, FaceTextures } from './faces';
import { FOIL_SHEEN, TABLE_FOIL, foilHue, foilSheenColour } from './foil';
import { ambientDue, uploadScale } from './pacing';
import { AdaptiveResolution, REST_AFTER_MS } from './resolution';
import { renderSwitches } from './switches';
import { clampShade } from './materials';
import { setTextureAnisotropy } from './quality';
import { ThemeRuntime, type ThemePlacement } from './theme-runtime';
import { tapActions, toStoredPoses } from './gestures';
import { carryDropActions, rigidPoses, tempCarryActions } from './carry';
import { ClipView, clipCorners, clipFrame, clipHere, pointInClip, type ClipCard, type ClipDraw, type ClipFrame } from './clips';
import { LAYER, cameraTable, compareSort, displayedRot, dropTable, dropTargets, faceOf, fitFrame, markings, pileAnchor, placeCards, presentationOf, seatLayoutOf, viewerAngle, type Placement } from './layout';
import { blockPlan, fanAttacker, fanUnder, settleSlots, withUnblock, type CombatContext } from './combat';
import { ghostSegments, markerSegments, markerSize } from './ghost';
import { LineLayer, LineView, lineSourceOf, type DebugPing, type DebugSeatView, type DebugTableView, type DrawnLine, type LineDraw, type SceneDebugLine } from './lines';
import { CARD_H, CARD_W, rectPoint, cardCorners, cardHalfExtents, deltaDeg, legibleScale, normDeg, pointInCard, pointInRect, rot2 } from './math';
import { createFocusRing } from './focus-ring';
import {
  CLIP_POP_SCALE,
  CardMotion,
  LiftMotion,
  POP_MS,
  POP_SCALE,
  SwayMotion,
  TAP_FEEL_MS,
  TAP_OVERSHOOT,
  easeInOutCubic,
  easeOutBack,
  easeOutCubic,
  feelWithin,
  groupDelay,
  heldTilt,
  liftScale,
  liftShadow,
  magnetOn,
  magnetPull,
  popCurve,
  progressOf,
  riffleOffset,
  swayTarget,
  waveDelays,
  type MagnetState,
} from './motion';
import { CaptionLayer, captionBadge, captionPoint } from './captions';
import { badgeItems, drawnPose, entryAt, entryOutline, entryScale, hoverHighlights, itemAnchor, labelPoint, notePoint, registerStackHover, slotAt, stackCollapsed, stackEntries, stackSlotPose, type DebugStackEntry, type StackEntry } from './stack';
import { StackBadgeView } from './stack-badge';
import { resolveDrop, zoneTargetAt, type DropResult, type Extent, type SnapCard } from './snap';
import { attackDrop, attackPose, inHandBand, libraryBottomSlot, opponents, samePileHover, sameSelectionAnchor, selectionAnchorOf, type AttackDrop } from './affordances';
import { attachPressHold } from './press-hold';
import { TextLayer, type TextSpec } from './text';
import { recentGestures, TouchPointers } from './input/pointers';
import type { TouchGesture } from './input/touch';
import { FACE_BUDGET_HEADROOM, TEXTURE_CAP_BYTES, tierForScreenHeight } from './textures';
import type {
  AffordanceDebugState,
  CameraPose,
  CameraRig,
  CardAnimationKind,
  CardAnimationRequest,
  CardFeel,
  FrameHold,
  FrameScheduler,
  MotionDebugState,
  MotionSettings,
  ClipDebugState,
  DebugClip,
  DropPreview,
  FollowOptions,
  RenderDebug,
  RenderStats,
  RigDebug,
  TableCameraControls,
  DebugCamera,
  DebugCard,
  FrameStats,
  PileHover,
  SceneDebugParts,
  ScreenRect,
  SelectionAnchor,
  ScreenPoint,
  SetRigOptions,
  TablePoint,
  TablePoint3,
  TableScene,
  TableSceneOptions,
  TablePressKind,
  ViewState,
} from './types';
import { TILT_PRESETS, cardFeel, clampTilt, rigForTilt, tiltForRig, type SetTiltOptions, type Tilt } from './types';

/** A debug card with extra fields the scene's own tests read (zone, pile, which face is shown, ...). */
export interface SceneDebugCard extends DebugCard {
  zone: ZoneId;
  tapped: boolean;
  face: 'up' | 'down';
  /** Texture shown: 'face' or 'back'; dimmed for the owner's view of a face-down card. */
  shows: 'face' | 'back';
  dimmed: boolean;
  selected: boolean;
  dragging: boolean;
  moving: boolean;
  /** Tier of the texture drawn this frame, or null while none is loaded. */
  tier: 'small' | 'normal' | 'large' | null;
  order: number;
  /** Temporarily moved (DESIGN "Combat and annotation", Temporary move): drawn with a displacement marker. */
  displaced: boolean;
  /** Where its ghost outline is drawn (the home slot), or null. */
  ghost: Pose | null;
  /** Lift above its resting height while held, mm (M4-P2: CardDressing.held.lift). */
  lift: number;
  /** Tilt toward the drag direction drawn in the last frame, degrees (M4-P2: CardDressing.held.tiltDeg, lit themes). */
  tilt: number;
  /** Drawn as a foil printing (sheen and badge) in the last frame (scene/foil.ts; DESIGN "Foils are marked with a subtle sheen and a badge"). */
  foil: boolean;
  /** Drawn with the hover outline in the last frame (M5-P4: none on the pointer's card while a keyboard focus is set). */
  hovered: boolean;
}

export type { SceneDebugLine };

/** The scene's debug parts plus extras for its own tests. */
export interface SceneDebug extends SceneDebugParts {
  cards(): SceneDebugCard[];
  lines(): SceneDebugLine[];
  /** Every line drawn this frame (state lines, derived attachment lines, attack stubs, the line being drawn). */
  drawnLines(): DrawnLine[];
  /** Pings being shown. */
  pings(): DebugPing[];
  /** Result of the last drop resolution (rules 1 to 5). */
  lastDrop(): DropResult | null;
  /** No drag, camera motion or card animation in progress. */
  idle(): boolean;
  /** Face textures queued, loading or waiting for upload. */
  pendingTextures(): number;
  /** Frames drawn so far (M4-P2: tests wait for a frame after a theme or quality switch). */
  frames(): number;
  /** The lit pipeline's state (M4-P2): live library materials and textures, card boxes, contact shadows, face shade. */
  pipeline(): {
    materials: number;
    materialTextures: number;
    boxes: boolean;
    contactShadows: boolean;
    faceShade: number;
    faceLift: number;
    toneMapping: number;
    post: string[];
    /** Anisotropic filtering of the face arrays and the GPU's maximum. */
    anisotropy: number;
    maxAnisotropy: number;
    pixelRatio: number;
    /** MSAA samples of the post chain's targets (0 with post off). */
    samples: number;
  };
}

/** A TableScene whose debug parts carry the scene's extras (assignable to TableScene). */
export type SceneHandle = Omit<TableScene, 'debug'> & { readonly debug: SceneDebug };

interface RCard {
  id: InstanceId;
  inst: CardInstance;
  place: Placement;
  motion: CardMotion;
  /** Texture key on screen (lags `place.key` during a flip until the half-way point). */
  shownKey: string;
  shownDim: boolean;
  /** Own gesture: until this time a state change toward the card eases with the spring, not the remote ease-out. */
  localUntil: number;
  /** After a drop: expected pose, and when to give up waiting for the state to confirm it. */
  expect: { pose: Pose; until: number } | null;
  tierDrawn: 'small' | 'normal' | 'large' | null;
  /** Height above its place (M7-P4, scene/motion.ts LiftMotion): rises on grab, settles with a bounce, hops along a toss. */
  lift: LiftMotion;
  /** The lean of a dragged card into its motion (M7-P4, CardFeel.sway). */
  sway: SwayMotion;
  /** A pop of the whole card (a clip snapping on), of its counter badge (start time), and a pile's riffle (M7-P4). */
  pop: { start: number; dur: number; amp: number } | null;
  badgePop: number | null;
  riffle: { start: number; dur: number; i: number; n: number } | null;
  /** Gone from the table into the viewer's own hand (the DOM fan): drawn flying there until `until`, then dropped (M7-P4). */
  leaving: { until: number } | null;
}

interface DragState {
  pointerId: number;
  /** Dragged cards, the grabbed one first. */
  ids: InstanceId[];
  /** Grabbed card's pose minus the pointer's table point. */
  offset: TablePoint;
  start: Map<InstanceId, Pose>;
  keepPile: boolean;
  temp: boolean;
  last: { x: number; y: number };
  /** Started from the HUD (hand fan): listen on window. */
  external: boolean;
  /** Cards not drawn before the drag (hand): drawn while dragged. */
  added: InstanceId[];
  /** What the drag carries and why (core/clips.ts carryGroup; M6-P1), null for a card off the battlefield. */
  group: DragGroup | null;
  /** Ctrl held at the last pointer event (skips snapping; the preview follows it). */
  ctrl: boolean;
  /**
   * The top card of the own library, picked up to draw it (PLAN M7-P5: "drag from library to hand draws"): dropped in
   * the hand it is drawn, anywhere else it springs back. Never shown to the others (scene/presence.ts mayShowDrag).
   */
  fromLibrary?: boolean;
}

/**
 * A paperclip held by the pointer (PLAN Milestone 6, owner decisions, Paperclips): an existing clip picked up (dropped
 * on empty table it comes off; on other overlapping cards it moves there; elsewhere it springs back), or a new one
 * dragged out of the HUD's clip tray (`clip` null: dropped where two or more cards overlap it clips them, else it
 * vanishes).
 */
interface ClipDrag {
  pointerId: number;
  clip: ClipId | null;
  last: { x: number; y: number };
  /** Started in the HUD (the tray): listen on window. */
  external: boolean;
}

/** A left press held still on an overlap: at CLIP.holdMs it clips the cards under it (ring from CLIP.ringFromMs). */
interface ClipHold {
  pointerId: number;
  t0: number;
  at: { x: number; y: number };
  cards: InstanceId[];
}

/** A stack marker held by the pointer (DESIGN "The effect stack", Resolving 4: reorder or drag out by hand). */
interface ItemDrag {
  pointerId: number;
  item: StackItemId;
  /** Slot pose minus the table point grabbed. */
  offset: TablePoint;
  last: { x: number; y: number };
}

type Gesture =
  | { kind: 'press'; pointerId: number; button: number; card: InstanceId | null; item: StackItemId | null; x0: number; y0: number; shift: boolean; alt: boolean; pileGrab: boolean; badge?: boolean; clip?: ClipId }
  /** A press-and-hold that clipped cards (M6-P1): the release does nothing more. */
  | { kind: 'held'; pointerId: number }
  | { kind: 'pan'; pointerId: number; last: { x: number; y: number }; samples: { x: number; y: number; t: number }[] }
  | { kind: 'marquee'; pointerId: number; x0: number; y0: number; x1: number; y1: number; base: InstanceId[] }
  | { kind: 'line'; pointerId: number }
  | { kind: 'drag' }
  /** Right-drag on empty table in the ego rig: pitch (DESIGN "Camera and navigation", Navigation gestures). */
  | { kind: 'pitch'; pointerId: number; last: { x: number; y: number } };

/** What a drop in progress would do beyond the snap preview (M7-P5), with the ghost outlines it shows. */
interface DragHint {
  kind: 'draw' | 'hand' | 'top' | 'bottom' | 'attack';
  /** Where its label stands on the table, or null: over the hand. */
  at: TablePoint | null;
  ghosts: Pose[];
}

const DRAG_THRESHOLD_PX = 4;
/** Counter badge type size on the table (mm), its place on the card (over the art box) and its far-zoom floor. */
const COUNTER_SIZE = 6.5;
const COUNTER_ART_Y = 14;
const COUNTER_MIN_PX = 11;
const COUNTER_MAX_SCALE = 3;
/**
 * Zone label type size on the table (mm) and its far-zoom floor: at the fitted view (about half a pixel per mm) the
 * labels keep ZONE_LABEL_MIN_PX of type on screen, up to ZONE_LABEL_MAX_SCALE; pile labels sit beside their piles, not
 * in the 12 mm gap between them (`pileLabelPlace`; DESIGN "Themes and rendering": Paper zones carry small caps labels;
 * gate M1 findings).
 */
const ZONE_LABEL_SIZE = 5.5;
const ZONE_LABEL_MIN_PX = 9;
const ZONE_LABEL_MAX_SCALE = 3;
/** Stroke widths of ghost outlines and displacement markers, CSS px. */
/** Least on-screen width of the hover outline, CSS px. */
const HOVER_MIN_PX = 1.5;
const GHOST_WIDTH_PX = 1;
const MARKER_WIDTH_PX = 2;
/** After a right-drag drew a line, the context menu that some platforms fire on release is ignored this long, ms. */
const MENU_SUPPRESS_MS = 400;
/** Right-drag pitch in the ego rig: degrees per CSS px dragged (down looks further down). */
const PITCH_DEG_PER_PX = 0.2;
/** A followed stack item counts as on screen when its centre is at least this far inside the viewport, CSS px. */
const FOLLOW_MARGIN_PX = 40;
/** How long a dropped card waits for the state to confirm its new pose before returning. */
const EXPECT_MS = 1500;
/** The gap the HUD keeps between the table's fit and the hand fan (ui/hand.ts FIT_INSET.handGap): not part of the fan's band, CSS px. */
const HAND_BAND_GAP_PX = 8;

export function createTableScene(host: HTMLElement, opts: TableSceneOptions): SceneHandle {
  let theme = opts.theme;
  let layout = opts.layout;
  let viewerSeat = opts.viewerSeat;
  let state: TableState | null = null;
  let view: ViewState = { selection: [], hovered: null, privateFaces: {}, reducedMotion: false, pings: [], openPile: null };

  // --- Three.js -------------------------------------------------------------------------------------------------
  // Measuring switches (scene/switches.ts; M7-A0).
  const switches = renderSwitches();
  const renderer = new THREE.WebGLRenderer({ antialias: switches.antialias ?? true, preserveDrawingBuffer: false });
  // M8-C: counted while it lives (contracts.md Part C lifecycle counters).
  trackContext(renderer);
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, theme.quality[0]?.pixelRatio ?? 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  // A frame is several render calls (world, post passes, overlay): the scene resets the counters once per frame.
  renderer.info.autoReset = false;
  // Shadow maps are drawn when something changed, not on ambient-only frames (draw's `ambientOnly`; M7-A0).
  renderer.shadowMap.autoUpdate = false;
  const canvas = renderer.domElement;
  canvas.style.display = 'block';
  canvas.style.width = '100%';
  canvas.style.height = '100%';
  canvas.style.touchAction = 'none';
  canvas.setAttribute('data-scene', 'table');
  if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
  host.appendChild(canvas);

  const marqueeEl = document.createElement('div');
  marqueeEl.setAttribute('data-scene', 'marquee');
  Object.assign(marqueeEl.style, { position: 'absolute', display: 'none', pointerEvents: 'none', border: `1px dashed ${theme.tokens.colours.focus}`, background: 'rgba(31,111,209,0.06)' });
  host.appendChild(marqueeEl);
  // The keyboard focus ring (ViewState.focused; M5-P4, scene/focus-ring.ts), over the canvas like the marquee.
  const focusRing = createFocusRing(host);

  // The far-zoom stack badge (scene/stack-badge.ts; DESIGN "The effect stack", Reading it; M5-P7).
  const stackBadge = new StackBadgeView(host, {
    faces: opts.faces,
    colours: () => {
      const c = theme.tokens.colours;
      return { fg: c.fg, surface: theme.tokens.hud?.panel ?? c.surface, border: theme.tokens.hud?.panelBorder ?? c.border, pending: theme.cardDressing.pending.colour, font: theme.tokens.type.family };
    },
    onChange: () => (dirty = true),
    // An item hovered in the expanded list is the hovered stack item, as one hovered in the lane (M5-P7).
    onHoverItem: (item) => setHoverItem(item),
    // A right press on an item of the expanded list starts a line from that stack item (startBadgeLine below).
    onLinePress: (item, e) => startBadgeLine(item, e),
    // A finger on an item of the list feeds the touch gestures; long-press then drag draws a line from it (badgeTouch).
    onTouch: (item, e) => badgeTouch(item, e),
  });
  /** The lane is drawn as the badge this frame (far zoom; scene/stack.ts stackCollapsed). */
  let stackFolded = false;

  /** The lit, post-processed world (theme, card boxes, markings) and the overlay drawn after post (faces, text, lines). */
  const scene = new THREE.Scene();
  const overlay = new THREE.Scene();
  overlay.name = 'overlay';
  const camera = new THREE.PerspectiveCamera(CAMERA.birdseye.fovDeg, 1, 10, 100000);
  const viewport = () => ({ w: Math.max(1, host.clientWidth || innerWidth), h: Math.max(1, host.clientHeight || innerHeight) });
  // Both camera rigs and the blend between them (scene/camera/rig.ts, M4-P1).
  const rig = new TableRig({
    // The camera's table: turned to the viewer where seats sit at 120° (scene/layout.ts cameraTable; M5-P7).
    table: cameraTable(layout, viewerAngle(null, layout, viewerSeat)),
    viewport: viewport(),
    angle: viewerAngle(null, layout, viewerSeat),
    inertiaMs: theme.motion.panInertiaMs,
    rig: opts.rig ?? theme.camera.defaultRig,
    ego: theme.camera.ego,
    tiltDeg: theme.camera.birdseyeTiltDeg,
  });
  /** Whether the viewer chose a rig (P); until then a theme switch brings the new theme's default rig. */
  let rigChosen = opts.rig !== undefined;
  /** The ego seat sits in front of the viewer's own territory (Three players, Two-Headed Giant share an edge). */
  const viewerLateral = (st: TableState | null): number => {
    const sl = st ? seatLayoutOf(st, layout, viewerSeat) : null;
    return sl ? lateralOf(sl.territory, sl.angle) : 0;
  };
  /**
   * What the default ego view keeps clear of the HUD (PLAN M5 owner decision "Ego framing shows your own piles"): the
   * corners of the viewer's territory, pile column (library, graveyard, exile) and command area.
   */
  const egoKeepOf = (st: TableState | null): TablePoint[] => {
    const sl = st ? seatLayoutOf(st, layout, viewerSeat) : null;
    if (!sl) return [];
    const cornersOf = (r: { x: number; y: number; w: number; d: number; rot: number }) =>
      [
        [-1, -1],
        [1, -1],
        [1, 1],
        [-1, 1],
      ].map(([u, v]) => rectPoint(r, (u! * r.w) / 2, (v! * r.d) / 2));
    const pile = (p: Pose) => cornersOf({ ...p, w: CARD_W, d: CARD_H });
    return [...cornersOf(sl.territory), ...pile(sl.zones.library), ...pile(sl.zones.graveyard), ...pile(sl.zones.exile), ...cornersOf(sl.zones.command)];
  };
  // The HUD tells the scene which screen edges its screen-anchored layer covers through the host's
  // `data-fit-insets="top right bottom left"` (CSS px); fitting the table keeps the table clear of them.
  const readInsets = (): Insets => {
    const v = (host.getAttribute('data-fit-insets') ?? '').trim().split(/\s+/).map(Number);
    if (v.length !== 4 || v.some((n) => !Number.isFinite(n) || n < 0)) return NO_INSETS;
    return { top: v[0]!, right: v[1]!, bottom: v[2]!, left: v[3]! };
  };
  rig.bird.insets = readInsets();
  rig.bird.view = rig.bird.fitView();
  const insetObserver = new MutationObserver(() => {
    rig.setInsets(readInsets());
    dirty = true;
  });
  insetObserver.observe(host, { attributes: true, attributeFilter: ['data-fit-insets'] });

  // The theme's table surface is turned with the camera's table (the three-player table; scene/layout.ts cameraTable),
  // so every viewer sees the same upright table (M5-P7).
  const placement = (): ThemePlacement => {
    const angle = viewerAngle(state, layout, viewerSeat);
    const turn = cameraTable(layout, angle).rot ?? 0;
    return { table: layout.table, viewerAngle: angle, reducedMotion: view.reducedMotion, ...(turn ? { tableRot: turn } : {}) };
  };
  const runtime = new ThemeRuntime(renderer, scene, camera, { post: true, overlay, glow: () => [lineView.lines.object, lineView.pingRings] }, theme, placement(), opts.quality ?? 'high');
  // The adaptive resolution (scene/resolution.ts; M7-A0).
  if (switches.pixelRatioCap !== null) runtime.setPixelRatioCap(switches.pixelRatioCap);
  const resolution = new AdaptiveResolution(switches.adapt);
  const syncPixel = new Uint8Array(4);
  let built = placement();

  /** The viewer's chosen back (M5-P5, `setCardBack`: the official back once loaded), over the theme's and the game's. */
  let backOverride: TextureSource | null = null;
  const backOf = (t: typeof theme) => backOverride ?? t.cardDressing.back ?? opts.game.cardBack;
  /** New face arrays when the back to draw changed (theme switch or card back setting); faces register again. */
  const swapBack = (oldBack: TextureSource) => {
    if (backOf(theme) === oldBack) return;
    faces.dispose();
    faces = new FaceTextures(renderer, opts.faces, backOf(theme), TEXTURE_CAP_BYTES, faceBudget);
    faces.onChange = () => (dirty = true);
    for (const rc of rcards.values()) if (rc.place.ref) faces.register(rc.place.ref, rc.place.faceIndex);
    dirty = true;
  };
  /** GPU bytes the face arrays may take: the 400 MB texture cap less the theme's own textures (PLAN M4 Performance). */
  const faceBudget = () => TEXTURE_CAP_BYTES - runtime.textureBytes() - FACE_BUDGET_HEADROOM;
  let faces = new FaceTextures(renderer, opts.faces, backOf(theme), TEXTURE_CAP_BYTES, faceBudget);
  faces.onChange = () => (dirty = true);
  const cards = new CardLayer(overlay, theme.tokens.colours.surface);
  overlay.add(cards.mesh);
  // Card boxes and contact shadows (themes with thickness and shadows) live in the lit world.
  const boxes = new CardBoxes(scene);
  const contact = new ContactShadows(scene);
  let boxMaterials: { sleeve: THREE.Material; edge: THREE.Material } | null = null;
  /** Card dressing of the current theme within the current quality level: boxes, contact shadows, face shade. */
  function applyDressing(): void {
    const d = theme.cardDressing;
    const eff = runtime.effective;
    const shape = boxShape(d);
    releaseDressing();
    boxMaterials = shape.thickness > 0 ? runtime.materials.cardSides(d) : null;
    boxes.configure({ ...shape, materials: boxMaterials, castShadow: eff.shadowMap && d.held.shadow, receiveShadow: eff.shadowMap });
    contact.configure(eff.contactShadows ? theme.shadows.contact : null);
    cards.faceLift = shape.thickness > 0 ? shape.thickness + 0.02 : 0;
    cards.setShade(clampShade(d.faceShade), runtime.keyLight);
  }
  function releaseDressing(): void {
    if (!boxMaterials) return;
    runtime.materials.release(boxMaterials.sleeve);
    runtime.materials.release(boxMaterials.edge);
    boxMaterials = null;
  }
  const text = new TextLayer();
  // Table markings (zone labels) lie under the cards, like the hairlines.
  const labels = new TextLayer(1, 'zone-labels');
  // Glyph layout runs in a worker: redraw once a batch finishes.
  text.object.addEventListener('synccomplete', () => (dirty = true));
  labels.object.addEventListener('synccomplete', () => (dirty = true));
  overlay.add(text.object);
  scene.add(labels.object);
  // Ghost outlines at the home slots of displaced cards (under the cards) and their displacement markers (over them).
  const ghostLayer = new LineLayer({ renderOrder: 1, opacity: theme.cardDressing.ghost.opacity, name: 'ghosts' });
  const markerLayer = new LineLayer({ renderOrder: 4, name: 'displacement-markers' });
  scene.add(ghostLayer.object);
  overlay.add(markerLayer.object);
  // Paperclips over the cards and the drop preview's ghost outline (M6-P1; PLAN Milestone 6, owner decisions).
  const clipView = new ClipView();
  overlay.add(clipView.object);
  const previewLayer = new LineLayer({ renderOrder: 4, name: 'drop-preview' });
  overlay.add(previewLayer.object);
  /** The hold ring (fills from CLIP.ringFromMs to CLIP.holdMs) and the tuck's attach glyph, over the canvas. */
  const ringEl = document.createElement('div');
  ringEl.setAttribute('data-scene', 'clip-ring');
  ringEl.innerHTML = '<svg width="44" height="44" viewBox="0 0 44 44" aria-hidden="true"><circle cx="22" cy="22" r="18" fill="none" stroke-width="4" opacity="0.25"/><circle class="fill" cx="22" cy="22" r="18" fill="none" stroke-width="4" stroke-linecap="round" transform="rotate(-90 22 22)" stroke-dasharray="113.1" stroke-dashoffset="113.1"/></svg>';
  Object.assign(ringEl.style, { position: 'absolute', display: 'none', pointerEvents: 'none', width: '44px', height: '44px', marginLeft: '-22px', marginTop: '-22px', zIndex: '2' });
  host.appendChild(ringEl);
  const glyphEl = document.createElement('div');
  glyphEl.setAttribute('data-scene', 'attach-glyph');
  glyphEl.title = 'Attach';
  glyphEl.innerHTML = '<svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 13l7-7a3 3 0 0 1 4 4l-9 9a5 5 0 0 1-7-7l8-8" fill="none" stroke-width="2" stroke-linecap="round"/></svg>';
  Object.assign(glyphEl.style, { position: 'absolute', display: 'none', pointerEvents: 'none', width: '22px', height: '22px', marginLeft: '-11px', marginTop: '-11px', borderRadius: '50%', zIndex: '2' });
  host.appendChild(glyphEl);
  function styleOverlays(): void {
    const c = theme.tokens.colours;
    const ink = c.focus;
    for (const el of ringEl.querySelectorAll('circle')) el.setAttribute('stroke', ink);
    glyphEl.style.background = c.surface;
    glyphEl.style.border = `1px solid ${ink}`;
    glyphEl.querySelector('path')?.setAttribute('stroke', ink);
    clipView.setStyle({ lit: theme.lighting.lit, colour: theme.lighting.lit ? '#d9dde3' : c.fg });
  }
  styleOverlays();
  const markGeometry = new THREE.BufferGeometry();
  const markMaterial = new THREE.LineBasicMaterial({ color: theme.tokens.colours.border, depthTest: false, depthWrite: false, transparent: true });
  const marks = new THREE.LineSegments(markGeometry, markMaterial);
  marks.renderOrder = 1;
  marks.frustumCulled = false;
  marks.name = 'zone-outlines';
  scene.add(marks);
  let markLabels: ReturnType<typeof markings>['labels'] = [];

  // --- Scene state ------------------------------------------------------------------------------------------------
  const rcards = new Map<InstanceId, RCard>();
  let order: RCard[] = [];
  let drag: DragState | null = null;
  let gesture: Gesture | null = null;
  /** Pointers pressed anywhere on the page (the follow options wait for their release). */
  const pressedPointers = new Set<number>();
  /** Fingers on the canvas become gestures (scene/input/touch.ts; M5-P1); mouse and pen keep the handlers below. */
  const touchInput = new TouchPointers((g) => onTouchGesture(g));
  let dirty = true;
  let frame = 0;
  let stats: FrameStats = { drawCalls: 0, textureBytes: 0, frameMs: 0 };
  let lastTick = performance.now();
  let raf = 0;
  /** The identity the frame loop is counted under (M8-C lifecycle counters). */
  const frameLoop = {};
  let disposed = false;
  let hovered: InstanceId | null = null;
  /** The stack item under the pointer (DESIGN "The effect stack": hovering an item highlights its source and targets). */
  let hoverItem: string | null = null;
  /** The stack lane as drawn (scene/stack.ts), refreshed with every state. */
  let entries: StackEntry[] = [];
  /** The marker being dragged, if any. */
  let itemDrag: ItemDrag | null = null;
  // Paperclips (M6-P1): the clip held by the pointer, a press-and-hold on an overlap, the clip under the pointer, and
  // where the card drag in progress would land.
  let clipDrag: ClipDrag | null = null;
  let clipHold: ClipHold | null = null;
  let hoverClip: ClipId | null = null;
  let preview: DropPreview | null = null;
  /** The pointer of the drag the preview was last computed for (recomputed when it moves). */
  let previewFor: { x: number; y: number; ctrl: boolean } | null = null;
  let idCounter = 0;
  const idPrefix = Math.random().toString(36).slice(2, 8);
  const newId = (p: string) => `${p}-${idPrefix}-${(++idCounter).toString(36)}`;
  /** The viewer's motion setting (Settings.motion through `setMotion` or `opts.motion`); absent: ViewState.reducedMotion decides. */
  let motionSetting: MotionSettings | null = opts.motion ?? null;
  const reduced = () => (motionSetting ? motionSetting.reduced : view.reducedMotion);
  /** The motion applied now: the setting, else full motion unless the view asks for reduced motion. */
  const motionNow = (): MotionSettings => motionSetting ?? (view.reducedMotion ? { reduced: true, scale: 0 } : { reduced: false, scale: 1 });
  /** The card feel of the theme under the motion setting (scene/types.ts cardFeel), rebuilt when either changes. */
  let feelCache: { theme: typeof theme; motion: string; feel: CardFeel } | null = null;
  function feel(): CardFeel {
    const m = motionNow();
    const key = `${m.reduced}:${m.scale}`;
    if (!feelCache || feelCache.theme !== theme || feelCache.motion !== key) feelCache = { theme, motion: key, feel: feelWithin(cardFeel(theme, m), m.reduced ? 0 : m.scale) };
    return feelCache.feel;
  }
  /** The height a held card rises to: the theme's held lift (M4 CardDressing.held.lift), or its card feel's when it sets one. */
  const heldLift = () => theme.feel?.liftMm ?? theme.cardDressing.held.lift;

  // Render on demand (M7-P4; scene/types.ts FrameScheduler): anything that animates holds frames until it is done.
  const frameHolds = new Map<number, { reason: string; active?: () => boolean }>();
  let holdId = 0;
  const frames: FrameScheduler = {
    invalidate: () => void (dirty = true),
    hold(reason: string, active?: () => boolean): FrameHold {
      const id = ++holdId;
      frameHolds.set(id, active ? { reason, active } : { reason });
      dirty = true;
      return { release: () => void frameHolds.delete(id) };
    },
  };
  /** Card animations running (M7-P4; debug `motion().running`): each ends at start + dur and then holds no frame. */
  let anims: { kind: CardAnimationKind; cards: InstanceId[]; start: number; dur: number }[] = [];
  /** This scene's key in the page-wide motion totals (util/feel.ts). */
  const motionKey = {};
  /** The next card's place in the group of moves of the state being laid out (relayout; motion.ts groupDelay). */
  let groupIndex = 0;
  function startAnim(kind: CardAnimationKind, ids: InstanceId[], now: number, dur: number): void {
    if (!(dur > 0) || ids.length === 0) return;
    const same = anims.find((a) => a.kind === kind && a.start === now);
    if (same) {
      for (const id of ids) if (!same.cards.includes(id)) same.cards.push(id);
      same.dur = Math.max(same.dur, dur);
    } else anims.push({ kind, cards: [...ids], start: now, dur });
    dirty = true;
  }
  /** The magnet a drag in progress feels (M7-P4): the slot it is pulled toward, what kind of snap it is, and the pull. */
  let magnet: { kind: 'squared' | 'cascade' | 'tuck' | 'align' | 'zone' | 'hand'; target: InstanceId | null; slot: Pose | null; byCursor: boolean } | null = null;
  let magnetDrawn: MagnetState | null = null;

  // Connection lines and ping rings (DESIGN "Combat and annotation"; scene/lines.ts).
  const lineView = new LineView({
    state: () => state,
    pings: () => view.pings,
    layout: () => layout,
    viewerSeat: () => viewerSeat,
    theme: () => theme,
    cardPose: (id) => rcards.get(id)?.motion.pose ?? null,
    freePose: (id) => {
      const rc = rcards.get(id);
      return rc && rc.place.kind === 'free' ? rc.motion.pose : null;
    },
    pxPerMm: () => rig.pxPerMm(),
    reduced,
    // A stack item's lines start at its visible title strip (scene/stack.ts itemAnchor), a marker's in its own slot.
    stackEnd: (item) => {
      // A collapsed lane's items all stand at the badge, at the lane's centre (M5-P7 far-zoom stack).
      if (stackFolded && entries.some((x) => x.item.id === item)) return { point: { x: layout.stackLane.x, y: layout.stackLane.y }, shape: { kind: 'point' } };
      const e = entries.find((x) => x.item.id === item);
      return e ? { point: itemAnchor(entryPose(e)), shape: { kind: 'point' } } : null;
    },
    extraLines: () => markerLines(),
  });
  overlay.add(lineView.lines.object);
  overlay.add(lineView.pingRings);
  applyDressing();
  // Caption bubbles over the canvas (DESIGN "Chat and voice", Placement; scene/captions.ts, M3-P4).
  const captionLayer = new CaptionLayer({
    container: host,
    toScreen: (p) => rig.tableToScreen(p),
    viewport: () => rig.viewport,
    canvasRect: () => canvas.getBoundingClientRect(),
    point: (c) =>
      state
        ? captionPoint(state, layout, c, {
            viewer: viewerSeat,
            drawn: (a) => {
              if (a.kind === 'card') {
                const rc = rcards.get(a.id);
                return rc && rc.place.kind !== 'hand' ? rc.motion.pose : null;
              }
              const e = a.kind === 'stackItem' ? entries.find((x) => x.item.id === a.id) : undefined;
              return e ? itemAnchor(entryPose(e)) : null;
            },
          })
        : null,
    fill: (c) => (c.colour === null ? theme.tokens.colours.muted : (theme.tokens.colours.seats[c.colour]?.colour ?? theme.tokens.colours.muted)),
    badge: (c) => captionBadge(state, theme.tokens.colours.seats, c),
    reduced,
  });
  const seatAngleOf = (seat: SeatId): number => (state ? (seatLayoutOf(state, layout, seat)?.angle ?? 0) : 0);
  const combatCtx: CombatContext = { angleOf: seatAngleOf, newId };

  // Look, do not touch (M7-P5; m7-adjustments.md D14): a read-only scene proposes no action. Every route below checks
  // `readOnly` before it starts a drag, a tap, a line, a hold or a pile action; this guard is the last net.
  let readOnly = opts.readOnly === true;
  /** The actions this scene proposed (the read-only spec counts them through the debug hook). */
  let proposed = 0;
  const dispatch = (actions: ActionDraft[]) => {
    if (readOnly) return;
    for (const a of actions) {
      proposed++;
      opts.dispatch(a);
    }
  };

  // --- Layout and markings ----------------------------------------------------------------------------------------
  function rebuildMarkings(): void {
    const angle = viewerAngle(state, layout, viewerSeat);
    const names: string[] = [];
    if (state) for (const seat of Object.values(state.seats)) names[seat.index] = seat.name;
    const m = markings(layout, opts.game, angle, state ? Object.keys(state.seats).length : layout.seats.length, names);
    const pos: number[] = [];
    for (let i = 0; i < m.segments.length; i += 4) pos.push(m.segments[i]!, 0.05, -m.segments[i + 1]!, m.segments[i + 2]!, 0.05, -m.segments[i + 3]!);
    markGeometry.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    markGeometry.computeBoundingSphere();
    markLabels = m.labels;
    dirty = true;
  }
  rebuildMarkings();

  // --- State -> render cards ----------------------------------------------------------------------------------------
  /** The state the cards were last laid out for: a new state's differences from it start the card animations (M7-P4). */
  let laid: TableState | null = null;
  /** Taps and untaps that started in one frame (a wave when there are several; M7-P4). */
  let tapWave: { tick: number; start: number; items: { rc: RCard; tapped: boolean; x: number }[] } | null = null;

  /** The viewer's own hand zone (the DOM fan), or null without a seat. */
  function ownHandZone(): ZoneId | null {
    const hand = opts.game.zones.find((z) => z.presentation === 'fan');
    return hand && viewerSeat ? `${hand.id}:${viewerSeat}` : null;
  }

  /** Where a card flies to when it goes into the viewer's own hand: under the middle of the hand fan, upright for the viewer. */
  function handPoint(): Pose {
    const vp = rig.viewport;
    const p = rig.screenToTable(vp.w / 2, vp.h * (1 - SCREEN_LAYER.handCardViewportFraction / 2));
    return { x: p.x, y: p.y, rot: viewerAngle(state, layout, viewerSeat) };
  }

  /** The animation kind of a card arriving in `zone` (M7-P4: play, to graveyard, to exile, to hand, to library, draw). */
  function arrivalKind(from: ZoneId | undefined, zone: ZoneId): CardAnimationKind {
    const kind = zone.split(':')[0];
    const fromKind = from?.split(':')[0];
    if (kind === 'graveyard') return 'toGraveyard';
    if (kind === 'exile') return 'toExile';
    if (kind === 'library') return 'toLibrary';
    if (kind === 'hand') return fromKind === 'library' ? 'draw' : 'toHand';
    return 'play';
  }

  /** Duration of an arrival animation (CardFeel.durations, already scaled by the motion setting). */
  function arrivalMs(kind: CardAnimationKind, f: CardFeel): number {
    if (kind === 'draw') return f.durations.draw;
    if (kind === 'play') return f.durations.play;
    if (kind === 'attach' || kind === 'detach') return f.durations.attach;
    return f.durations.toPile;
  }

  /**
   * A card that went into the viewer's own hand (a draw, a card picked up): drawn flying from where it was to under the
   * hand fan, turning face up on the way when the viewer may see it (their own identity of it, ViewState.privateFaces:
   * nothing new is shown or sent), then dropped (M7-P4: "draw … flipping face up for its owner only").
   */
  function startLeaving(rc: RCard, inst: CardInstance, at: number, f: CardFeel): void {
    const kind = arrivalKind(rc.inst.zone, inst.zone);
    const dur = arrivalMs(kind, f);
    // A group (seven drawn at once) staggers: this card starts its flight a little after the one before (M7-P5).
    const now = at + groupDelay(groupIndex++, dur);
    const ref = inst.identity ?? view.privateFaces[inst.id] ?? null;
    const key = ref ? `${ref.sid}#${inst.faceIndex}` : BACK_KEY;
    if (ref) faces.register(ref, inst.faceIndex);
    rc.inst = inst;
    rc.place = { ...rc.place, zone: inst.zone, kind: 'hand', key, ref, dimmed: false, fanned: false, z: rc.place.z, sort: [LAYER.dragged, 1, 0] };
    if (key !== rc.shownKey) rc.motion.startFlip(now, theme.motion, reduced(), Math.min(theme.motion.flipMs, dur * 0.7));
    rc.motion.tweenTo(handPoint(), at, dur, easeInOutCubic, reduced(), now - at);
    rc.lift.arc(now, heldLift(), dur, reduced());
    rc.leaving = { until: now + dur };
    startAnim(kind, [rc.id], now, dur);
  }

  function relayout(now: number): void {
    if (!state) return;
    const before = laid;
    laid = state;
    // Only a new state animates (a layout or view change re-places cards as before); reduced motion cuts (M7-P4).
    const animate = before !== null && before !== state && !reduced();
    const f = feel();
    // Cards that move in one new state are one group: their flights stagger (motion.ts groupDelay).
    groupIndex = 0;
    const places = placeCards(state, view, { game: opts.game, layout, viewerSeat });
    entries = stackEntries(state, layout.stackLane, viewerAngle(state, layout, viewerSeat));
    syncStackFocus();
    if (hoverItem && !state.stack.some((i) => i.id === hoverItem)) hoverItem = null;
    const ownHand = ownHandZone();
    for (const [id, rc] of [...rcards]) {
      if (places.has(id) || drag?.ids.includes(id) || rc.leaving) continue;
      const inst = state.cards[id];
      if (animate && inst && ownHand && inst.zone === ownHand && rc.inst.zone !== ownHand) startLeaving(rc, inst, now, f);
      else rcards.delete(id);
    }
    // Cards a settle sends home move together with the settle timing, staggered, their attachments riding along
    // (DESIGN "Specification: geometry, layout and motion", Motion).
    const settling = settleSlots(state, places.keys(), (id) => rcards.get(id)?.inst);
    const newCards = before ? [...places.keys()].filter((id) => !rcards.has(id)).length : 0;
    const taps: { rc: RCard; tapped: boolean }[] = [];
    for (const [id, place] of places) {
      const inst = state.cards[id]!;
      if (place.ref) faces.register(place.ref, place.faceIndex);
      let rc = rcards.get(id);
      if (!rc) {
        rc = { id, inst, place, motion: new CardMotion(place.rest), shownKey: place.key, shownDim: place.dimmed, localUntil: 0, expect: null, tierDrawn: null, lift: new LiftMotion(), sway: new SwayMotion(), pop: null, badgePop: null, riffle: null, leaving: null };
        rcards.set(id, rc);
        // A card that appears on the table (played from the hand fan, a new token): a soft landing; a few at a time only
        // (a deck going into the library is no storm of landings).
        if (animate && newCards <= 12) arrive(rc, before!.cards[id]?.zone, now, f);
        continue;
      }
      const prev = rc.inst;
      rc.inst = inst;
      rc.place = place;
      rc.leaving = null;
      if (prev.face !== inst.face && rc.shownKey !== place.key) {
        rc.motion.startFlip(now, theme.motion, reduced());
        if (animate) startAnim('flip', [id], now, theme.motion.flipMs);
      } else if (rc.motion.flipSwapped) {
        rc.shownKey = place.key;
        rc.shownDim = place.dimmed;
      }
      // Counters changed: the badge pops (M7-P4).
      if (animate && !sameCounters(prev.counters, inst.counters)) {
        rc.badgePop = now;
        startAnim('counter', [id], now, POP_MS * motionNow().scale);
      }
      if (drag?.ids.includes(id)) continue;
      const t = rc.motion.target;
      const changed = !samePose(t, place.rest, 1e-6);
      if (rc.expect && samePose(rc.expect.pose, place.rest)) rc.expect = null;
      if (!changed) continue;
      // A drop still waiting for its confirmation keeps its predicted pose through unrelated updates; tick() returns it
      // to the state's pose if the confirmation never comes.
      if (rc.expect && now < rc.expect.until) continue;
      const onlyRot = Math.abs(t.x - place.rest.x) < 1e-6 && Math.abs(t.y - place.rest.y) < 1e-6;
      const slot = place.kind === 'free' ? settling.get(id) : undefined;
      if (slot !== undefined) {
        rc.motion.moveTo(place.rest, 'settle', now, theme.motion, reduced(), slot * theme.motion.settleStaggerMs);
        continue;
      }
      if (prev.tapped !== inst.tapped && onlyRot) {
        taps.push({ rc, tapped: inst.tapped });
        continue;
      }
      const own = now < rc.localUntil;
      const attachChanged = prev.attachedTo !== inst.attachedTo;
      if (animate && (prev.zone !== inst.zone || attachChanged)) {
        const kind: CardAnimationKind = prev.zone !== inst.zone ? arrivalKind(prev.zone, inst.zone) : inst.attachedTo !== undefined ? 'attach' : 'detach';
        const dur = arrivalMs(kind, f);
        if (own) {
          // The viewer's own drop: the spring carries it and the lift settles with its bounce (tick); listed for the hook.
          rc.motion.moveTo(place.rest, 'spring', now, theme.motion, reduced());
          startAnim(kind, [id], now, Math.max(dur, f.settle.ms));
        } else {
          // Another player's move, or a key: a short flight with a hop, landing softly where the state says; a group
          // staggers (M7-P5).
          const delay = groupDelay(groupIndex++, dur);
          rc.motion.tweenTo(place.rest, now, dur, kind === 'play' ? easeOutCubic : easeInOutCubic, reduced(), delay);
          if (kind === 'play') rc.lift.land(now + delay, heldLift(), dur, f.settle.bounce, reduced());
          else rc.lift.arc(now + delay, heldLift() * (kind === 'attach' || kind === 'detach' ? 0.5 : 0.8), dur, reduced());
          startAnim(kind, [id], now + delay, dur);
        }
        continue;
      }
      const kind = now < rc.localUntil ? 'spring' : 'remote';
      rc.motion.moveTo(place.rest, kind, now, theme.motion, reduced());
    }
    // Taps and untaps turn with a small overshoot; many at once (untap all) run as a wave from the viewer's left (M7-P4).
    // Taps that arrive within one frame, in one state or several, are one wave.
    if (taps.length) {
      if (!tapWave || tapWave.tick !== lastTick) tapWave = { tick: lastTick, start: now, items: [] };
      const wave = tapWave;
      const angle = viewerAngle(state, layout, viewerSeat);
      for (const t of taps) {
        wave.items = wave.items.filter((x) => x.rc !== t.rc);
        wave.items.push({ rc: t.rc, tapped: t.tapped, x: rot2(t.rc.place.rest.x, t.rc.place.rest.y, -angle)[0] });
      }
      const delays = wave.items.length >= 3 ? waveDelays(wave.items.map((x) => x.x)) : wave.items.map(() => 0);
      const dur = TAP_FEEL_MS * motionNow().scale;
      wave.items.forEach(({ rc }, i) => rc.motion.tweenTo(rc.place.rest, wave.start, dur, (t) => easeOutBack(t, TAP_OVERSHOOT), reduced(), delays[i]));
      if (animate) {
        for (const tapped of [true, false]) {
          const group = wave.items.map((x, i) => ({ ...x, i })).filter((x) => x.tapped === tapped);
          if (group.length) startAnim(tapped ? 'tap' : 'untap', group.map((x) => x.rc.id), wave.start, dur + Math.max(...group.map((x) => delays[x.i]!)));
        }
      }
    }
    if (animate && before) {
      // A library shuffled (its round finished): the pile riffles.
      for (const round of Object.values(state.shuffles)) {
        if (round.purpose !== 'shuffle' || round.orderHash === null || before.shuffles[round.id]?.orderHash) continue;
        const pile = [...rcards.values()].filter((rc) => rc.inst.zone === round.zone && rc.place.kind === 'pile').sort((a, b) => a.place.z - b.place.z);
        pile.forEach((rc, i) => (rc.riffle = { start: now, dur: f.durations.shuffle, i, n: pile.length }));
        startAnim('shuffle', [], now, f.durations.shuffle);
      }
      // A clip snapped on or came off: its cards pop.
      const clipsNow = state.clips ?? {};
      const clipsBefore = before.clips ?? {};
      for (const [cid, clip] of Object.entries(clipsNow)) {
        if (clipsBefore[cid]) continue;
        for (const id of clip.cards) {
          const rc = rcards.get(id);
          if (rc) rc.pop = { start: now, dur: f.durations.clip, amp: CLIP_POP_SCALE };
        }
        startAnim('clip', [...clip.cards], now, f.durations.clip);
      }
      for (const [cid, clip] of Object.entries(clipsBefore)) if (!clipsNow[cid]) startAnim('unclip', [...clip.cards], now, f.durations.clip);
    }
    sortOrder();
    dirty = true;
  }

  /**
   * A card that appears on the table (M7-P4): played onto a battlefield or the stack it lands softly, coming up out of
   * the viewer's hand fan when it was theirs; put on a pile from the viewer's hand it flies there from the fan.
   */
  function arrive(rc: RCard, from: ZoneId | undefined, at: number, f: CardFeel): void {
    const kind = arrivalKind(from, rc.inst.zone);
    const dur = arrivalMs(kind, f);
    // A group (a hand dumped onto the table) staggers (M7-P5).
    const delay = groupDelay(groupIndex++, dur);
    const now = at + delay;
    const fromHand = from !== undefined && from === ownHandZone();
    if (rc.place.kind === 'free' || rc.place.kind === 'stack' || rc.place.kind === 'area') {
      if (fromHand) {
        const h = handPoint();
        const rest = rc.place.rest;
        rc.motion.cut({ x: rest.x + (h.x - rest.x) * 0.35, y: rest.y + (h.y - rest.y) * 0.35, rot: rest.rot });
        rc.motion.tweenTo(rest, at, dur, easeOutCubic, reduced(), delay);
      }
      rc.lift.land(now, heldLift(), dur, f.settle.bounce, reduced());
      startAnim('play', [rc.id], now, dur);
    } else if (rc.place.kind === 'pile' && fromHand) {
      rc.motion.cut(handPoint());
      rc.motion.tweenTo(rc.place.rest, at, dur, easeInOutCubic, reduced(), delay);
      rc.lift.arc(now, heldLift(), dur, reduced());
      startAnim(kind, [rc.id], now, dur);
    }
  }

  function sortOrder(): void {
    order = [...rcards.values()].sort((a, b) => compareSort(sortKey(a), sortKey(b)));
  }

  function sortKey(rc: RCard): readonly number[] {
    if (drag?.ids.includes(rc.id)) return [LAYER.dragged, drag.ids.indexOf(rc.id), 0];
    return rc.place.sort;
  }

  // --- Rendering ----------------------------------------------------------------------------------------------------
  const camBasis = new THREE.Matrix4();
  const camAxes = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()] as const;
  /** Copy the rig's pose onto the camera (table x, y, z up → three's x, z, -y). */
  function syncCamera(): void {
    const pose = rig.pose();
    const vp = rig.viewport;
    const b = basis(rig.angle, pose.pitchDeg);
    const clip = rig.clipPlanes(pose);
    camera.fov = pose.fovDeg;
    camera.aspect = vp.w / vp.h;
    camera.near = clip.near;
    camera.far = clip.far;
    const p = pose.position;
    camera.position.set(p[0], p[2], -p[1]);
    camAxes[0].set(b.r[0], b.r[2], -b.r[1]);
    camAxes[1].set(b.u[0], b.u[2], -b.u[1]);
    camAxes[2].set(-b.d[0], -b.d[2], b.d[1]);
    camera.quaternion.setFromRotationMatrix(camBasis.makeBasis(camAxes[0], camAxes[1], camAxes[2]));
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
  }

  function resize(): void {
    const vp = viewport();
    renderer.setSize(vp.w, vp.h, false);
    runtime.setSize(vp.w, vp.h);
    rig.resize(vp);
    lineView.setResolution(vp.w, vp.h);
    ghostLayer.setResolution(vp.w, vp.h);
    markerLayer.setResolution(vp.w, vp.h);
    dirty = true;
  }

  const counterText = (kind: string, n: number): string => {
    if (kind === '+1/+1') return `${n >= 0 ? '+' : ''}${n}/${n >= 0 ? '+' : ''}${n}`;
    if (kind === '-1/-1') return `-${n}/-${n}`;
    return `${kind} ${n}`;
  };

  /** Zone labels with their card counts: table markings, drawn under the cards. */
  function labelSpecs(): Map<string, TextSpec> {
    const t = theme.tokens.colours;
    const specs = new Map<string, TextSpec>();
    const counts = new Map<ZoneId, number>();
    if (state) for (const z of Object.values(state.zones)) counts.set(z.id, z.ids.length);
    const scale = legibleScale(ZONE_LABEL_SIZE, ZONE_LABEL_MIN_PX, ZONE_LABEL_MAX_SCALE, rig.pxPerMm());
    for (const l of markLabels) {
      const zoneKind = l.key.split(':').pop()!;
      const seatIdx = Number(l.key.split(':')[1]);
      const seat = state ? Object.values(state.seats).find((s) => s.index === seatIdx) : undefined;
      const n = seat ? counts.get(`${zoneKind}:${seat.id}`) : l.key === 'zl:stack' ? state?.stack.length : undefined;
      specs.set(l.key, { text: n ? `${l.text}  ${n}` : l.text, x: l.x, y: l.y, z: 0.1, rot: l.rot, size: ZONE_LABEL_SIZE, scale, colour: t.muted, letterSpacing: 0.12, ...(l.anchorX ? { anchorX: l.anchorX } : {}), anchorY: l.anchorY });
    }
    return specs;
  }

  /** Counters, pile counts, notes and token labels: drawn over the cards. */
  function textSpecs(): Map<string, TextSpec> {
    const t = theme.tokens.colours;
    const specs = new Map<string, TextSpec>();
    // Counter badges keep at least COUNTER_MIN_PX of type on screen at far zoom (DESIGN "Camera and navigation",
    // Level of detail: counters stay legible as simplified badges).
    const counterScale = legibleScale(COUNTER_SIZE, COUNTER_MIN_PX, COUNTER_MAX_SCALE, rig.pxPerMm());
    const seen = new Set<string>();
    for (const rc of order) {
      const c = rc.inst;
      const pose = shownPose(rc);
      const local = (lx: number, ly: number) => {
        const [x, y] = rot2(lx, ly, pose.rot);
        return { x: pose.x + x, y: pose.y + y };
      };
      // Squared pile on a battlefield: count badge at the top card's top-left corner.
      if (rc.place.kind === 'free' && c.pile?.kind === 'squared' && !rc.place.fanned && !seen.has(c.pile.id)) {
        const top = topOfPile(c.pile.id);
        if (top === rc.id) {
          seen.add(c.pile.id);
          const n = pileCount(c.pile.id);
          const p = local(-CARD_W / 2 + 4, CARD_H / 2 - 5);
          specs.set(`pile:${c.pile.id}`, { text: `×${n}`, x: p.x, y: p.y, z: 20, rot: pose.rot, size: 7, colour: t.fg, outline: t.surface, anchorX: 'left', anchorY: 'top' });
        }
      }
      const kinds = Object.keys(c.counters).sort();
      if (kinds.length && (rc.place.kind === 'free' || rc.place.kind === 'stack')) {
        // Over the art box, clear of the name, mana cost, type line and power/toughness the badge must not hide.
        const p = local(0, COUNTER_ART_Y);
        specs.set(`ctr:${rc.id}`, { text: kinds.map((k) => counterText(k, c.counters[k]!)).join('\n'), x: p.x, y: p.y, z: 20, rot: pose.rot, size: COUNTER_SIZE, scale: counterScale * badgePopScale(rc), colour: t.fg, outline: t.surface, anchorX: 'center', anchorY: 'middle' });
      }
      if (c.note && rc.place.kind === 'free') {
        const p = local(0, -CARD_H / 2 + 12);
        specs.set(`note:${rc.id}`, { text: c.note.slice(0, 40), x: p.x, y: p.y, z: 20, rot: pose.rot, size: 4.5, colour: t.fg, outline: t.surface, anchorY: 'middle' });
      }
      if (c.tokenLabel && !c.identity && rc.place.kind === 'free') {
        specs.set(`tl:${rc.id}`, { text: c.tokenLabel.slice(0, 24), x: pose.x, y: pose.y, z: 20, rot: pose.rot, size: 5, colour: t.fg, outline: t.surface });
      }
    }
    // Stack lane: each item's number and kind beside its title strip, its note on the other side, in the controller's
    // seat colour (DESIGN "The effect stack", Reading it; Note). A collapsed lane shows its badge instead.
    for (const e of stackFolded ? [] : entries) {
      const pose = entryPose(e);
      const colour = seatColour(e.item.controller);
      const lp = labelPoint(pose, entryScale(e));
      specs.set(`stk:${e.item.id}`, { text: `${e.number} ${e.kindLabel.toUpperCase()}`, x: lp.x, y: lp.y, z: 20, rot: pose.rot, size: 4.5, colour, outline: t.surface, anchorX: 'right', anchorY: 'middle', letterSpacing: 0.06 });
      if (e.item.note) {
        const np = notePoint(pose, entryScale(e));
        specs.set(`stkn:${e.item.id}`, { text: e.item.note.slice(0, 40), x: np.x, y: np.y, z: 20, rot: pose.rot, size: 4.5, colour: t.fg, outline: t.surface, anchorX: 'left', anchorY: 'middle' });
      }
    }
    return specs;
  }

  /** A counter badge's pop (M7-P4: counters changing pop): up to POP_SCALE larger, back over POP_MS. */
  function badgePopScale(rc: RCard): number {
    if (rc.badgePop === null) return 1;
    const dur = POP_MS * motionNow().scale;
    return dur > 0 ? 1 + POP_SCALE * popCurve((lastTick - rc.badgePop) / dur) : 1;
  }

  function topOfPile(pile: string): InstanceId | null {
    let best: RCard | null = null;
    for (const rc of rcards.values()) if (rc.inst.pile?.id === pile && (!best || rc.inst.pile.index > best.inst.pile!.index)) best = rc;
    return best?.id ?? null;
  }
  /** The seat colour (CSS) of a seat, the first seat colour when unknown. */
  function seatColour(seat: SeatId): string {
    const c = state?.seats[seat]?.colour ?? 0;
    return (theme.tokens.colours.seats[c] ?? theme.tokens.colours.seats[0]!).colour;
  }

  /**
   * The slot pose of a stack entry now: a spell follows its card's motion, a dragged marker follows the pointer, a
   * marker otherwise rests at its slot. A marker is drawn smaller inside it (scene/stack.ts drawnPose).
   */
  function entryPose(e: StackEntry): Pose {
    if (itemDrag?.item === e.item.id) {
      const p = screenToTable(itemDrag.last.x, itemDrag.last.y);
      return { x: p.x + itemDrag.offset.x, y: p.y + itemDrag.offset.y, rot: e.pose.rot };
    }
    const rc = !e.marker && e.item.card !== undefined ? rcards.get(e.item.card) : undefined;
    return rc ? rc.motion.pose : e.pose;
  }

  /** Outline of a stack entry: its controller's seat colour, the theme's pending colour pulsing while its round waits (reduced motion: steady). */
  function entryHighlight(e: StackEntry): { colour: string; width: number } {
    const pulse = !e.pending || reduced() ? 1 : 0.5 + 0.5 * Math.sin((lastTick / 900) * Math.PI * 2);
    return entryOutline(e.pending, seatColour(e.item.controller), theme.cardDressing, pulse);
  }

  function pileCount(pile: string): number {
    let n = 0;
    for (const rc of rcards.values()) if (rc.inst.pile?.id === pile) n++;
    return n;
  }

  /** Lines from each ability or trigger marker to its source (DESIGN "The effect stack", Ability), drawn by LineView. */
  function markerLines(): LineDraw[] {
    if (!state) return [];
    const out: LineDraw[] = [];
    for (const e of entries) {
      if (!e.marker || !e.source) continue;
      const rc = rcards.get(e.source);
      if (!rc) continue;
      const seat = state.seats[e.item.controller];
      const st = theme.lineStyle('attach', theme.tokens.colours.seats[seat?.colour ?? 0] ?? theme.tokens.colours.seats[0]!);
      out.push({ from: itemAnchor(entryPose(e)), to: { x: rc.motion.pose.x, y: rc.motion.pose.y }, colour: st.colour, widthPx: Math.max(1, st.widthPx * 0.75) });
    }
    return out;
  }

  /** Ghost outlines at home slots and displacement markers (DESIGN "Combat and annotation", Temporary move). */
  function syncDisplaced(): void {
    const dressing = theme.cardDressing;
    const ghosts: LineDraw[] = [];
    const markers: LineDraw[] = [];
    const size = markerSize(rig.pxPerMm());
    for (const rc of order) {
      const home = ghostOf(rc);
      if (!home) continue;
      for (const sgm of ghostSegments(home, dressing.ghost.dashed)) ghosts.push({ ...sgm, colour: dressing.ghost.colour, widthPx: GHOST_WIDTH_PX });
      for (const sgm of markerSegments(home, rc.motion.pose, size)) markers.push({ ...sgm, colour: dressing.displacedMarker, widthPx: MARKER_WIDTH_PX });
    }
    ghostLayer.sync(ghosts);
    markerLayer.sync(markers);
  }

  /** The home slot a displaced battlefield card leaves its ghost at, or null. */
  function ghostOf(rc: RCard): Pose | null {
    if (!rc.inst.home || rc.place.kind !== 'free' || drag?.ids.includes(rc.id)) return null;
    return rc.inst.home;
  }

  /**
   * The hover outline's width in mm: the theme's width, but at least HOVER_MIN_PX on screen (up to the 2 mm the outline
   * slot holds), so the hover reads at play zoom, where a card is some 60 px tall and a 0.6 mm line is under a pixel.
   */
  const hoverWidth = (mm: number, cardPx: number): number => legibleOutlineMm(mm, cardPx, HOVER_MIN_PX);
  /** Foil cards drawn with the sheen and badge in the last frame (debug; the tick redraws them while the sheen drifts). */
  const foilsDrawn = new Set<InstanceId>();
  /** Cards drawn with the hover outline in the last frame (selection outlines win the slot and are not counted). */
  const hoversDrawn = new Set<InstanceId>();
  /** Whether a card shows a foil printing's face: public face up, or the owner's own dimmed view (local only). */
  const foilShown = (rc: RCard): boolean => rc.place.ref?.foil === true && rc.shownKey !== BACK_KEY && rc.shownKey === rc.place.key;
  /** A stable per-card phase offset of the sheen, so neighbouring foils shimmer out of step. */
  const foilIndex = (id: InstanceId): number => {
    let h = 0;
    for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
    return (h % 97) / 13;
  };
  let lastSheen = 0;

  /**
   * The pose a card is drawn at (M7-P4): its motion's pose turned by its sway and, while its pile riffles, moved aside
   * in the viewer's frame. The debug hook's `pose` stays the motion's pose (where the card is going to rest).
   */
  function shownPose(rc: RCard): Pose {
    const p = rc.motion.pose;
    if (!rc.sway.value && !rc.riffle) return p;
    let { x, y } = p;
    if (rc.riffle) {
      const o = riffleOffset(rc.riffle.i, rc.riffle.n, progressOf(rc.riffle, lastTick));
      const [dx, dy] = rot2(o.dx * CARD_W, 0, viewerAngle(state, layout, viewerSeat));
      x += dx;
      y += dy;
    }
    return { x, y, rot: rc.sway.value ? normDeg(p.rot + rc.sway.value) : p.rot };
  }
  /** The hop of a riffling card, mm. */
  const riffleZ = (rc: RCard): number => (rc.riffle ? riffleOffset(rc.riffle.i, rc.riffle.n, progressOf(rc.riffle, lastTick)).dz : 0);

  /** Tilt of held cards in the last frame (debug). */
  const tiltDrawn = new Map<InstanceId, number>();

  /** A ping is still fading: keep drawing. */
  let pingsLive = false;

  /**
   * Draw a frame. `ambientOnly`: nothing but ambient motion changed since the last frame (a flicker, particles, a pulse),
   * so no shadow caster moved and the shadow maps are reused (M7-A0: the shadow pass is skipped on those frames).
   */
  function draw(dt = 0, ambientOnly = false): void {
    const t0 = performance.now();
    frame++;
    renderer.info.reset();
    syncCamera();
    const cam = rig.pose();
    // Each card's texture tier from its own on-screen height: in the ego rig near cards show larger than far ones, and a
    // card lying flat shows shorter than it would face on (its projected height, not its scale times its height).
    const cardPxAt = (p: { x: number; y: number; rot: number }, k = 1, z = 0) => rig.cardScreenHeight(p, z, k, cam);
    // Far zoom: the lane collapses to its count badge while a card in it would be too small to read (M5-P7).
    const laneAngle = viewerAngle(state, layout, viewerSeat);
    stackFolded = stackCollapsed(state?.stack.length ?? 0, cardPxAt(stackSlotPose(layout.stackLane, 0, laneAngle)));
    syncStackBadge(cam);
    const selection = new Set(view.selection);
    const dressing = theme.cardDressing;
    const vp = rig.viewport;
    const sorted: { sort: readonly number[]; draw: CardDraw }[] = [];
    const lit = new Set([...(hoverItem && state ? hoverHighlights(state, hoverItem) : []), ...hoverClipCards()]);
    const slotOf = new Map(entries.map((e) => [e.item.card ?? '', e]));
    const foilPhase = reduced() ? 0 : (performance.now() / FOIL_SHEEN.periodMs) % 1;
    const held = heldLift();
    const down = viewerAngle(state, layout, viewerSeat);
    foilsDrawn.clear();
    hoversDrawn.clear();
    let focusTarget: { card: InstanceId; corners: { x: number; y: number }[] } | null = null;
    for (const rc of order) {
      // A collapsed lane draws none of its cards (one being dragged out still follows the pointer).
      if (stackFolded && rc.place.kind === 'stack' && !(drag?.ids.includes(rc.id) ?? false)) {
        rc.tierDrawn = null;
        continue;
      }
      const pose = shownPose(rc);
      if (rc.motion.flipSwapped) {
        rc.shownKey = rc.place.key;
        rc.shownDim = rc.place.dimmed;
      }
      const s = rig.tableToScreen(pose, 0, cam);
      const cardPx = cardPxAt(pose, 1, rc.place.z);
      const onScreen = cardPx > 0 && s.x > -cardPx && s.y > -cardPx && s.x < vp.w + cardPx && s.y < vp.h + cardPx;
      const uv = faces.use(rc.shownKey, onScreen ? tierForScreenHeight(cardPx) : 'small', frame);
      rc.tierDrawn = uv ? (['small', 'normal', 'large'] as const)[uv.tier]! : null;
      const dragging = drag?.ids.includes(rc.id) ?? false;
      const tilt = dragging ? heldTilt(rc.motion.x.v, rc.motion.y.v, dressing.held.tiltDeg, reduced()) : null;
      if (tilt) tiltDrawn.set(rc.id, tilt.deg);
      else tiltDrawn.delete(rc.id);
      const sel = selection.has(rc.id);
      if (view.focused === rc.id) {
        const z = rc.place.z + rc.lift.value;
        // The ring stands off these corners by a gap that keeps it apart from a selection outline (focus-ring.ts).
        focusTarget = { card: rc.id, corners: cardCorners(pose).map((p) => rig.tableToScreen(p, z, cam)) };
      }
      // While a keyboard focus is set the keys act on the focused card, so the card under a resting pointer draws no
      // hover outline of its own (one target on screen: the ring); the HUD's own hover and lit cards still draw.
      const hov = view.hovered === rc.id || (view.focused ? false : hovered === rc.id) || lit.has(rc.id);
      const entry = rc.place.kind === 'stack' && !dragging ? slotOf.get(rc.id) : undefined;
      // A foil printing shown face up carries the sheen (a rim, unless another outline takes the slot) and the badge.
      const foil = foilShown(rc) ? foilHue(foilPhase, foilIndex(rc.id)) : null;
      if (foil !== null) foilsDrawn.add(rc.id);
      if (hov && !sel) hoversDrawn.add(rc.id);
      // Card feel (M7-P4): a lifted card is drawn a little larger with its shadow under it; a pop swells it briefly.
      const lifted = rc.lift.value;
      const pop = rc.pop ? 1 + rc.pop.amp * popCurve(progressOf(rc.pop, lastTick)) : 1;
      const scale = liftScale(lifted, held) * pop;
      const sh = liftShadow(lifted, held);
      const [sdx, sdy] = sh ? rot2(sh.dx, sh.dy, down) : [0, 0];
      sorted.push({
        sort: sortKey(rc),
        draw: {
          pose,
          z: rc.place.z + lifted + riffleZ(rc),
          // Still lifted after the drop: its contact shadow follows it down instead of popping in on landing.
          held: dragging || lifted > 0,
          tilt,
          ...(scale !== 1 ? { scale } : {}),
          shadow: sh ? { dx: sdx, dy: sdy, grow: sh.grow, blur: sh.blur, opacity: sh.opacity, z: rc.place.z } : null,
          scaleX: rc.motion.flipScale(lastTick),
          uv,
          dim: rc.shownDim ? 1 - dressing.faceDownOwnerOpacity : 0,
          highlight: sel
            ? { colour: dressing.selected.colour, width: dressing.selected.width }
            : hov
              ? { colour: dressing.hover.colour, width: hoverWidth(dressing.hover.width, cardPx) }
              : entry
                ? entryHighlight(entry)
                : foil !== null && dressing.foilSheen
                  ? { colour: foilSheenColour(foilPhase, foilIndex(rc.id)), width: TABLE_FOIL.rimMm }
                  : null,
          foil,
        },
      });
    }
    // Ability, trigger and copy markers take their slots in the lane, between the spells (scene/stack.ts).
    for (const e of entries) {
      if (!e.marker || (stackFolded && itemDrag?.item !== e.item.id)) continue;
      const src = e.face ? rcards.get(e.face) : undefined;
      const k = entryScale(e);
      const pose = drawnPose(entryPose(e), k);
      const s = rig.tableToScreen(pose, 0, cam);
      const cardPx = cardPxAt(pose, k);
      const onScreen = cardPx > 0 && s.x > -cardPx && s.y > -cardPx && s.x < vp.w + cardPx && s.y < vp.h + cardPx;
      const uv = faces.use(src ? src.shownKey : BACK_KEY, onScreen ? tierForScreenHeight(cardPx) : 'small', frame);
      const held = itemDrag?.item === e.item.id;
      const hov = hoverItem === e.item.id || held;
      sorted.push({
        sort: held ? [LAYER.dragged, 0, 0] : [LAYER.stack, 0, e.index],
        draw: { pose, z: held ? dressing.held.lift : 0, held, scaleX: 1, scale: k, uv, dim: 0, highlight: hov ? { colour: dressing.hover.colour, width: hoverWidth(dressing.hover.width, cardPx / k) } : entryHighlight(e) },
      });
    }
    sorted.sort((a, b) => compareSort(a.sort, b.sort));
    focusRing.set(focusTarget, { ring: theme.tokens.colours.focus, halo: theme.tokens.colours.bg });
    const draws = sorted.map((x) => x.draw);
    cards.setTextures(faces.textures());
    // Anisotropic filtering of the face arrays follows the quality level (a grown array starts at the GPU maximum).
    for (const a of Object.values(faces.arrays)) setTextureAnisotropy(renderer, a.texture, runtime.effective.anisotropy);
    cards.write(draws);
    boxes.write(draws);
    contact.write(dressing.held.shadow ? draws : draws.filter((d) => !d.held));
    lineView.sync();
    const specs = textSpecs();
    lineView.labelSpecs(specs);
    text.sync(specs);
    labels.sync(labelSpecs());
    syncDisplaced();
    clipView.sync(clipDraws());
    syncPreview(cam);
    pingsLive = lineView.syncPings(performance.now());
    runtime.update(dt);
    if (!ambientOnly || !switches.shadowSkip) renderer.shadowMap.needsUpdate = true;
    runtime.render(dt);
    // Measuring only (`?render=sync`): wait for the GPU, so the frame's draw time includes its GPU work.
    if (switches.sync) {
      const gl = renderer.getContext();
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, syncPixel);
    }
    stats = { drawCalls: renderer.info.render.calls, textureBytes: faceTextureBytes() + runtime.textureBytes(), frameMs: performance.now() - t0 };
    dirty = false;
  }

  /** GPU bytes of the face texture arrays as allocated (all layers, with mip-maps). */
  function faceTextureBytes(): number {
    let bytes = 0;
    for (const a of Object.values(faces.arrays)) bytes += a.texW * a.texH * a.layers * 4 * (4 / 3);
    return Math.round(bytes);
  }

  /**
   * Lit themes that animate (lights flicker, particles drift, shimmer) draw ambient frames unless motion is reduced; a
   * still lit theme (Dusk) draws only on change, like Paper (M7-A0; scene/theme-runtime.ts animating).
   */
  const animated = () => !reduced() && (switches.still ? runtime.animating() : theme.lighting.lit);
  /** When the last frame was drawn (tick time), and whether the tick before this one drew it. */
  let drewAt = -Infinity;
  let drewLastTick = false;
  /** What the last drawn frame cost: the time from the tick that drew it to the next animation frame, ms. */
  let frameCost = 0;
  /** The pointer position of the card drag the last tick followed. */
  let dragDrawn: { x: number; y: number } | null = null;
  /** The last drawn frame was the first at a new render scale (its cost includes new buffers: not a sample). */
  let rescaledLast = false;
  /** The full pixel ratio the adaptive resolution was last told. */
  let resolutionBase = 0;

  /**
   * The render scale for a frame (scene/resolution.ts): the motion scale within a run of frames or while the theme
   * animates by itself; the full ratio for the frame that redraws a still table at rest; else the scale in effect
   * (one frame after a pause, e.g. a hover, does not resize the buffers).
   */
  function scaleFor(rest: boolean, continuous: boolean): number {
    if (rest) return 1;
    if (continuous || animated()) return resolution.motionScale();
    return runtime.renderScale;
  }

  function tick(): void {
    if (disposed) return;
    raf = requestAnimationFrame(tick);
    const now = performance.now();
    const dt = Math.min(100, now - lastTick);
    lastTick = now;
    // The browser hands out the next animation frame once the last drawn one is done, GPU work included.
    const continuous = drewLastTick;
    if (drewLastTick) {
      frameCost = now - drewAt;
      if (!rescaledLast) resolution.observe(now, frameCost);
    } else if (now - drewAt > 100) resolution.pause();
    drewLastTick = false;
    if (runtime.fullPixelRatio !== resolutionBase) {
      resolutionBase = runtime.fullPixelRatio;
      resolution.setBase(resolutionBase);
    }
    touchInput.tick(now);
    let changed = rig.step(now, dt);
    if (pendingFollow.length && !holding()) {
      const reqs = pendingFollow;
      pendingFollow = [];
      applyFollow(reqs);
      changed = true;
    }
    if (drag) {
      // The drop preview and the magnet follow the pointer and Ctrl (M6-P1; M7-P4), once per pointer move.
      if (!previewFor || previewFor.x !== drag.last.x || previewFor.y !== drag.last.y || previewFor.ctrl !== drag.ctrl) {
        previewFor = { x: drag.last.x, y: drag.last.y, ctrl: drag.ctrl };
        const next = dragTargets(drag);
        if (!samePreview(preview, next.preview)) {
          preview = next.preview;
          changed = true;
        }
        setMagnet(next.magnet);
        // The hand fan makes room while the card is over it (ui/HandFan.svelte through util/feel.ts handRoom).
        handRoom.set(next.magnet?.kind === 'hand' && magnet?.byCursor ? Math.round(drag.last.x) : null);
        // The drop's own label and ghosts (M7-P5): draw, to hand, library top or bottom, attack.
        const hint = computeDragHint(drag);
        if (!sameDragHint(hint, dragHint)) {
          dragHint = hint;
          syncDragHint();
          changed = true;
        }
      }
      followDrag();
      // A held card redraws when the pointer moved (its springs keep it drawing while it catches up and tilts); a
      // pointer held still over a card at rest needs no frames.
      if (drag.last !== dragDrawn) changed = true;
      dragDrawn = drag.last;
    } else dragDrawn = null;
    // A press held still on an overlap clips at CLIP.holdMs; its ring fills from CLIP.ringFromMs (M6-P1).
    if (clipHold) {
      if (now - clipHold.t0 >= CLIP.holdMs) commitHold();
      syncRing(now);
    }
    if (clipDrag) changed = true;
    // Card feel (M7-P4): a held card rises, leans into its motion and settles with a bounce when let go; pops, riffles
    // and flights into the hand run to their end. Each asks for frames only while it moves.
    const held = heldLift();
    const f = feel();
    const still = reduced();
    const grip = drag ? screenToTable(drag.last.x, drag.last.y) : null;
    const down = viewerAngle(state, layout, viewerSeat);
    let dropped = false;
    for (const rc of rcards.values()) {
      if (rc.leaving && now >= rc.leaving.until) {
        rcards.delete(rc.id);
        dropped = true;
        continue;
      }
      const dragging = drag?.ids.includes(rc.id) ?? false;
      if (dragging && rc.lift.target !== held) rc.lift.rise(now, held, f.liftMs, still);
      else if (!dragging && !rc.leaving && rc.lift.target !== 0) rc.lift.settle(now, f.settle.ms, f.settle.bounce, still);
      if (rc.lift.moving) {
        rc.lift.step(now);
        changed = true;
      }
      if (still) rc.sway.cut();
      else if (dragging && grip) {
        const pose = rc.motion.pose;
        rc.sway.set(swayTarget(rc.motion.x.v, rc.motion.y.v, pose.x - grip.x, pose.y - grip.y, down, f.sway));
      } else rc.sway.set(0);
      if (rc.sway.moving) {
        rc.sway.step(dt, f.sway.relaxMs);
        changed = true;
      }
      if (rc.pop) {
        if (now - rc.pop.start >= rc.pop.dur) rc.pop = null;
        changed = true;
      }
      if (rc.badgePop !== null) {
        if (now - rc.badgePop >= POP_MS * motionNow().scale) rc.badgePop = null;
        changed = true;
      }
      if (rc.riffle) {
        if (now - rc.riffle.start >= rc.riffle.dur) rc.riffle = null;
        changed = true;
      }
      // The step that brings a card to rest still needs its frame (the rest pose; a held card's tilt back to flat).
      if (rc.motion.moving) {
        rc.motion.step(now, dt, theme.motion);
        changed = true;
      } else if (rc.shownKey !== rc.place.key && rc.motion.flipSwapped) changed = true;
      if (rc.expect && now > rc.expect.until) {
        rc.expect = null;
        if (!samePose(rc.motion.target, rc.place.rest)) rc.motion.moveTo(rc.place.rest, 'spring', now, theme.motion, reduced());
        changed = true;
      }
      if (rc.motion.moving) changed = true;
    }
    if (dropped) sortOrder();
    // Animations listed for the hook end on time; frame holds of other movers end when released or no longer active.
    if (anims.length) {
      anims = anims.filter((a) => now < a.start + a.dur);
      changed = true;
    }
    for (const [id, h] of frameHolds) if (h.active && !h.active()) frameHolds.delete(id);
    if (frameHolds.size) changed = true;
    // What this scene runs, for the page-wide totals (util/feel.ts; a dispose forgets it).
    reportMotion(motionKey, anims.length, frameHolds.size);
    if (faces.pump(frame, uploadScale(frameCost))) changed = true;
    // Ambient motion: what moves with nothing changing (ping fades, the pending pulse, a lit theme's light and
    // particles, the foil sheen). On a slow renderer it waits a few frame costs between frames (scene/pacing.ts).
    let ambient = pingsLive || (!reduced() && entries.some((e) => e.pending)) || animated();
    // The foil sheen drifts at a low frame rate while foils are drawn (not with reduced motion).
    if (foilsDrawn.size > 0 && theme.cardDressing.foilSheen && !reduced() && now - lastSheen >= FOIL_SHEEN.frameMs) ambient = true;
    if (ambient && !changed && !dirty && !ambientDue(frameCost, now - drewAt)) ambient = false;
    // A still table drawn below the full pixel ratio (a run of frames just ended) is drawn once more at the full ratio.
    const rest = !changed && !dirty && !ambient && runtime.renderScale < 1 && !animated() && now - drewAt >= REST_AFTER_MS;
    if (changed || dirty || ambient || rest) {
      if (foilsDrawn.size > 0) lastSheen = now;
      rescaledLast = runtime.setRenderScale(scaleFor(rest, continuous));
      // Theme animation advances by the time since the last drawn frame (still at most 100 ms).
      draw(Math.min(100, now - drewAt), !changed && !dirty && !rescaledLast);
      drewAt = now;
      drewLastTick = true;
    }
    if (captionLayer.active) captionLayer.place();
    syncAffordances();
    frameMeter.tick(now, drewLastTick, drewLastTick ? stats.frameMs : 0);
  }

  // --- Coordinates --------------------------------------------------------------------------------------------------
  const canvasRect = () => canvas.getBoundingClientRect();
  function toCanvas(x: number, y: number): { x: number; y: number } {
    const r = canvasRect();
    return { x: x - r.left, y: y - r.top };
  }
  function screenToTable(x: number, y: number): TablePoint {
    const c = toCanvas(x, y);
    return rig.screenToTable(c.x, c.y);
  }
  function worldToScreen(p: TablePoint3): ScreenPoint | null {
    if (!(rig.depthOf(p, p.z) > 0)) return null;
    syncCamera();
    const v = new THREE.Vector3(p.x, p.z, -p.y).project(camera);
    if (!Number.isFinite(v.x) || !Number.isFinite(v.y)) return null;
    const r = canvasRect();
    return { x: r.left + ((v.x + 1) / 2) * r.width, y: r.top + ((1 - v.y) / 2) * r.height };
  }

  /** The height a card is drawn at: its place in a pile plus the lift (M4-P2's held lift, M7-P4's LiftMotion). */
  function drawnZ(rc: RCard): number {
    return rc.place.z + rc.lift.value;
  }

  /**
   * Where the ray through a viewport point crosses the plane a card is drawn at (its top face): in the ego rig a card on
   * a tall pile or lifted shows well away from its footprint on the table, and every gesture works the same in both
   * rigs (DESIGN "Camera and navigation").
   */
  function screenToCardPlane(x: number, y: number, z: number): TablePoint | null {
    const top = z + cards.faceLift;
    if (top === 0) return screenToTable(x, y);
    const c = toCanvas(x, y);
    return rig.screenToPlane(c.x, c.y, top);
  }

  /** Topmost drawn card under a viewport point; null when a stack marker covers that point. */
  function pick(x: number, y: number, exclude?: ReadonlySet<InstanceId>): RCard | null {
    const p = screenToTable(x, y);
    const marker = markerAt(p);
    const atZ = new Map<number, TablePoint | null>(cards.faceLift === 0 ? [[0, p]] : []);
    for (let i = order.length - 1; i >= 0; i--) {
      const rc = order[i]!;
      if (exclude?.has(rc.id)) continue;
      // A collapsed lane draws its badge, not its cards (M5-P7).
      if (stackFolded && rc.place.kind === 'stack') continue;
      const z = drawnZ(rc);
      let q = atZ.get(z);
      if (q === undefined) atZ.set(z, (q = screenToCardPlane(x, y, z)));
      if (!q || !pointInCard(q, rc.motion.pose)) continue;
      // A marker covers what lies under it: older items of the lane and anything on the table below the lane.
      if (marker && (rc.place.kind === 'stack' ? (entries.find((e) => e.item.card === rc.id)?.index ?? -1) < marker.index : rc.place.sort[0] < LAYER.stack)) return null;
      return rc;
    }
    return null;
  }

  /** The topmost stack entry at a table point when it is a marker (markers are not cards). */
  function markerAt(p: TablePoint): StackEntry | null {
    if (stackFolded) return null;
    const e = entryAt(
      entries.map((x) => ({ ...x, pose: entryPose(x) })),
      p,
    );
    return e?.marker ? e : null;
  }

  /** The stack item under a viewport point: a marker, or a spell card in the lane. */
  function itemAt(x: number, y: number, rc: RCard | null): string | null {
    if (rc) return rc.place.kind === 'stack' ? (entries.find((e) => e.item.card === rc.id)?.item.id ?? null) : null;
    return markerAt(screenToTable(x, y))?.item.id ?? null;
  }

  /** Show, move or hide the far-zoom badge at the lane's centre for this frame (scene/stack-badge.ts; M5-P7). */
  function syncStackBadge(cam: ReturnType<typeof rig.pose>): void {
    const st = state;
    const at = rig.tableToScreen({ x: layout.stackLane.x, y: layout.stackLane.y }, 0, cam);
    const onScreen = rig.depthOf({ x: layout.stackLane.x, y: layout.stackLane.y }, 0, cam) > 0 && Number.isFinite(at.x) && Number.isFinite(at.y);
    const items = stackFolded && st ? badgeItems(entries, (id) => {
      const c = st.cards[id];
      if (!c) return { ref: null, faceIndex: 0 };
      const f = faceOf(c, view);
      return { ref: f.ref, faceIndex: f.faceIndex };
    }, seatColour, (seat) => {
      const c = st.seats[seat]?.colour ?? 0;
      return { glyph: (theme.tokens.colours.seats[c] ?? theme.tokens.colours.seats[0])?.glyph ?? null, name: st.seats[seat]?.name || seat };
    }) : [];
    stackBadge.update({ collapsed: stackFolded, count: st?.stack.length ?? 0, at: onScreen ? at : null, items });
  }

  function setHoverItem(item: string | null): void {
    if (item === hoverItem) return;
    hoverItem = item;
    dirty = true;
  }

  function targets() {
    if (!state) return [];
    const out = dropTargets(state, layout, viewerAngle(state, layout, viewerSeat), opts.game);
    // The command and emblem area is a drop target too (PLAN M7-P5: drag to every zone, "command"; DESIGN "Card
    // manipulation", Move to zone: "Also by dragging onto the zone").
    for (const z of opts.game.zones) {
      if (z.scope !== 'seat' || z.presentation !== 'area') continue;
      for (const seat of Object.values(state.seats)) {
        const sl = seatLayoutOf(state, layout, seat.id);
        const id = `${z.id}:${seat.id}`;
        if (sl && state.zones[id]) out.push({ zone: id, rect: { ...sl.zones.command } });
      }
    }
    return out;
  }

  // --- Paperclips (M6-P1; PLAN Milestone 6, owner decisions, Paperclips) ------------------------------------------
  /** Battlefield cards drawn under a screen point, top first, as the clip routes see them. */
  function cardsUnder(x: number, y: number): ClipCard[] {
    const out: ClipCard[] = [];
    const atZ = new Map<number, TablePoint | null>();
    for (let i = order.length - 1; i >= 0; i--) {
      const rc = order[i]!;
      if (rc.place.kind !== 'free' || rc.place.fanned || !isBattlefield(rc.inst.zone)) continue;
      const z = drawnZ(rc);
      let q = atZ.get(z);
      if (q === undefined) atZ.set(z, (q = screenToCardPlane(x, y, z)));
      if (q && pointInCard(q, rc.motion.pose)) out.push({ id: rc.id, pose: rc.motion.pose, tapped: rc.inst.tapped });
    }
    return out;
  }

  /** Where a clip of the state is drawn now (its anchor card's drawn pose), with its height over the cards it holds. */
  function clipDrawnFrame(id: ClipId): { frame: ClipFrame; z: number } | null {
    const c = state?.clips?.[id];
    const rc = c ? rcards.get(c.anchor.card) : undefined;
    if (!c || !rc || rc.place.kind !== 'free') return null;
    let z = 0;
    for (const m of c.cards) {
      const r = rcards.get(m);
      if (r) z = Math.max(z, drawnZ(r));
    }
    return { frame: clipFrame(c.anchor, rc.motion.pose, rc.inst.tapped), z: z + cards.faceLift + 0.6 };
  }

  /** The clip under a screen point (clips lie over the cards; a finger gets a wider margin), or null. */
  function clipUnder(x: number, y: number, touch = false): ClipId | null {
    if (!state?.clips) return null;
    const ids = Object.keys(state.clips).sort().reverse();
    for (const id of ids) {
      const f = clipDrawnFrame(id);
      if (!f) continue;
      const p = screenToCardPlane(x, y, f.z - cards.faceLift);
      if (p && pointInClip(p, f.frame, touch ? 4 : 1.5)) return id;
    }
    return null;
  }

  function setHoverClip(id: ClipId | null): void {
    if (id === hoverClip) return;
    hoverClip = id;
    dirty = true;
  }

  /** The cards a hovered clip outlines: its whole connected clip group (owner decisions: "Hovering a clip outlines the clipped cards"). */
  function hoverClipCards(): InstanceId[] {
    const c = hoverClip ? state?.clips?.[hoverClip] : undefined;
    return c && state ? clipGroup(state, c.cards[0]!) : [];
  }

  /** A left press on an overlap starts the hold (PLAN Milestone 6, owner decisions, Creating a clip, Mouse). */
  function startHold(pointerId: number, x: number, y: number): void {
    if (readOnly) return;
    const under = cardsUnder(x, y);
    // Only where the hold would clip something (M6.1): over cards already clipped together it stays a plain press,
    // so the click or drag goes on as usual and no duplicate clip is made.
    const would = state && under.length >= CLIP.minCards ? clipHere(state, under, screenToTable(x, y)) : null;
    clipHold = would ? { pointerId, t0: performance.now(), at: { x, y }, cards: under.map((c) => c.id) } : null;
  }

  function cancelHold(): void {
    if (!clipHold) return;
    clipHold = null;
    ringEl.style.display = 'none';
  }

  /** The hold reached CLIP.holdMs without moving: the cards under it are clipped, and the press does nothing more. */
  function commitHold(): void {
    const h = clipHold;
    cancelHold();
    if (!h || !state) return;
    const made = clipHere(state, cardsUnder(h.at.x, h.at.y), screenToTable(h.at.x, h.at.y));
    if (!made) return;
    if (gesture?.kind === 'press' && gesture.pointerId === h.pointerId) gesture = { kind: 'held', pointerId: h.pointerId };
    dispatch([{ type: 'clipAdd', clip: newId('clip'), cards: made.cards, anchor: made.anchor }]);
  }

  /** The hold ring: shown from CLIP.ringFromMs, full at CLIP.holdMs. */
  function syncRing(now: number): void {
    const h = clipHold;
    const el = h ? now - h.t0 : 0;
    if (!h || el < CLIP.ringFromMs) {
      if (ringEl.style.display !== 'none') ringEl.style.display = 'none';
      return;
    }
    const hr = host.getBoundingClientRect();
    const frac = Math.min(1, (el - CLIP.ringFromMs) / (CLIP.holdMs - CLIP.ringFromMs));
    ringEl.style.display = 'block';
    ringEl.style.left = `${h.at.x - hr.left}px`;
    ringEl.style.top = `${h.at.y - hr.top}px`;
    ringEl.querySelector('.fill')?.setAttribute('stroke-dashoffset', String(113.1 * (1 - frac)));
  }

  /** Pick up an existing clip (or, from the tray, a new one) at a screen point. */
  function startClipDrag(pointerId: number, clip: ClipId | null, x: number, y: number, external: boolean): void {
    if (readOnly) return;
    cancelHold();
    clipDrag = { pointerId, clip, last: { x, y }, external };
    setHover(null);
    dirty = true;
  }

  /**
   * Drop the held clip (owner decisions, Paperclips): a new clip from the tray clips the cards under it (two or more),
   * else it vanishes; an existing clip dropped on empty table comes off, dropped on two or more other cards it moves
   * there (one step: off, then on), elsewhere it springs back.
   */
  function finishClipDrag(cancel = false): void {
    const d = clipDrag;
    clipDrag = null;
    dirty = true;
    if (!d || cancel || !state) return;
    const under = cardsUnder(d.last.x, d.last.y);
    const p = screenToTable(d.last.x, d.last.y);
    if (d.clip === null) {
      const made = clipHere(state, under, p);
      if (made) dispatch([{ type: 'clipAdd', clip: newId('clip'), cards: made.cards, anchor: made.anchor }]);
      return;
    }
    const clip = state.clips?.[d.clip];
    if (!clip) return;
    if (under.length === 0) {
      dispatch([{ type: 'clipRemove', clip: clip.id }]);
      return;
    }
    const made = clipHere(state, under, p, clip.id);
    if (!made) return;
    const group = newId('g');
    dispatch([
      { type: 'clipRemove', clip: clip.id, group },
      { type: 'clipAdd', clip: newId('clip'), cards: made.cards, anchor: made.anchor, group },
    ]);
  }

  /** The clips to draw this frame: every clip of the state on its anchor card, a held one under the pointer. */
  function clipDraws(): ClipDraw[] {
    const out: ClipDraw[] = [];
    const held = clipDrag ? screenToTable(clipDrag.last.x, clipDrag.last.y) : null;
    for (const id of Object.keys(state?.clips ?? {}).sort()) {
      const f = clipDrawnFrame(id);
      if (!f) continue;
      const frame = clipDrag?.clip === id && held ? { ...f.frame, x: held.x, y: held.y } : f.frame;
      out.push({ id, frame, z: clipDrag?.clip === id ? f.z + theme.cardDressing.held.lift : f.z, lifted: hoverClip === id || clipDrag?.clip === id });
    }
    if (clipDrag && clipDrag.clip === null && held) out.push({ id: 'tray', frame: { x: held.x, y: held.y, rot: viewerAngle(state, layout, viewerSeat) }, z: theme.cardDressing.held.lift, lifted: true });
    return out;
  }

  /** The drop preview: a ghost outline at the landing spot and, for a tuck, the attach glyph at the peeking strip. */
  function syncPreview(cam: ReturnType<typeof rig.pose>): void {
    // A zone pile or an avatar pulling the card shows its landing spot too (M7-P4: "with the landing preview").
    const zoneSlot = !preview && drag && magnet?.slot && (magnet.kind === 'zone' || magnet.kind === 'hand') ? magnet.slot : null;
    const pv: DropPreview | null = preview ?? (zoneSlot ? { kind: 'squared', target: '', pose: zoneSlot } : null);
    const colour = theme.tokens.colours.focus;
    // The drag's own landing spots beyond the snap preview (M7-P5): the library's bottom slot, an attacker's spot.
    const extra = dragHint ? dragHint.ghosts.flatMap((g) => ghostSegments(g, true).map((sgm) => ({ ...sgm, colour, widthPx: 1.5 }))) : [];
    if (!pv) {
      previewLayer.sync(extra);
      if (glyphEl.style.display !== 'none') glyphEl.style.display = 'none';
      return;
    }
    previewLayer.sync([...ghostSegments(pv.pose, true).map((sgm) => ({ ...sgm, colour, widthPx: 1.5 })), ...extra]);
    if (pv.kind !== 'tuck') {
      glyphEl.style.display = 'none';
      return;
    }
    const [ox, oy] = rot2(0, CARD_H / 2 - 5, pv.pose.rot);
    const s = rig.tableToScreen({ x: pv.pose.x + ox, y: pv.pose.y + oy }, 0, cam);
    glyphEl.style.display = 'block';
    glyphEl.style.left = `${s.x}px`;
    glyphEl.style.top = `${s.y}px`;
  }

  const samePreview = (a: DropPreview | null, b: DropPreview | null): boolean =>
    a === b || (!!a && !!b && a.kind === b.kind && a.target === b.target && Math.abs(a.pose.x - b.pose.x) < 1e-6 && Math.abs(a.pose.y - b.pose.y) < 1e-6 && Math.abs(a.pose.rot - b.pose.rot) < 1e-6);

  /** The debug hook's clip part (PLAN Milestone 6 acceptance through the hook, never pixels). */
  function clipDebug(): ClipDebugState {
    syncCamera();
    const r = canvasRect();
    const clips: DebugClip[] = Object.keys(state?.clips ?? {})
      .sort()
      .map((id) => {
        const c = state!.clips![id]!;
        const f = clipDrawnFrame(id);
        let screen: DOMRect | null = null;
        if (f) {
          const pts = clipCorners(f.frame).map((q) => new THREE.Vector3(q.x, f.z, -q.y).project(camera));
          const xs = pts.map((v) => r.left + ((v.x + 1) / 2) * r.width);
          const ys = pts.map((v) => r.top + ((1 - v.y) / 2) * r.height);
          screen = new DOMRect(Math.min(...xs), Math.min(...ys), Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
        }
        return { id, cards: [...c.cards], at: f ? { x: f.frame.x, y: f.frame.y } : { x: 0, y: 0 }, screen };
      });
    const h = clipHold;
    return {
      clips,
      hold: h ? { at: { ...h.at }, progress: Math.min(1, (performance.now() - h.t0) / CLIP.holdMs), cards: [...h.cards] } : null,
      drag: drag?.group ?? null,
      preview,
    };
  }

  // --- Selection and hover ------------------------------------------------------------------------------------------
  function setSelection(ids: InstanceId[]): void {
    const same = ids.length === view.selection.length && ids.every((id, i) => view.selection[i] === id);
    if (same) return;
    opts.events.selectionChange?.(ids);
  }

  function setHover(id: InstanceId | null): void {
    if (id === hovered) return;
    hovered = id;
    dirty = true;
    opts.events.hover?.(id);
  }

  // --- Dragging -----------------------------------------------------------------------------------------------------
  const isBattlefield = (zone: ZoneId) => state && presentationOf(opts.game, state, zone) === 'free';

  function startCardDrag(rc: RCard, pointerId: number, x: number, y: number, temp: boolean, pileGrab: boolean, external = false): boolean {
    // Read-only (M7-P5): no card moves; a press-and-drag on a card moves the view instead.
    if (readOnly) return false;
    if (!state) return false;
    const inst = rc.inst;
    const zoneObj = state.zones[inst.zone];
    const pres = presentationOf(opts.game, state, inst.zone);
    // Library cards are drawn through the draw action (a private effect), other seats' hands are not ours to drag. The
    // top of the own library may be picked up to draw it (PLAN M7-P5: "drag from library to hand draws"): it is drawn
    // by the session on a drop in the hand, never moved by an action of the scene.
    const fromLibrary = !external && !!zoneObj && zoneObj.kind === 'library' && zoneObj.owner === viewerSeat && viewerSeat !== null && rc.place.kind === 'pile' && isPileTop(rc);
    if (!external && zoneObj && zoneObj.visibility !== 'public' && !fromLibrary) return false;
    let ids: InstanceId[] = [rc.id];
    let group: DragGroup | null = null;
    if (pres === 'free') {
      // The solitaire carry rule (PLAN Milestone 6, owner decisions, Carry rule; Paperclips): the grabbed card takes
      // the cards riding on it, its clipped group and, when it is selected, the selection. A press on a squared
      // pile's count badge grabs the pile by its bottom card. Temporary moves leave pile riders behind (core/clips.ts).
      const base = pileGrab && inst.pile ? Object.values(state.cards).find((c) => c.pile?.id === inst.pile!.id && c.pile.index === 0) : undefined;
      group = carryGroup(state, base?.id ?? rc.id, { selection: view.selection, piles: !temp });
      if (group.cards.length) ids = group.cards;
    }
    const keepPile = false;
    const anchor = rcards.get(ids[0]!)!;
    const p = screenToTable(x, y);
    const start = new Map<InstanceId, Pose>();
    for (const id of ids) {
      const r = rcards.get(id);
      if (r) start.set(id, { ...r.motion.pose, rot: r.place.rest.rot });
    }
    const a = anchor.motion.pose;
    drag = { pointerId, ids, offset: { x: a.x - p.x, y: a.y - p.y }, start, keepPile, temp, last: { x, y }, external, added: [], group, ctrl: false, ...(fromLibrary ? { fromLibrary: true } : {}) };
    // The strip and the pile actions step aside while a card is held (they return when it lands).
    syncAffordances(true);
    preview = null;
    previewFor = null;
    magnet = null;
    magnetDrawn = null;
    for (const id of ids) rcards.get(id)!.expect = null;
    sortOrder();
    dirty = true;
    // The card is picked up (M7-P4): it rises in tick(); the pickup cue sounds once.
    feelCues.emit('pickup');
    return true;
  }

  /**
   * Drag targets follow the pointer (recomputed each frame so zooming mid-drag keeps the card under the cursor). Near a
   * snap slot the magnet pulls the drawn card toward it (M7-P4, CardFeel.magnet); where it lands is still the drop's
   * resolution from the pointer, which the preview shows. Reduced motion: no pull.
   */
  function followDrag(): void {
    if (!drag) return;
    const p = screenToTable(drag.last.x, drag.last.y);
    const a0 = drag.start.get(drag.ids[0]!)!;
    let ax = p.x + drag.offset.x;
    let ay = p.y + drag.offset.y;
    let turn = 0;
    magnetDrawn = null;
    if (magnet?.slot && !reduced()) {
      const fm = feel().magnet;
      const free: Pose = { x: ax, y: ay, rot: a0.rot };
      let m: MagnetState | null;
      if (magnet.byCursor) {
        // A zone pile or an avatar pulls while the pointer is over it, however far from the card's centre it grabbed.
        const pull = magnetPull(Math.hypot(magnet.slot.x - p.x, magnet.slot.y - p.y), Math.max(fm.radiusMm, CARD_H / 2 + 12), fm.strength);
        m = pull > 0 ? { slot: magnet.slot, pull, pose: { x: ax + (magnet.slot.x - p.x) * pull, y: ay + (magnet.slot.y - p.y) * pull, rot: a0.rot } } : null;
      } else m = magnetOn(free, magnet.slot, fm);
      if (m) {
        ax = m.pose.x;
        ay = m.pose.y;
        // A single card also turns toward the slot (a tuck behind a tapped host, a pile of turned cards).
        if (drag.ids.length === 1) turn = deltaDeg(a0.rot, m.slot.rot) * m.pull;
        magnetDrawn = m;
      }
    }
    for (const id of drag.ids) {
      const rc = rcards.get(id);
      const s = drag.start.get(id);
      if (!rc || !s) continue;
      const pose = { x: ax + (s.x - a0.x), y: ay + (s.y - a0.y), rot: s.rot + turn };
      if (reduced()) rc.motion.cut(pose);
      else rc.motion.follow(pose);
    }
  }

  /** A new magnet target: the snap cue sounds when the card is pulled toward a new slot (M7-P4). */
  function setMagnet(next: typeof magnet): void {
    const prev = magnet;
    magnet = next;
    if (!next) return;
    if (prev && prev.kind === next.kind && prev.target === next.target && (prev.slot === next.slot || (!!prev.slot && !!next.slot && samePose(prev.slot, next.slot)))) return;
    if (next.kind !== 'align') feelCues.emit('snap');
  }

  /**
   * Whether a screen point is over the viewer's hand fan (M7-P4: "hand cards fan and make room as a card passes over
   * the hand"): the bottom band the HUD keeps clear for the fan (the host's data-fit-insets bottom), when the viewer has
   * a hand. Without a HUD (the scene harness) there is no fan and no band.
   */
  function overHandBand(x: number, y: number): boolean {
    const zone = ownHandZone();
    if (!zone || !state?.zones[zone]) return false;
    const vp = rig.viewport;
    const bottom = readInsets().bottom;
    if (bottom < vp.h * SCREEN_LAYER.handCardViewportFraction) return false;
    const c = toCanvas(x, y);
    return c.y >= vp.h - bottom + HAND_BAND_GAP_PX && c.y <= vp.h && c.x >= 0 && c.x <= vp.w;
  }

  function groupExtent(d: DragState): Extent {
    const a0 = d.start.get(d.ids[0]!)!;
    let e: Extent = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity };
    for (const id of d.ids) {
      const s = d.start.get(id)!;
      const { hw, hh } = cardHalfExtents(s.rot, 0);
      const dx = s.x - a0.x;
      const dy = s.y - a0.y;
      e = { minX: Math.min(e.minX, dx - hw), maxX: Math.max(e.maxX, dx + hw), minY: Math.min(e.minY, dy - hh), maxY: Math.max(e.maxY, dy + hh) };
    }
    return e;
  }

  /** Battlefield and controller for a drop at a table point: the territory under it, else where the card was. */
  function destinationAt(p: TablePoint, inst: CardInstance): { zone: ZoneId; controller: SeatId; frameDeg: number } | null {
    if (!state) return null;
    const bf = opts.game.zones.find((z) => z.presentation === 'free');
    if (!bf) return null;
    for (const seat of Object.values(state.seats)) {
      const sl = layout.seats[seat.index];
      if (sl && pointInRect(p, sl.territory) && state.zones[`${bf.id}:${seat.id}`]) return { zone: `${bf.id}:${seat.id}`, controller: seat.id, frameDeg: sl.angle };
    }
    const current = isBattlefield(inst.zone) ? inst.zone : `${bf.id}:${inst.controller}`;
    const owner = state.zones[current]?.owner ?? inst.controller;
    const sl = seatLayoutOf(state, layout, owner);
    if (!state.zones[current]) return null;
    return { zone: current, controller: owner, frameDeg: sl?.angle ?? 0 };
  }

  /** The carry group of a drag (a card off the battlefield: itself, or the dragged ids as they are). */
  function groupOf(d: DragState): DragGroup {
    return d.group ?? { anchor: d.ids[0]!, cards: [...d.ids], reason: {}, leavesPile: null, leavesHost: null };
  }

  /**
   * Where a drag would land with the pointer at `d.last`: the snap result (DESIGN "Specification: geometry, layout and
   * motion", Drop resolution, with rule 3a), the battlefield under the anchor and the anchor's free pose. Shared by the
   * drop and its preview, so the ghost outline shows exactly where the release puts the card.
   */
  function resolveFor(d: DragState, ctrl: boolean): { result: DropResult; dest: ReturnType<typeof destinationAt>; anchorPose: Pose; p: TablePoint } | null {
    if (!state) return null;
    const first = state.cards[d.ids[0]!];
    const a0 = d.start.get(d.ids[0]!);
    if (!first || !a0) return null;
    const p = screenToTable(d.last.x, d.last.y);
    const anchorPose: Pose = { x: p.x + d.offset.x, y: p.y + d.offset.y, rot: a0.rot };
    const dest = destinationAt({ x: anchorPose.x, y: anchorPose.y }, first);
    const dragged = new Set(d.ids);
    const snapCards: SnapCard[] = [];
    for (const rc of rcards.values()) {
      if (dragged.has(rc.id) || rc.place.kind !== 'free' || rc.place.fanned) continue;
      const sl = seatLayoutOf(state, layout, rc.inst.controller);
      // Drawn pose: a tapped card's extents are those of the turned card.
      snapCards.push({
        id: rc.id,
        pose: rc.place.rest,
        frameDeg: sl?.angle ?? 0,
        ...(rc.inst.pile ? { pile: rc.inst.pile } : {}),
        ...(rc.inst.attachedTo !== undefined ? { attachedTo: rc.inst.attachedTo } : {}),
        ...(rc.inst.tapped ? { tapped: true } : {}),
      });
    }
    const hand = ownHandZone();
    // Over the hand fan the card goes to the viewer's hand (M7-P4; like a drop on their avatar, rule 1).
    const result: DropResult =
      hand && overHandBand(d.last.x, d.last.y)
        ? { rule: 1, kind: 'zone', zone: hand }
        : resolveDrop(
            { pose: anchorPose, cursor: p, single: d.ids.length === 1, ctrl, frameDeg: dest?.frameDeg ?? 0, extent: groupExtent(d) },
            { table: dropTable(layout), cards: snapCards, targets: targets() },
          );
    return { result, dest, anchorPose, p };
  }

  /** The drawn pose of a tuck slot (its stored pose plus the dragged card's own tap turn). */
  const tuckDrawn = (c: CardInstance | undefined, pose: Pose): Pose => ({ ...pose, rot: c?.tapped ? (pose.rot + 90) % 360 : pose.rot });

  /**
   * The landing spot of the drag in progress as the preview shows it (PLAN Milestone 6, owner decisions, Preview: "the
   * landing spot of every snap (pile, cascade, tuck) is shown as a ghost outline, and a tuck also shows a small attach
   * glyph"): null for a temporary move, a zone drop and a free or aligned spot. With it the magnet (M7-P4): the slot the
   * drawn card is pulled toward, from the same resolution, so the pull always leads to where the release puts it — a
   * snap slot, an aligned spot, a zone pile or avatar under the pointer, or the hand fan.
   */
  function dragTargets(d: DragState): { preview: DropPreview | null; magnet: typeof magnet } {
    const none = { preview: null, magnet: null };
    if (!state) return none;
    if (d.temp) return none;
    const r = resolveFor(d, d.ctrl);
    if (!r) return none;
    const res = r.result;
    if (res.kind === 'squared') return { preview: { kind: 'squared', target: res.onto, pose: res.pose }, magnet: { kind: 'squared', target: res.onto, slot: res.pose, byCursor: false } };
    if (res.kind === 'cascade') return { preview: { kind: 'cascade', target: res.below, pose: res.pose }, magnet: { kind: 'cascade', target: res.below, slot: res.pose, byCursor: false } };
    if (res.kind === 'tuck') {
      const pose = tuckDrawn(state.cards[d.ids[0]!], res.pose);
      return { preview: { kind: 'tuck', target: res.host, pose }, magnet: { kind: 'tuck', target: res.host, slot: pose, byCursor: false } };
    }
    if (res.kind === 'align') return { preview: null, magnet: { kind: 'align', target: res.to, slot: res.pose, byCursor: false } };
    if (res.kind === 'zone') {
      const hand = res.zone === ownHandZone() && overHandBand(d.last.x, d.last.y);
      if (hand) return { preview: null, magnet: { kind: 'hand', target: null, slot: null, byCursor: true } };
      const t = targets().find((x) => x.zone === res.zone);
      const slot: Pose | null = t?.rect ? { x: t.rect.x, y: t.rect.y, rot: t.rect.rot } : t?.circle ? { x: t.circle.x, y: t.circle.y, rot: r.anchorPose.rot } : null;
      // The stack lane is a lane, not a slot: no pull toward its centre.
      if (!slot || presentationOf(opts.game, state, res.zone) === 'cascade-lane') return none;
      const top = state.zones[res.zone]?.ids.at(-1) ?? null;
      return { preview: null, magnet: { kind: t?.circle ? 'hand' : 'zone', target: t?.rect ? top : null, slot, byCursor: true } };
    }
    return none;
  }

  // --- Affordances (PLAN M7-P5, Play without keys; scene/affordances.ts) -----------------------------------------------
  /** The library's bottom slot while a dragged card is over that library (or over the slot itself). */
  let libSlot: { zone: ZoneId; rect: Rect } | null = null;
  /**
   * What the drop in progress would do beyond the snap preview (draw, to hand, top or bottom of a library, attack), with
   * the ghost outlines it shows; null when it is a plain move. Recomputed when the pointer moves, shown as one label.
   */
  let dragHint: DragHint | null = null;
  /** The pile the pointer rests on or a click or tap chose (its actions show beside it). */
  let pileWant: { zone: ZoneId; via: 'hover' | 'tap' } | null = null;
  /** The selection anchor and pile hover last reported (null while things move). */
  let selAnchorNow: SelectionAnchor | null = null;
  let pileHoverNow: PileHover | null = null;
  /** Something the anchors depend on changed (selection, state, pile under the pointer, viewport). */
  let affordDirty = true;
  /** Whether the camera, the selection or a drag moved at the last check, and the camera pose then. */
  let affordMoving = false;
  let affordCam = '';
  /** The label of the drop in progress, over the canvas (no blur or backdrop filter: Safari). */
  const hintEl = document.createElement('div');
  hintEl.setAttribute('data-scene', 'drop-hint');
  hintEl.setAttribute('data-testid', 'drop-hint');
  Object.assign(hintEl.style, { position: 'absolute', left: '0', top: '0', display: 'none', pointerEvents: 'none', zIndex: '3', padding: '3px 10px', borderRadius: '999px', font: '600 13px/1.3 system-ui, sans-serif', whiteSpace: 'nowrap', transform: 'translate(-50%, -50%)' });
  host.appendChild(hintEl);

  /** The top card of its zone's pile (the one a press on the pile picks up). */
  function isPileTop(rc: RCard): boolean {
    const ids = state?.zones[rc.inst.zone]?.ids;
    return !!ids && ids[ids.length - 1] === rc.id;
  }

  /** The own hand when a drop at this viewport point goes there: the hand band at the bottom of the screen, the hand fan, or the own avatar spot. */
  function handDropAt(x: number, y: number, p: TablePoint): ZoneId | null {
    if (!state || viewerSeat === null) return null;
    const hand = opts.game.zones.find((z) => z.presentation === 'fan' && z.scope === 'seat');
    const own: ZoneId = `${hand?.id ?? 'hand'}:${viewerSeat}`;
    if (!state.zones[own]) return null;
    if (zoneTargetAt(p, targets())?.zone === own) return own;
    const vh = typeof window === 'undefined' ? canvasRect().bottom : window.innerHeight;
    if (inHandBand(y, vh, vh)) return own;
    const el = typeof document !== 'undefined' && typeof document.elementFromPoint === 'function' ? document.elementFromPoint(x, y) : null;
    return el instanceof Element && el.closest('[data-testid="hand"]') ? own : null;
  }

  /** The attacker the drop would block (scene/combat.ts), as finishDrag decides it: a block wins over an attack. */
  function blockTargetAt(d: DragState, p: TablePoint): InstanceId | null {
    if (!state || d.external) return null;
    const group = groupOf(d);
    const blockers = d.ids.filter((id) => id === group.anchor || group.reason[id] === 'selection');
    const under = pick(d.last.x, d.last.y, new Set(d.ids));
    return (under ? fanAttacker(state, under.id) : null) ?? fanUnder(state, blockers, p, combatCtx);
  }

  /** The cards a drop would send into an attack, and the seat it names (scene/affordances.ts attackDrop), or null. */
  function attackFor(d: DragState, p: TablePoint): { cards: CardInstance[]; target: AttackDrop['target'] } | null {
    if (!state || d.temp || d.external || d.fromLibrary) return null;
    if (blockTargetAt(d, p)) return null;
    const st = state;
    const group = groupOf(d);
    const leads = d.ids
      .filter((id) => id === group.anchor || group.reason[id] === 'selection')
      .map((id) => st.cards[id])
      .filter((c): c is CardInstance => !!c);
    const avatar = seatElementAt(d.last.x, d.last.y) ?? lineView.avatarAt(p);
    // The territories of the seats that are taken (an empty chair's half of a goldfish table is open table).
    const territories = Object.values(st.seats)
      .filter((s) => s.id === viewerSeat || s.name !== '' || s.peer !== undefined)
      .map((s) => seatLayoutOf(st, layout, s.id)?.territory)
      .filter((t): t is Rect => !!t);
    const angle = viewerAngle(st, layout, viewerSeat);
    const r = attackDrop(st, leads, p, {
      viewer: viewerSeat,
      seatLayout: (seat) => seatLayoutOf(st, layout, seat),
      territories,
      lane: { ...layout.stackLane, rot: layout.stackLane.rot + angle },
      avatarSeat: avatar?.kind === 'seat' ? avatar.id : null,
      battlefield: (z) => isBattlefield(z) === true,
    });
    return r ? { cards: leads, target: r.target } : null;
  }

  /**
   * Open the library's bottom slot while the dragged card is over a library, keep it while the pointer crosses the gap
   * to the slot (and on the slot), close it elsewhere. Returns whether the point is over a library. Run on every pointer
   * move of a card drag, not only once per frame: on a slow frame rate a quick move over the library onto the slot
   * would otherwise never be seen over the library.
   */
  function trackLibSlot(p: TablePoint): boolean {
    if (!state) return false;
    const t = zoneTargetAt(p, targets());
    const tz = t ? state.zones[t.zone] : undefined;
    if (t && tz?.kind === 'library') {
      const sl = seatLayoutOf(state, layout, tz.owner);
      const a = sl ? pileAnchor(sl, 'library') : null;
      libSlot = a ? { zone: t.zone, rect: libraryBottomSlot(a) } : null;
      return true;
    }
    if (libSlot) {
      // The slot stays while the pointer crosses the gap between the library and the slot (and on the slot itself).
      const m = GEOMETRY.gap + 6;
      const r = libSlot.rect;
      if (!pointInRect(p, { ...r, w: r.w + 2 * m, d: r.d + 2 * m })) libSlot = null;
    }
    return false;
  }

  /** A card drag's pointer moved: follow the library slot at once (trackLibSlot); the rest waits for the frame. */
  function dragPointerMoved(d: DragState): void {
    if (!state || d.temp || d.fromLibrary) return;
    const p = screenToTable(d.last.x, d.last.y);
    if (handDropAt(d.last.x, d.last.y, p)) return;
    trackLibSlot(p);
  }

  /** What the drag in progress would do beyond the snap rules, and the library slot it opened. */
  function computeDragHint(d: DragState): DragHint | null {
    if (!state || d.temp) {
      libSlot = null;
      return null;
    }
    const p = screenToTable(d.last.x, d.last.y);
    const handZone = handDropAt(d.last.x, d.last.y, p);
    if (d.fromLibrary) return handZone ? { kind: 'draw', at: null, ghosts: [] } : null;
    if (handZone) {
      libSlot = null;
      return { kind: 'hand', at: null, ghosts: [] };
    }
    const overLibrary = trackLibSlot(p);
    if (libSlot) {
      const r = libSlot.rect;
      const onSlot = !overLibrary && pointInRect(p, r);
      return { kind: onSlot ? 'bottom' : 'top', at: { x: r.x, y: r.y }, ghosts: [{ x: r.x, y: r.y, rot: r.rot }] };
    }
    const atk = attackFor(d, p);
    if (atk) {
      const ghosts = atk.cards.map((c) => {
        const a = attackPose(c, seatAngleOf(c.controller));
        return { ...a, rot: displayedRot({ pose: a, tapped: true }) };
      });
      return { kind: 'attack', at: ghosts[0] ? { x: ghosts[0].x, y: ghosts[0].y } : null, ghosts };
    }
    return null;
  }

  const sameDragHint = (a: DragHint | null, b: DragHint | null): boolean =>
    a === b || (!!a && !!b && a.kind === b.kind && a.ghosts.length === b.ghosts.length && (a.at === b.at || (!!a.at && !!b.at && Math.abs(a.at.x - b.at.x) < 1e-6 && Math.abs(a.at.y - b.at.y) < 1e-6)));
  const HINT_TEXT: Record<DragHint['kind'], string> = { draw: 'Draw', hand: 'To hand', top: 'Bottom ↓', bottom: 'Bottom of library', attack: 'Attack' };
  /** Show the drop label for the current hint (only when the hint changes: no per-frame DOM writes). */
  function syncDragHint(): void {
    const h = dragHint;
    if (!h) {
      if (hintEl.style.display !== 'none') hintEl.style.display = 'none';
      hintEl.removeAttribute('data-kind');
      return;
    }
    const c = theme.tokens.colours;
    const hr = host.getBoundingClientRect();
    let x: number;
    let y: number;
    if (h.at) {
      const s = worldToScreen({ x: h.at.x, y: h.at.y, z: 0 });
      x = (s?.x ?? hr.left + hr.width / 2) - hr.left;
      y = (s?.y ?? hr.top + hr.height / 2) - hr.top;
    } else {
      // Over the hand, at the pointer's side of the screen.
      x = Math.min(Math.max(60, (drag?.last.x ?? hr.width / 2) - hr.left), hr.width - 60);
      y = hr.height * (1 - 0.22) - 18;
    }
    hintEl.textContent = HINT_TEXT[h.kind];
    hintEl.setAttribute('data-kind', h.kind);
    const strong = h.kind !== 'top';
    Object.assign(hintEl.style, {
      display: 'block',
      left: `${Math.round(x)}px`,
      top: `${Math.round(y)}px`,
      background: strong ? c.focus : c.surface,
      color: strong ? c.surface : c.fg,
      border: `1px solid ${c.focus}`,
      opacity: strong ? '1' : '0.85',
    });
  }

  /** The zone pile under a viewport point (library, graveyard, exile), or null. */
  function pileUnder(x: number, y: number): ZoneId | null {
    const rc = pick(x, y);
    if (!rc || rc.place.kind !== 'pile' || rc.place.fanned) return null;
    return rc.inst.zone;
  }

  function setPileWant(next: typeof pileWant): void {
    // Read-only (M7-P5): no pile offers its actions.
    if (readOnly && next) next = null;
    if (next === pileWant || (next && pileWant && next.zone === pileWant.zone && next.via === pileWant.via)) return;
    pileWant = next;
    affordDirty = true;
  }

  /** The pointer moved over the table without a press: the pile under it, unless a click chose another. */
  function hoverPile(x: number, y: number): void {
    const z = pileUnder(x, y);
    if (z) {
      if (pileWant?.zone !== z) setPileWant({ zone: z, via: 'hover' });
    } else if (pileWant?.via === 'hover') setPileWant(null);
  }

  /** The selection's screen anchor now (scene/affordances.ts), from the cards as drawn. */
  function selectionAnchorNow(): SelectionAnchor | null {
    // Read-only (M7-P5): the selection is for reading; no strip stands beside it.
    if (readOnly) return null;
    // Cards drawn on the table and handled one by one: not another seat's hand row, not a card gone into a pile (a
    // selected card put into the graveyard leaves the strip behind).
    const ids = view.selection.filter((id) => {
      const k = rcards.get(id)?.place.kind;
      return k !== undefined && k !== 'hand' && k !== 'pile';
    });
    if (ids.length === 0) return null;
    const r = canvasRect();
    const rects: ScreenRect[] = [];
    const zones: ZoneId[] = [];
    for (const id of ids) {
      const rc = rcards.get(id)!;
      const b = screenRect(rc);
      rects.push({ x: b.x, y: b.y, width: b.width, height: b.height });
      zones.push(rc.inst.zone);
    }
    return selectionAnchorOf(ids, rects, zones, { x: r.left, y: r.top, width: r.width, height: r.height });
  }

  /** The chosen pile as it is drawn now, or null (an empty pile offers nothing). */
  function pileHoverNowOf(want: NonNullable<typeof pileWant>): PileHover | null {
    const zone = state?.zones[want.zone];
    if (!zone || zone.ids.length === 0) return null;
    const top = rcards.get(zone.ids[zone.ids.length - 1]!);
    if (!top || top.place.kind !== 'pile') return null;
    const b = screenRect(top);
    const rect = { x: Math.round(b.x), y: Math.round(b.y), width: Math.round(b.width), height: Math.round(b.height) };
    return { zone: zone.id, pile: null, owner: zone.owner, count: zone.ids.length, rect, via: want.via };
  }

  /**
   * Report the selection strip's anchor and the pile actions' anchor (SceneEvents.selectionAnchor, pileHover): null
   * while the camera, a drag or the selected cards move, the new anchors once they rest, and on any change. Runs every
   * tick but does work only around a change, so a still table reports nothing (Safari: no per-frame DOM or Svelte work).
   */
  function syncAffordances(force = false): void {
    if (!state) return;
    const cam = rig.pose();
    const camKey = `${cam.position[0]},${cam.position[1]},${cam.position[2]},${cam.target[0]},${cam.target[1]},${cam.target[2]},${cam.fovDeg}`;
    const camMoved = camKey !== affordCam;
    affordCam = camKey;
    const selMoving = view.selection.some((id) => {
      const rc = rcards.get(id);
      return !!rc && (rc.motion.moving || rc.lift.moving);
    });
    const handling = !!drag || !!clipDrag || !!itemDrag || (gesture !== null && gesture.kind !== 'press') || touchHold !== null;
    const moving = camMoved || selMoving || handling;
    if (!moving && !affordDirty && !affordMoving && !force) return;
    affordMoving = moving;
    affordDirty = false;
    const sel = moving ? null : selectionAnchorNow();
    if (!sameSelectionAnchor(sel, selAnchorNow)) {
      selAnchorNow = sel;
      opts.events.selectionAnchor?.(sel);
    }
    // The pile actions stay while only the selection moves (a tapped card turning); a drag or the camera hides them.
    const ph = camMoved || handling || !pileWant ? null : pileHoverNowOf(pileWant);
    if (!ph && pileWant && !camMoved && !handling) pileWant = null;
    if (!samePileHover(ph, pileHoverNow)) {
      pileHoverNow = ph;
      opts.events.pileHover?.(ph);
    }
  }

  /** The affordances as the debug hook reports them (PLAN M7-P5). */
  function affordanceDebug(): AffordanceDebugState {
    return { selection: selAnchorNow, pile: pileHoverNow, scrub: null };
  }

  function finishDrag(ctrl: boolean, cancel = false): void {
    const d = drag;
    if (!d || !state) {
      drag = null;
      return;
    }
    drag = null;
    preview = null;
    previewFor = null;
    magnet = null;
    magnetDrawn = null;
    handRoom.set(null);
    dirty = true;
    const now = performance.now();
    const insts = d.ids.map((id) => state!.cards[id]).filter((c): c is CardInstance => !!c);
    const anchorRc = rcards.get(d.ids[0]!);
    const back = () => {
      for (const id of d.ids) {
        const rc = rcards.get(id);
        if (rc) rc.motion.moveTo(rc.place.rest, 'spring', now, theme.motion, reduced());
      }
      for (const id of d.added) if (!state!.cards[id] || !placeCards(state!, view, { game: opts.game, layout, viewerSeat }).has(id)) rcards.delete(id);
      sortOrder();
      dirty = true;
    };
    const slot = libSlot;
    libSlot = null;
    dragHint = null;
    syncDragHint();
    if (cancel || !anchorRc || insts.length === 0) return back();
    const p = screenToTable(d.last.x, d.last.y);
    const a0 = d.start.get(d.ids[0]!)!;
    const anchorPose: Pose = { x: p.x + d.offset.x, y: p.y + d.offset.y, rot: a0.rot };
    const group = groupOf(d);
    let actions: ActionDraft[];
    let predicted: Map<InstanceId, Pose> | null = null;
    const handZone = handDropAt(d.last.x, d.last.y, p);
    // The top of the own library dropped in the hand is drawn (PLAN M7-P5: "drag from library to hand draws"); the
    // session draws it as the library's own action (the pile's first action, PILE_ACTIONS.library: draw), so the scene
    // never names which hidden card that is. Anywhere else it goes back on the pile.
    if (d.fromLibrary) {
      back();
      if (handZone !== null) opts.events.pileOpen?.(insts[0]!.zone);
      return;
    }
    // Dropped in the hand at the bottom of the screen (or on the own avatar spot, rule 1): to the owner's hand, as H
    // does (PLAN M7-P5: "drag to every zone (hand, …)").
    if (handZone !== null && !d.temp) {
      const zone = `hand:${insts[0]!.owner}`;
      if (!state.zones[zone]) return back();
      const drafts = toStoredPoses(state, carryDropActions(state, group, d.start, { rule: 1, kind: 'zone', zone }, { zone: insts[0]!.zone, controller: insts[0]!.controller }, { newId, presentation: (z) => presentationOf(opts.game, state!, z) }));
      if (drafts.length === 0) return back();
      lastDrop = { rule: 1, kind: 'zone', zone };
      markLocal(d, null, now);
      dispatch(withUnblock(state, drafts, d.ids, combatCtx));
      return;
    }
    // Dropped on the bottom slot beside a library (shown while the card is over the library): its bottom.
    if (slot && !d.temp && pointInRect(p, slot.rect)) {
      const drafts = carryDropActions(state, group, d.start, { rule: 1, kind: 'zone', zone: slot.zone }, { zone: insts[0]!.zone, controller: insts[0]!.controller }, { newId, presentation: (z) => presentationOf(opts.game, state!, z) }).map((a): ActionDraft => (a.type === 'toZone' ? { ...a, position: 'bottom' } : a));
      if (drafts.length === 0) return back();
      lastDrop = { rule: 1, kind: 'zone', zone: slot.zone };
      markLocal(d, null, now);
      dispatch(withUnblock(state, drafts, d.ids, combatCtx));
      return;
    }
    // Dropped onto another seat's attacker (or its blocker fan): a block (DESIGN "Combat and annotation", Block). The
    // blockers are the grabbed card and the selection; their attachments come along (owner decisions, Combat).
    const blockers = d.ids.filter((id) => id === group.anchor || group.reason[id] === 'selection');
    const under = d.external ? null : pick(d.last.x, d.last.y, new Set(d.ids));
    // Dropped back inside its own fan with nothing under the pointer: a reorder (or nothing), not an unblock.
    const attacker = (under ? fanAttacker(state, under.id) : null) ?? (d.external ? null : fanUnder(state, blockers, p, combatCtx));
    const plan = attacker ? blockPlan(state, blockers, attacker, p, combatCtx) : null;
    if (plan) {
      if (plan.actions.length === 0) return back();
      predicted = new Map();
      for (const [id, pose] of plan.poses) {
        const c = state.cards[id];
        if (c && d.ids.includes(id)) predicted.set(id, { x: pose.x, y: pose.y, rot: displayedRot({ pose, tapped: c.tapped }) });
      }
      markLocal(d, predicted, now);
      dispatch(plan.actions);
      return;
    }
    // Pushed toward an opponent: an attack, as the Attack shortcut does it (PLAN M7-P5; DESIGN "Combat and annotation").
    const attack = d.temp || d.external ? null : attackFor(d, p);
    if (attack) {
      const leads = attack.cards;
      const out: ActionDraft[] = leads.map((c): ActionDraft => ({ type: 'moveTemp', card: c.id, pose: attackPose(c, seatAngleOf(c.controller)), combat: 'attack', tap: true }));
      // Several opponents: the attack line names the one it was pushed onto (Attack target 2).
      if (attack.target !== null && viewerSeat !== null && opponents(state, viewerSeat).length > 1) {
        for (const c of leads) out.push({ type: 'lineAdd', line: newId('ln'), kind: 'attack', from: { kind: 'card', id: c.id }, to: { kind: 'seat', id: attack.target } });
      }
      const g = out.length > 1 ? newId('g') : null;
      const drafts = g ? out.map((a) => ({ ...a, group: g })) : out;
      lastDrop = null;
      const poses = new Map<InstanceId, Pose>();
      for (const c of leads) {
        const at = attackPose(c, seatAngleOf(c.controller));
        poses.set(c.id, { ...at, rot: displayedRot({ pose: at, tapped: true }) });
      }
      // Riders that were carried along stay where they were.
      for (const id of d.ids) if (!poses.has(id)) rcards.get(id)?.motion.moveTo(rcards.get(id)!.place.rest, 'spring', now, theme.motion, reduced());
      markLocal({ ...d, ids: leads.map((c) => c.id) }, poses, now);
      dispatch(drafts);
      return;
    }
    if (d.temp) {
      // Rigid around the grabbed card, as the preview shows it (M6.1), even when it rides on a host in the group.
      actions = tempCarryActions(state, group, d.start, anchorPose, { newId });
      predicted = rigidPoses(group, d.start, anchorPose);
    } else {
      const r = resolveFor(d, ctrl);
      if (!r) return back();
      const { result, dest } = r;
      lastDrop = result;
      // Dropped back over the hand it came from: it stays there (the fan closes the room it made).
      if (result.kind === 'zone' && result.zone === ownHandZone() && insts.every((c) => c.zone === result.zone)) return back();
      // An item's card dropped back into the lane moves to the slot under the pointer (DESIGN "The effect stack",
      // Resolving 4: items can be reordered by hand).
      const anchorInst = insts[0]!;
      if (result.kind === 'zone' && result.zone === anchorInst.zone && presentationOf(opts.game, state, result.zone) === 'cascade-lane') {
        const item = state.stack.find((i) => i.card === anchorInst.id);
        const to = slotAt(layout.stackLane, viewerAngle(state, layout, viewerSeat), p, state.stack.length);
        if (!item || state.stack.indexOf(item) === to) return back();
        for (const id of d.ids) {
          const r2 = rcards.get(id);
          if (r2) r2.localUntil = now + EXPECT_MS;
        }
        back();
        dispatch([{ type: 'stackReorder', item: item.id, index: to }]);
        return;
      }
      if (result.kind !== 'zone' && !dest) return back();
      // The carry group lands as one gesture (scene/carry.ts; PLAN Milestone 6, owner decisions).
      actions = carryDropActions(state, group, d.start, result, dest ?? { zone: insts[0]!.zone, controller: insts[0]!.controller }, {
        newId,
        presentation: (z) => presentationOf(opts.game, state!, z),
      });
      if (result.kind === 'tuck') predicted = new Map([[anchorInst.id, tuckDrawn(anchorInst, result.pose)]]);
      else if (result.kind === 'align' || result.kind === 'free') predicted = rigidPoses(group, d.start, result.pose);
      else if (result.kind !== 'zone') predicted = offsetPoses(d, result.pose);
    }
    if (actions.length === 0) return back();
    // Drag poses are drawn poses; the state stores tapped cards without their tap turn.
    actions = toStoredPoses(state, actions);
    // A blocker dragged away from its fan no longer blocks: its block lines go (before the drop) and the fan closes up.
    actions = withUnblock(state, actions, d.ids, combatCtx);
    markLocal(d, predicted, now);
    dispatch(actions);
  }

  /** After a drop: the dragged cards spring to their predicted poses and wait for the state to confirm them. */
  function markLocal(d: DragState, predicted: Map<InstanceId, Pose> | null, now: number): void {
    for (const id of d.ids) {
      const rc = rcards.get(id);
      if (!rc) continue;
      rc.localUntil = now + EXPECT_MS;
      const target = predicted?.get(id);
      if (target) {
        rc.motion.moveTo(target, 'spring', now, theme.motion, reduced());
        rc.expect = { pose: target, until: now + EXPECT_MS };
      }
    }
    sortOrder();
    dirty = true;
  }

  function offsetPoses(d: DragState, anchor: Pose): Map<InstanceId, Pose> {
    const a0 = d.start.get(d.ids[0]!)!;
    const out = new Map<InstanceId, Pose>();
    for (const id of d.ids) {
      const s = d.start.get(id)!;
      out.set(id, id === d.ids[0] ? anchor : { x: anchor.x + (s.x - a0.x), y: anchor.y + (s.y - a0.y), rot: s.rot });
    }
    return out;
  }

  let lastDrop: DropResult | null = null;

  /** Pick up a stack marker (markers are not cards: they never go through startCardDrag). */
  function startItemDrag(item: StackItemId, pointerId: number, x: number, y: number): boolean {
    if (readOnly) return false;
    const e = entries.find((x) => x.item.id === item);
    if (!state || !e || !e.marker) return false;
    const p = screenToTable(x, y);
    itemDrag = { pointerId, item, offset: { x: e.pose.x - p.x, y: e.pose.y - p.y }, last: { x, y } };
    dirty = true;
    return true;
  }

  /**
   * Drop a stack marker (DESIGN "The effect stack", Resolving 4: any item can be dragged out of the stack or
   * reordered by hand): in the lane it takes the slot under the pointer; anywhere else it leaves the stack, which
   * for a marker means it is removed (Resolving 3: counter removes a marker). Only the top item can be countered, so
   * a buried marker is moved to the top first, in the same group (one log step, one undo).
   */
  function finishItemDrag(cancel = false): void {
    const d = itemDrag;
    itemDrag = null;
    dirty = true;
    if (!d || cancel || !state) return;
    const st = state;
    const from = st.stack.findIndex((i) => i.id === d.item);
    if (from < 0) return;
    const p = screenToTable(d.last.x, d.last.y);
    const target = zoneTargetAt(p, targets());
    if (target && presentationOf(opts.game, st, target.zone) === 'cascade-lane') {
      const to = slotAt(layout.stackLane, viewerAngle(st, layout, viewerSeat), p, st.stack.length);
      if (to !== from) dispatch([{ type: 'stackReorder', item: d.item, index: to }]);
      return;
    }
    const top = st.stack.length - 1;
    if (from === top) {
      dispatch([{ type: 'stackCounter', item: d.item }]);
      return;
    }
    const group = newId('g');
    dispatch([
      { type: 'stackReorder', item: d.item, index: top, group },
      { type: 'stackCounter', item: d.item, group },
    ]);
  }

  // --- Pointer input ------------------------------------------------------------------------------------------------
  function onPointerDown(e: PointerEvent): void {
    if (touchInput.take(e)) {
      if (touchInput.recognizer.fingers() > 1) touchSecondFinger({ x: e.clientX, y: e.clientY });
      try {
        canvas.setPointerCapture(e.pointerId);
      } catch {
        // Synthetic events without an active pointer cannot be captured.
      }
      return;
    }
    if (gesture || clipDrag) return;
    if (e.button !== 0 && e.button !== 1 && e.button !== 2) return;
    if (e.button === 1) e.preventDefault();
    // A clip lies over the cards (M6-P1): a left press may pick it up, a right press opens its menu (onContextMenu).
    const clip = e.button === 1 ? null : clipUnder(e.clientX, e.clientY);
    if (clip) {
      menuPending = null;
      if (e.button !== 0) return;
      gesture = { kind: 'press', pointerId: e.pointerId, button: 0, card: null, item: null, x0: e.clientX, y0: e.clientY, shift: e.shiftKey, alt: e.altKey, pileGrab: false, clip };
      try {
        canvas.setPointerCapture(e.pointerId);
      } catch {
        // Synthetic events without an active pointer cannot be captured.
      }
      return;
    }
    const rc = pick(e.clientX, e.clientY);
    // Right button: a press on a public card may become a line (right-drag); on empty table in the ego rig a
    // right-drag pitches; elsewhere it is the context menu alone.
    if (e.button === 2 && (!rc || !lineSource(rc)) && (rc || rig.rig() !== 'ego')) return;
    menuPending = null;
    const pileGrab = !!rc && rc.inst.pile?.kind === 'squared' && onPileBadge(rc, e.clientX, e.clientY);
    const item = rc ? null : (markerAt(screenToTable(e.clientX, e.clientY))?.item.id ?? null);
    gesture = { kind: 'press', pointerId: e.pointerId, button: e.button, card: rc?.id ?? null, item, x0: e.clientX, y0: e.clientY, shift: e.shiftKey, alt: e.altKey, pileGrab };
    // Holding the left button still where cards overlap clips them (M6-P1).
    if (e.button === 0 && rc && !e.shiftKey && !e.altKey) startHold(e.pointerId, e.clientX, e.clientY);
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch {
      // Synthetic events without an active pointer cannot be captured.
    }
  }

  /**
   * A right press on an item of the far-zoom badge's list (scene/stack-badge.ts): a press gesture as on the item's card
   * in the lane, so dragging it draws a line from that stack item (DESIGN "Combat and annotation"; the collapsed lane
   * draws no cards to start from).
   */
  function startBadgeLine(item: StackItemId, e: PointerEvent): void {
    if (gesture || !stackFolded) return;
    const entry = entries.find((x) => x.item.id === item);
    if (!entry) return;
    menuPending = null;
    gesture = { kind: 'press', pointerId: e.pointerId, button: 2, card: entry.item.card ?? null, item, x0: e.clientX, y0: e.clientY, shift: e.shiftKey, alt: e.altKey, pileGrab: false, badge: true };
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch {
      // Synthetic events without an active pointer cannot be captured.
    }
  }

  /** The anchor a right-drag from this card draws from (scene/lines.ts lineSourceOf). */
  const lineSource = (rc: RCard) => (state ? lineSourceOf(state, rc.id) : null);

  /**
   * The thing under a screen point a line can end at: a public card (its stack item on the stack), a player's avatar
   * in the screen-anchored layer (any element marked `data-line-seat`, DESIGN "Combat and annotation": card to
   * player), or a seat's avatar spot on the table.
   */
  function lineTargetAt(x: number, y: number, exclude: InstanceId) {
    // An item of the far-zoom badge's expanded list (M5-P7): the collapsed lane's items are reached there.
    const listed = stackBadge.itemAt(x, y);
    if (listed && state?.stack.some((i) => i.id === listed)) return { kind: 'stackItem' as const, id: listed };
    const seat = seatElementAt(x, y);
    if (seat) return seat;
    const rc = pick(x, y, new Set([exclude]));
    return rc ? lineSource(rc) : lineView.avatarAt(screenToTable(x, y));
  }

  /** A seat anchor for a screen-layer element at a client point that names a seat of this table, or null. */
  function seatElementAt(x: number, y: number): { kind: 'seat'; id: SeatId } | null {
    if (!state || typeof document === 'undefined' || typeof document.elementFromPoint !== 'function') return null;
    const el = document.elementFromPoint(x, y);
    const host = el instanceof Element ? el.closest('[data-line-seat]') : null;
    const id = host?.getAttribute('data-line-seat') ?? '';
    return id && Object.hasOwn(state.seats, id) ? { kind: 'seat', id } : null;
  }

  function onPileBadge(rc: RCard, x: number, y: number): boolean {
    const p = screenToCardPlane(x, y, drawnZ(rc));
    if (!p) return false;
    const pose = rc.motion.pose;
    const [bx, by] = rot2(-CARD_W / 2 + 8, CARD_H / 2 - 8, pose.rot);
    return Math.hypot(p.x - (pose.x + bx), p.y - (pose.y + by)) <= 8;
  }

  function onPointerMove(e: PointerEvent): void {
    if (touchInput.take(e)) return;
    if (drag && e.pointerId === drag.pointerId && !drag.external) {
      drag.last = { x: e.clientX, y: e.clientY };
      drag.ctrl = e.ctrlKey;
      dragPointerMoved(drag);
      return;
    }
    if (clipDrag && e.pointerId === clipDrag.pointerId && !clipDrag.external) {
      clipDrag.last = { x: e.clientX, y: e.clientY };
      dirty = true;
      return;
    }
    if (gesture?.kind === 'line' && e.pointerId === gesture.pointerId) {
      const dr = lineView.draft;
      if (dr) {
        dr.cur = screenToTable(e.clientX, e.clientY);
        stackBadge.trackLine({ x: e.clientX, y: e.clientY });
        dr.target = lineTargetAt(e.clientX, e.clientY, dr.sourceCard);
        dr.shift = e.shiftKey;
      }
      dirty = true;
      return;
    }
    if (itemDrag && e.pointerId === itemDrag.pointerId) {
      itemDrag.last = { x: e.clientX, y: e.clientY };
      dirty = true;
      return;
    }
    if (!gesture) {
      const clip = clipUnder(e.clientX, e.clientY);
      setHoverClip(clip);
      const rc = clip ? null : pick(e.clientX, e.clientY);
      setHover(rc?.id ?? null);
      setHoverItem(clip ? null : itemAt(e.clientX, e.clientY, rc));
      // The pile under the pointer offers its actions (PLAN M7-P5: "hovering … a pile shows its few actions").
      if (clip) {
        if (pileWant?.via === 'hover') setPileWant(null);
      } else hoverPile(e.clientX, e.clientY);
      return;
    }
    if (e.pointerId !== ('pointerId' in gesture ? gesture.pointerId : -1)) return;
    if (gesture.kind === 'press') {
      const g = gesture;
      const moved = Math.hypot(e.clientX - g.x0, e.clientY - g.y0);
      if (moved < Math.max(DRAG_THRESHOLD_PX, CLIP.holdSlopPx)) return;
      cancelHold();
      if (g.clip) {
        // A clip picked up: it follows the pointer until released (M6-P1).
        startClipDrag(g.pointerId, g.clip, e.clientX, e.clientY, false);
        gesture = { kind: 'drag' };
        return;
      }
      const rc = g.card ? rcards.get(g.card) : null;
      if (g.button === 2 && !rc && !g.badge && rig.rig() === 'ego') {
        menuPending = null;
        gesture = { kind: 'pitch', pointerId: g.pointerId, last: { x: e.clientX, y: e.clientY } };
        rig.pitchBy((e.clientY - g.y0) * PITCH_DEG_PER_PX);
        setHover(null);
        dirty = true;
        return;
      }
      if (g.button === 2 && readOnly) {
        // Read-only (M7-P5): a right-drag from a card draws no line; nothing happens until the release.
        menuPending = null;
        gesture = null;
        release(e);
        return;
      }
      if (g.button === 2) {
        // From the badge's list the source is the stack item itself (a marker has no card).
        const source = g.badge && g.item ? { kind: 'stackItem' as const, id: g.item } : rc ? lineSource(rc) : null;
        const sourceCard = rc?.id ?? g.card ?? g.item;
        menuPending = null;
        if (g.badge) stackBadge.trackLine({ x: e.clientX, y: e.clientY });
        lineView.draft = source && sourceCard ? { pointerId: g.pointerId, source, sourceCard, target: lineTargetAt(e.clientX, e.clientY, sourceCard), cur: screenToTable(e.clientX, e.clientY), shift: e.shiftKey || g.shift } : null;
        gesture = lineView.draft ? { kind: 'line', pointerId: g.pointerId } : null;
        if (!gesture) release(e);
        setHover(null);
        dirty = true;
        return;
      }
      if (g.button === 0 && rc && startCardDrag(rc, g.pointerId, g.x0, g.y0, g.alt, g.pileGrab)) {
        gesture = { kind: 'drag' };
        drag!.last = { x: e.clientX, y: e.clientY };
        drag!.ctrl = e.ctrlKey;
        setHover(null);
        return;
      }
      if (g.button === 0 && !rc && g.item && startItemDrag(g.item, g.pointerId, g.x0, g.y0)) {
        gesture = { kind: 'drag' };
        itemDrag!.last = { x: e.clientX, y: e.clientY };
        setHoverItem(null);
        return;
      }
      if (g.button === 0 && g.shift && !rc) {
        gesture = { kind: 'marquee', pointerId: g.pointerId, x0: g.x0, y0: g.y0, x1: e.clientX, y1: e.clientY, base: [...view.selection] };
        showMarquee(gesture);
        return;
      }
      rig.stop();
      gesture = { kind: 'pan', pointerId: g.pointerId, last: { x: g.x0, y: g.y0 }, samples: [{ x: g.x0, y: g.y0, t: performance.now() }] };
    }
    if (gesture.kind === 'pitch') {
      rig.pitchBy((e.clientY - gesture.last.y) * PITCH_DEG_PER_PX);
      gesture.last = { x: e.clientX, y: e.clientY };
      dirty = true;
    } else if (gesture.kind === 'pan') {
      const g = gesture;
      rig.panBy(e.clientX - g.last.x, e.clientY - g.last.y);
      g.last = { x: e.clientX, y: e.clientY };
      const t = performance.now();
      g.samples.push({ x: e.clientX, y: e.clientY, t });
      while (g.samples.length > 2 && t - g.samples[0]!.t > 100) g.samples.shift();
      dirty = true;
    } else if (gesture.kind === 'marquee') {
      gesture.x1 = e.clientX;
      gesture.y1 = e.clientY;
      showMarquee(gesture);
    }
  }

  function showMarquee(g: { x0: number; y0: number; x1: number; y1: number }): void {
    const hr = host.getBoundingClientRect();
    Object.assign(marqueeEl.style, {
      display: 'block',
      left: `${Math.min(g.x0, g.x1) - hr.left}px`,
      top: `${Math.min(g.y0, g.y1) - hr.top}px`,
      width: `${Math.abs(g.x1 - g.x0)}px`,
      height: `${Math.abs(g.y1 - g.y0)}px`,
    });
  }

  function onPointerUp(e: PointerEvent): void {
    if (touchInput.take(e)) {
      release(e);
      touchReleased();
      return;
    }
    if (drag && e.pointerId === drag.pointerId && !drag.external) {
      drag.last = { x: e.clientX, y: e.clientY };
      dragPointerMoved(drag);
      finishDrag(e.ctrlKey);
      gesture = null;
      release(e);
      return;
    }
    if (itemDrag && e.pointerId === itemDrag.pointerId) {
      itemDrag.last = { x: e.clientX, y: e.clientY };
      finishItemDrag();
      gesture = null;
      release(e);
      return;
    }
    if (clipDrag && e.pointerId === clipDrag.pointerId && !clipDrag.external) {
      clipDrag.last = { x: e.clientX, y: e.clientY };
      finishClipDrag();
      gesture = null;
      release(e);
      return;
    }
    if (clipHold?.pointerId === e.pointerId) cancelHold();
    const g = gesture;
    if (!g || ('pointerId' in g && g.pointerId !== e.pointerId)) return;
    gesture = null;
    release(e);
    // A right press on the far-zoom badge's list that never became a line lets the list go (scene/stack-badge.ts); it
    // stays open while the pointer rests on it.
    if (g.kind === 'press' && g.badge) stackBadge.trackLine({ x: e.clientX, y: e.clientY }, true);
    if (g.kind === 'pitch') {
      // The context menu some platforms fire on release does not open after a pitch.
      menuSuppressUntil = performance.now() + MENU_SUPPRESS_MS;
      return;
    }
    if (g.kind === 'line') {
      menuSuppressUntil = performance.now() + MENU_SUPPRESS_MS;
      const dr = lineView.draft;
      dispatch(lineView.finish(dr ? lineTargetAt(e.clientX, e.clientY, dr.sourceCard) : null, e.shiftKey, newId));
      // The badge's list stays open while the pointer rests on it (as a hover), else it collapses.
      stackBadge.trackLine({ x: e.clientX, y: e.clientY }, true);
      dirty = true;
      return;
    }
    if (g.kind === 'press') {
      if (g.button === 2) {
        // A right press that did not drag: the context menu, if the platform asked for it on press.
        const m = menuPending;
        menuPending = null;
        if (m) opts.events.contextMenu?.(m.card, m.at);
        return;
      }
      if (g.button === 1) {
        if (g.card) opts.events.inspect?.(g.card);
        return;
      }
      // A click on a clip is not a click on the table (double-click removes it).
      if (g.clip) return;
      clickAt(e.clientX, e.clientY, g.card, g.item, g.shift);
    } else if (g.kind === 'pan') {
      const s = g.samples;
      const first = s[0]!;
      const last = s[s.length - 1]!;
      const dt = last.t - first.t;
      if (!reduced() && dt > 0 && performance.now() - last.t < 80) rig.fling((last.x - first.x) / dt, (last.y - first.y) / dt);
    } else if (g.kind === 'marquee') finishMarquee(g);
  }

  /**
   * A click or tap (DESIGN "Card manipulation"; "Input and interaction design", Touch: tap selects): a card becomes the
   * selection (Shift adds or removes it), empty table clears it, and a seat's avatar spot goes to that seat (DESIGN
   * "Camera and navigation": go to another seat, tap an avatar).
   */
  function clickAt(x: number, y: number, card: InstanceId | null, item: StackItemId | null, shift: boolean): void {
    // A click or tap on a zone pile (library, graveyard, exile) shows its actions beside it and keeps them until the
    // next click elsewhere (PLAN M7-P5: "a click on the library pile offers Draw"); it selects nothing.
    const pileZone = card && !shift ? pileUnder(x, y) : null;
    if (pileZone) {
      setPileWant({ zone: pileZone, via: 'tap' });
      if (view.selection.length) setSelection([]);
      return;
    }
    if (pileWant?.via === 'tap') setPileWant(null);
    if (card) {
      if (shift) setSelection(view.selection.includes(card) ? view.selection.filter((id) => id !== card) : [...view.selection, card]);
      else if (!view.selection.includes(card) || view.selection.length > 1) setSelection([card]);
    } else {
      if (!shift && view.selection.length) setSelection([]);
      const seat = item ? null : lineView.avatarAt(screenToTable(x, y));
      if (seat?.kind === 'seat') controls.goToSeat(seat.id);
    }
  }

  /** Select the free cards a marquee touches, added to those selected when it started. */
  function finishMarquee(g: { x0: number; y0: number; x1: number; y1: number; base: InstanceId[] }): void {
    marqueeEl.style.display = 'none';
    const x0 = Math.min(g.x0, g.x1);
    const x1 = Math.max(g.x0, g.x1);
    const y0 = Math.min(g.y0, g.y1);
    const y1 = Math.max(g.y0, g.y1);
    const hit = order.filter((rc) => {
      if (rc.place.kind !== 'free') return false;
      const r = screenRect(rc);
      return r.right >= x0 && r.left <= x1 && r.bottom >= y0 && r.top <= y1;
    });
    const ids = [...g.base];
    for (const rc of hit) if (!ids.includes(rc.id)) ids.push(rc.id);
    setSelection(ids);
  }

  function release(e: PointerEvent): void {
    try {
      if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
    } catch {
      // ignore
    }
  }

  function onPointerCancel(e: PointerEvent): void {
    if (touchInput.take(e)) {
      touchReleased(true);
      return;
    }
    if (drag && drag.pointerId === e.pointerId) finishDrag(false, true);
    if (itemDrag && itemDrag.pointerId === e.pointerId) finishItemDrag(true);
    if (clipDrag && clipDrag.pointerId === e.pointerId && !clipDrag.external) finishClipDrag(true);
    if (clipHold?.pointerId === e.pointerId) cancelHold();
    if (gesture?.kind === 'marquee') marqueeEl.style.display = 'none';
    if (gesture?.kind === 'line') dirty = true;
    if (gesture?.kind === 'line' || (gesture?.kind === 'press' && gesture.badge)) stackBadge.trackLine(null);
    lineView.draft = null;
    gesture = null;
    menuPending = null;
  }

  // --- Touch (DESIGN "Input and interaction design", Touch; "Camera and navigation", Navigation gestures; M5-P1) -------
  /** What the one-finger gesture under way holds. */
  let touchHold:
    | { kind: 'card' | 'item' | 'line' | 'clip' }
    | { kind: 'pan'; last: ScreenPoint; samples: { x: number; y: number; t: number }[] }
    | { kind: 'marquee'; x0: number; y0: number; x1: number; y1: number; base: InstanceId[] }
    | null = null;
  /** A long-press on empty table: the table menu opens when the finger lifts, unless it drags a marquee instead. */
  let touchTableMenu: ScreenPoint | null = null;
  /** The radial menu this scene opened for a long-press (closed again when the finger goes on to draw a line). */
  let touchRadial = false;
  /** A long-press on a clip opened its menu: the finger lifting or dragging on draws no line. */
  let touchClipMenu = false;
  /** The one-finger touch started on an item of the far-zoom badge's list (scene/stack-badge.ts onTouch). */
  let touchBadge: { item: StackItemId; lastY: number } | null = null;

  /**
   * A finger's pointer events on an item of the far-zoom badge's expanded list (the badge holds that finger, so the
   * canvas gets none): they feed the same touch gestures as the canvas, so long-press then drag draws a line from the
   * stack item as from a card on iPad (DESIGN "Input and interaction design", Touch; "The effect stack": lines from
   * stack items; the right press of a mouse does it with startBadgeLine).
   */
  function badgeTouch(item: StackItemId, e: PointerEvent): void {
    if (e.type === 'pointerdown' && !touchInput.active()) touchBadge = { item, lastY: e.clientY };
    if (!touchInput.take(e)) return;
    if (e.type === 'pointerdown' && touchInput.recognizer.fingers() > 1) touchSecondFinger({ x: e.clientX, y: e.clientY });
    if (e.type === 'pointerup' || e.type === 'pointercancel') touchReleased(e.type === 'pointercancel');
  }

  /**
   * A one-finger gesture that started on an item of the badge's list: long-press then drag draws a line from that
   * stack item, a plain drag scrolls the list; a tap or a long-press alone does nothing on the table under the badge.
   */
  function badgeGesture(b: { item: StackItemId; lastY: number }, g: TouchGesture): void {
    if (g.kind === 'drag') {
      if (g.phase === 'start' || g.phase === 'move') stackBadge.scrollList(b.lastY - g.at.y);
      b.lastY = g.at.y;
      return;
    }
    if (g.kind !== 'longPressDrag') return;
    if (g.phase !== 'start') {
      touchLine(g);
      return;
    }
    const entry = stackFolded && !readOnly ? entries.find((x) => x.item.id === b.item) : undefined;
    if (!entry) return;
    const sourceCard = entry.item.card ?? b.item;
    lineView.draft = { pointerId: -1, source: { kind: 'stackItem', id: b.item }, sourceCard, target: lineTargetAt(g.at.x, g.at.y, sourceCard), cur: screenToTable(g.at.x, g.at.y), shift: false };
    touchHold = { kind: 'line' };
    touchInput.capture();
    stackBadge.trackLine(g.at);
    dirty = true;
  }

  function onTouchGesture(g: TouchGesture): void {
    if (touchBadge && g.kind !== 'twoFinger' && g.kind !== 'twoFingerDoubleTap') {
      badgeGesture(touchBadge, g);
      return;
    }
    switch (g.kind) {
      case 'tap': {
        if (clipUnder(g.at.x, g.at.y, true)) return;
        const rc = pick(g.at.x, g.at.y);
        const item = rc ? null : (markerAt(screenToTable(g.at.x, g.at.y))?.item.id ?? null);
        clickAt(g.at.x, g.at.y, rc?.id ?? null, item, false);
        return;
      }
      case 'doubleTap':
        doubleAt(g.at.x, g.at.y, true);
        return;
      case 'twoFingerDoubleTap':
        controls.fit(true);
        return;
      case 'longPress': {
        if (readOnly) {
          // Read-only (M7-P5): a long-press on a card inspects it; no action menu opens.
          const ro = pick(g.at.x, g.at.y);
          if (ro) opts.events.inspect?.(ro.id);
          return;
        }
        const clip = clipUnder(g.at.x, g.at.y, true);
        if (clip) {
          touchClipMenu = true;
          opts.events.clipMenu?.(clip, g.at);
          return;
        }
        const rc = pick(g.at.x, g.at.y);
        if (!rc) {
          touchTableMenu = g.at;
          return;
        }
        if (opts.events.radialMenu) {
          touchRadial = true;
          opts.events.radialMenu(rc.id, g.at);
        } else opts.events.contextMenu?.(rc.id, g.at);
        return;
      }
      case 'drag':
        return touchDrag(g);
      case 'longPressDrag':
        return touchLine(g);
      case 'twoFinger': {
        touchTableMenu = null;
        if (g.phase === 'start') rig.stop();
        if (g.phase !== 'start' && g.phase !== 'move') return;
        // Two-finger vertical drag pitches in the ego rig (pitch is ego only; in bird's-eye it pans like any two-finger drag).
        if (g.mode === 'pitch' && rig.rig() === 'ego') rig.pitchBy(g.pan.dy * PITCH_DEG_PER_PX);
        else {
          rig.panBy(g.pan.dx, g.pan.dy);
          const c = toCanvas(g.centre.x, g.centre.y);
          if (g.scale !== 1) rig.zoomAt(c.x, c.y, g.scale);
        }
        dirty = true;
        return;
      }
    }
  }

  /** One finger dragging: a card moves (with its pile or the selection), a stack marker moves, else the table pans. */
  function touchDrag(g: Extract<TouchGesture, { kind: 'drag' }>): void {
    const h = touchHold;
    if (g.phase === 'start') {
      touchTableMenu = null;
      const clip = clipUnder(g.start.x, g.start.y, true);
      if (clip) {
        startClipDrag(-1, clip, g.at.x, g.at.y, false);
        touchHold = { kind: 'clip' };
        touchInput.capture();
        return;
      }
      const rc = pick(g.start.x, g.start.y);
      const pileGrab = !!rc && rc.inst.pile?.kind === 'squared' && onPileBadge(rc, g.start.x, g.start.y);
      if (rc && startCardDrag(rc, -1, g.start.x, g.start.y, false, pileGrab)) {
        drag!.last = { x: g.at.x, y: g.at.y };
        touchHold = { kind: 'card' };
        touchInput.capture();
        return;
      }
      const item = rc ? null : markerAt(screenToTable(g.start.x, g.start.y));
      if (item && startItemDrag(item.item.id, -1, g.start.x, g.start.y)) {
        itemDrag!.last = { x: g.at.x, y: g.at.y };
        touchHold = { kind: 'item' };
        touchInput.capture();
        dirty = true;
        return;
      }
      rig.stop();
      rig.panBy(g.at.x - g.start.x, g.at.y - g.start.y);
      touchHold = { kind: 'pan', last: g.at, samples: [{ x: g.start.x, y: g.start.y, t: g.t }, { x: g.at.x, y: g.at.y, t: g.t }] };
      dirty = true;
      return;
    }
    if (!h) return;
    if (g.phase === 'move') {
      if (h.kind === 'card' && drag) drag.last = { x: g.at.x, y: g.at.y };
      else if (h.kind === 'clip' && clipDrag) clipDrag.last = { x: g.at.x, y: g.at.y };
      else if (h.kind === 'item' && itemDrag) itemDrag.last = { x: g.at.x, y: g.at.y };
      else if (h.kind === 'pan') {
        rig.panBy(g.at.x - h.last.x, g.at.y - h.last.y);
        h.last = g.at;
        h.samples.push({ x: g.at.x, y: g.at.y, t: g.t });
        while (h.samples.length > 2 && g.t - h.samples[0]!.t > 100) h.samples.shift();
      }
      dirty = true;
      return;
    }
    touchHold = null;
    const cancel = g.phase === 'cancel';
    if (h.kind === 'card' && drag) {
      drag.last = { x: g.at.x, y: g.at.y };
      finishDrag(false, cancel);
    } else if (h.kind === 'clip' && clipDrag) {
      clipDrag.last = { x: g.at.x, y: g.at.y };
      finishClipDrag(cancel);
    } else if (h.kind === 'item' && itemDrag) {
      itemDrag.last = { x: g.at.x, y: g.at.y };
      finishItemDrag(cancel);
    } else if (h.kind === 'pan' && !cancel) {
      const first = h.samples[0]!;
      const last = h.samples[h.samples.length - 1]!;
      const dt = last.t - first.t;
      if (!reduced() && dt > 0 && g.t - last.t < 80) rig.fling((last.x - first.x) / dt, (last.y - first.y) / dt);
    }
    dirty = true;
  }

  /** Long-press then drag: from a card a connection line (the radial menu closes), from empty table a marquee. */
  function touchLine(g: Extract<TouchGesture, { kind: 'longPressDrag' }>): void {
    const h = touchHold;
    if (g.phase === 'start' && touchClipMenu) return;
    if (g.phase === 'start') {
      if (touchRadial) {
        touchRadial = false;
        opts.events.radialMenu?.(null, g.at);
      }
      if (touchTableMenu) {
        touchTableMenu = null;
        touchHold = { kind: 'marquee', x0: g.start.x, y0: g.start.y, x1: g.at.x, y1: g.at.y, base: [...view.selection] };
        showMarquee(touchHold);
        touchInput.capture();
        return;
      }
      const rc = pick(g.start.x, g.start.y);
      const source = rc && !readOnly ? lineSource(rc) : null;
      if (!rc || !source) return;
      lineView.draft = { pointerId: -1, source, sourceCard: rc.id, target: lineTargetAt(g.at.x, g.at.y, rc.id), cur: screenToTable(g.at.x, g.at.y), shift: false };
      touchHold = { kind: 'line' };
      touchInput.capture();
      dirty = true;
      return;
    }
    if (!h) return;
    if (g.phase === 'move') {
      if (h.kind === 'line' && lineView.draft) {
        lineView.draft.cur = screenToTable(g.at.x, g.at.y);
        // The far-zoom badge's list (opened by a tap) reports the item under the finger, so a line can end there.
        stackBadge.trackLine(g.at);
        lineView.draft.target = lineTargetAt(g.at.x, g.at.y, lineView.draft.sourceCard);
      } else if (h.kind === 'marquee') {
        h.x1 = g.at.x;
        h.y1 = g.at.y;
        showMarquee(h);
      }
      dirty = true;
      return;
    }
    touchHold = null;
    if (h.kind === 'line') {
      const dr = lineView.draft;
      if (g.phase === 'end' && dr) dispatch(lineView.finish(lineTargetAt(g.at.x, g.at.y, dr.sourceCard), false, newId));
      else lineView.draft = null;
      stackBadge.trackLine(null);
    } else if (h.kind === 'marquee') {
      if (g.phase === 'end') finishMarquee(h);
      else marqueeEl.style.display = 'none';
    }
    dirty = true;
  }

  /**
   * Another finger landed. Unless a captured drag ignores it, the touch is now a camera gesture (DESIGN "Input and
   * interaction design", Touch: two-finger gestures always drive the camera): the radial menu a long-press opened
   * closes, and the table menu a long-press on empty table would open when the fingers lift is dropped, even when the
   * fingers then lift without moving.
   */
  function touchSecondFinger(at: ScreenPoint): void {
    if (touchHold !== null && touchHold.kind !== 'pan') return;
    touchTableMenu = null;
    if (touchRadial) {
      touchRadial = false;
      opts.events.radialMenu?.(null, at);
    }
  }

  /** After a finger lifted or was cancelled: a long-press on empty table opens the table menu once every finger is up. */
  function touchReleased(cancel = false): void {
    if (cancel) touchTableMenu = null;
    if (touchInput.active()) return;
    touchBadge = null;
    touchRadial = false;
    touchClipMenu = false;
    const at = touchTableMenu;
    touchTableMenu = null;
    if (at && touchHold === null) opts.events.contextMenu?.(null, at);
  }

  function onDoubleClick(e: MouseEvent): void {
    // A double-tap was already handled as a touch gesture; the double-click some browsers synthesise from it is not.
    if (touchInput.recent()) return;
    doubleAt(e.clientX, e.clientY);
  }

  /**
   * Double-click or double-tap (DESIGN "Input and interaction design": double-click taps a card, draws from a library and
   * opens a pile; Touch: double-tap taps the card; "Camera and navigation": double-click or double-tap on empty space
   * beside a card zooms to it).
   */
  function doubleAt(x: number, y: number, touch = false): void {
    if (!state) return;
    if (readOnly) {
      // Read-only (M7-P5): no tap, no draw, no clip taken off; double-click beside a card still zooms to it and a public
      // pile (graveyard, exile) still opens for reading.
      const ro = pick(x, y);
      if (ro?.place.kind === 'pile' && parseZoneId(ro.inst.zone).kind !== 'library') opts.events.pileOpen?.(ro.inst.zone);
      if (ro) return;
    }
    // Double-click (double-tap) on a clip takes it off (M6-P1).
    const clip = clipUnder(x, y, touch);
    if (clip) {
      dispatch([{ type: 'clipRemove', clip }]);
      return;
    }
    const rc = pick(x, y);
    if (!rc) {
      // Double-click on empty space beside a card zooms to it (DESIGN "Camera and navigation").
      const p = screenToTable(x, y);
      let best: RCard | null = null;
      let bestD = 60;
      for (const r of rcards.values()) {
        const d = Math.hypot(r.motion.pose.x - p.x, r.motion.pose.y - p.y) - CARD_H / 2;
        if (d < bestD) {
          best = r;
          bestD = d;
        }
      }
      if (best) controls.zoomTo(best.id);
      return;
    }
    const c = rc.inst;
    // A zone pile (library, graveyard, exile) reports its zone: for a library the HUD draws, otherwise it opens.
    if (rc.place.kind === 'pile') {
      opts.events.pileOpen?.(c.zone);
      return;
    }
    // A squared pile shows only its top card: double-click opens it. A cascade shows every member: double-click taps
    // the member, except its bottom card, which opens the pile (DESIGN "Card manipulation": piles are handled by
    // their bottom card).
    if (rc.place.kind === 'free' && c.pile && (c.pile.kind === 'squared' || c.pile.index === 0 || rc.place.fanned)) {
      opts.events.pileOpen?.(c.pile.id);
      return;
    }
    if (rc.place.kind !== 'free') return;
    const sel = view.selection.includes(c.id) ? view.selection.map((id) => state!.cards[id]).filter((x): x is CardInstance => !!x && isBattlefield(x.zone) === true) : [c];
    const ordered = [c, ...sel.filter((x) => x.id !== c.id)];
    for (const x of ordered) {
      const r = rcards.get(x.id);
      if (r) r.localUntil = performance.now() + EXPECT_MS;
    }
    dispatch(tapActions(ordered, { newId }));
  }

  /** A context menu asked for during a right press: opened on release unless the press became a line. */
  let menuPending: { card: InstanceId | null; at: ScreenPoint } | null = null;
  let menuSuppressUntil = 0;

  function onContextMenu(e: MouseEvent): void {
    e.preventDefault();
    if (readOnly) {
      // Read-only (M7-P5): a right-click on a card inspects it; no action menu opens.
      if (touchInput.recent()) return;
      const ro = pick(e.clientX, e.clientY);
      if (ro) opts.events.inspect?.(ro.id);
      return;
    }
    // Some browsers fire a context menu on a long touch: touch has its own long-press (the radial menu).
    if (touchInput.recent()) return;
    // A clip's own menu (M6-P1: "its context menu (right-click, long-press) Remove clip").
    const clip = clipUnder(e.clientX, e.clientY);
    if (clip && gesture?.kind !== 'line') {
      menuPending = null;
      opts.events.clipMenu?.(clip, { x: e.clientX, y: e.clientY });
      return;
    }
    const rc = pick(e.clientX, e.clientY);
    // Some platforms ask on press (macOS), others on release (Windows, Linux): right-drag draws a line instead.
    if (gesture?.kind === 'press' && gesture.button === 2) {
      menuPending = { card: rc?.id ?? null, at: { x: e.clientX, y: e.clientY } };
      return;
    }
    if (gesture?.kind === 'line' || performance.now() < menuSuppressUntil) return;
    opts.events.contextMenu?.(rc?.id ?? null, { x: e.clientX, y: e.clientY });
  }

  function onWheel(e: WheelEvent): void {
    e.preventDefault();
    const c = toCanvas(e.clientX, e.clientY);
    const lineMode = e.deltaMode !== 0;
    const dy = lineMode ? e.deltaY * 33 : e.deltaY;
    if (e.ctrlKey) {
      // Trackpad pinch (browsers report it as ctrl+wheel).
      rig.zoomAt(c.x, c.y, Math.exp(-dy * 0.01));
    } else if (lineMode || (e.deltaX === 0 && Number.isInteger(e.deltaY) && Math.abs(e.deltaY) >= 50)) {
      // Mouse wheel: zoom centred on the cursor.
      rig.zoomAt(c.x, c.y, Math.exp(-dy * 0.0015));
    } else {
      // Two-finger scroll: pan.
      rig.stop();
      rig.panBy(-e.deltaX, -e.deltaY);
    }
    dirty = true;
  }

  function onPointerLeave(): void {
    if (!gesture) {
      setHoverClip(null);
      setHover(null);
      setHoverItem(null);
      // The HUD keeps the pile's actions while the pointer moves onto them (ui/touch/PileActions.svelte).
      if (pileWant?.via === 'hover') setPileWant(null);
    }
  }

  // External drag (from the HUD's hand fan) listens on window.
  function onWindowMove(e: PointerEvent): void {
    if (drag?.external && e.pointerId === drag.pointerId) {
      drag.last = { x: e.clientX, y: e.clientY };
      drag.ctrl = e.ctrlKey;
    }
    // A clip dragged out of the HUD's tray (M6-P1).
    if (clipDrag?.external && e.pointerId === clipDrag.pointerId) {
      clipDrag.last = { x: e.clientX, y: e.clientY };
      dirty = true;
    }
  }
  function onWindowUp(e: PointerEvent): void {
    if (drag?.external && e.pointerId === drag.pointerId) {
      drag.last = { x: e.clientX, y: e.clientY };
      finishDrag(e.ctrlKey, e.type === 'pointercancel');
    }
    if (clipDrag?.external && e.pointerId === clipDrag.pointerId) {
      clipDrag.last = { x: e.clientX, y: e.clientY };
      finishClipDrag(e.type === 'pointercancel');
    }
  }
  function onKey(e: KeyboardEvent): void {
    if (e.key === 'Escape' && drag) finishDrag(false, true);
    if (e.key === 'Escape' && clipDrag) {
      finishClipDrag(true);
      if (gesture?.kind === 'drag') gesture = null;
    }
    if (e.key === 'Escape' && clipHold) cancelHold();
    if (e.key === 'Escape' && gesture?.kind === 'line') {
      // Escape abandons a line being drawn; the release then does nothing.
      menuSuppressUntil = performance.now() + MENU_SUPPRESS_MS;
      lineView.draft = null;
      gesture = null;
      dirty = true;
    }
    if (e.key === 'Escape' && itemDrag) {
      finishItemDrag(true);
      gesture = null;
    }
  }

  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointercancel', onPointerCancel);
  canvas.addEventListener('pointerleave', onPointerLeave);
  canvas.addEventListener('dblclick', onDoubleClick);
  canvas.addEventListener('contextmenu', onContextMenu);
  canvas.addEventListener('wheel', onWheel, { passive: false });
  addEventListener('pointermove', onWindowMove);
  addEventListener('pointerup', onWindowUp);
  addEventListener('pointercancel', onWindowUp);
  addEventListener('keydown', onKey);
  // Held table presses for "Talk while I hold or drag" (M6-P2, scene/press-hold.ts): any press on the canvas held past
  // HOLD_PRESS_TALK_MS, whatever it does, reported with what it is doing then.
  const pressHold = attachPressHold(canvas, { kind: pressKind, onChange: (phase, kind) => opts.events.pressHold?.(phase, kind) });
  /** What the press under way is doing (SceneEvents.pressHold's kind). */
  function pressKind(): TablePressKind {
    if (clipHold || clipDrag) return 'clip';
    if (drag || itemDrag) return 'card';
    if (lineView.draft) return 'line';
    if (touchHold) return touchHold.kind === 'pan' ? 'camera' : touchHold.kind === 'marquee' ? 'marquee' : touchHold.kind === 'line' ? 'line' : touchHold.kind === 'clip' ? 'clip' : 'card';
    const g = gesture;
    if (!g) return 'other';
    if (g.kind === 'held') return 'clip';
    if (g.kind === 'pan' || g.kind === 'pitch') return 'camera';
    if (g.kind === 'marquee' || g.kind === 'line') return g.kind;
    if (g.kind === 'drag') return 'card';
    if (g.button === 2) return g.card || g.item ? 'line' : 'camera';
    return g.card || g.item ? 'card' : g.shift ? 'marquee' : 'camera';
  }
  const resizeObserver = new ResizeObserver(() => resize());
  resizeObserver.observe(host);
  resize();

  // --- Debug ----------------------------------------------------------------------------------------------------------
  function screenRect(rc: RCard): DOMRect {
    syncCamera();
    const r = canvasRect();
    const z = rc.place.z + rc.lift.value + cards.faceLift;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const c of cardCorners(rc.motion.pose)) {
      const v = new THREE.Vector3(c.x, z, -c.y).project(camera);
      const px = r.left + ((v.x + 1) / 2) * r.width;
      const py = r.top + ((1 - v.y) / 2) * r.height;
      minX = Math.min(minX, px);
      maxX = Math.max(maxX, px);
      minY = Math.min(minY, py);
      maxY = Math.max(maxY, py);
    }
    return new DOMRect(minX, minY, maxX - minX, maxY - minY);
  }

  const debug: SceneDebug = {
    cards() {
      const r = canvasRect();
      const sel = new Set(view.selection);
      return order.map((rc, i) => {
        const screen = screenRect(rc);
        // A card in a collapsed stack lane is not drawn: the far-zoom badge stands for it (M5-P7).
        const folded = stackFolded && rc.place.kind === 'stack' && !(drag?.ids.includes(rc.id) ?? false);
        const visible = !folded && screen.right > r.left && screen.left < r.right && screen.bottom > r.top && screen.top < r.bottom;
        return {
          id: rc.id,
          pose: rc.motion.pose,
          screen,
          visible,
          zone: rc.inst.zone,
          tapped: rc.inst.tapped,
          face: rc.inst.face,
          shows: rc.shownKey === BACK_KEY ? 'back' : 'face',
          dimmed: rc.shownDim,
          selected: sel.has(rc.id),
          dragging: drag?.ids.includes(rc.id) ?? false,
          // Any motion of the card (its pose, lift, sway, a pop, a riffle, a flight into the hand; M7-P4).
          moving: cardMoving(rc),
          tier: rc.tierDrawn,
          order: i,
          displaced: ghostOf(rc) !== null,
          ghost: ghostOf(rc),
          lift: rc.lift.value,
          tilt: tiltDrawn.get(rc.id) ?? 0,
          foil: foilsDrawn.has(rc.id),
          hovered: hoversDrawn.has(rc.id),
        };
      });
    },
    camera(): DebugCamera {
      const p = rig.pose();
      return { rig: rig.rig(), fov: p.fovDeg, position: [...p.position], pitch: p.pitchDeg, tilt: stubTilt() };
    },
    lines: () => lineView.debugLines(),
    drawnLines: () => lineView.debugDrawn(),
    pings: () => lineView.debugPings(performance.now()),
    frameStats() {
      return { ...stats };
    },
    lastDrop: () => lastDrop,
    idle: () => !drag && !rig.moving && pendingFollow.length === 0 && anims.length === 0 && frameHolds.size === 0 && ![...rcards.values()].some((rc) => cardMoving(rc)),
    pendingTextures: () => faces.pending,
    frames: () => frame,
    pipeline() {
      const m = runtime.materials.stats();
      return {
        materials: m.materials,
        materialTextures: m.textures,
        boxes: boxes.active,
        contactShadows: contact.active,
        faceShade: clampShade(theme.cardDressing.faceShade),
        faceLift: cards.faceLift,
        toneMapping: renderer.toneMapping,
        post: runtime.post.passes(),
        anisotropy: faces.arrays.small.texture.anisotropy,
        maxAnisotropy: renderer.capabilities.getMaxAnisotropy(),
        pixelRatio: renderer.getPixelRatio(),
        samples: runtime.post.composer?.renderTarget1.samples ?? 0,
      };
    },
    captions: () => captionLayer.debug(),
    motion: () => motionDebug(),
  };
  /** The sound cue of an animation the HUD asks for (CardAnimationRequest.cue absent; M7-P4). */
  const ANIMATION_CUE: Partial<Record<CardAnimationKind, string>> = {
    draw: 'draw',
    shuffle: 'shuffle',
    tap: 'tap',
    untap: 'untap',
    play: 'play',
    toGraveyard: 'toGraveyard',
    toExile: 'toExile',
    toHand: 'toHand',
    toLibrary: 'slide',
    attach: 'attach',
    clip: 'clip',
  };

  /**
   * An animation the HUD asks for (TableScene.animate; M7-P4): a library riffles, clipped cards pop, cards on the table
   * hop; it holds frames until it ends, then the scene is idle again. Moves that change the state animate by
   * themselves (relayout); this is for what the HUD starts. Reduced motion: nothing moves, the cue still sounds.
   */
  function playAnimation(req: CardAnimationRequest): void {
    const now = performance.now();
    const f = feel();
    const cue = req.cue === undefined ? ANIMATION_CUE[req.kind] : req.cue;
    if (cue) feelCues.emit(cue);
    if (reduced()) return;
    if (req.kind === 'shuffle') {
      const zone = req.from ?? req.to ?? (viewerSeat ? `library:${viewerSeat}` : null);
      const pile = [...rcards.values()].filter((rc) => rc.inst.zone === zone && rc.place.kind === 'pile').sort((a, b) => a.place.z - b.place.z);
      pile.forEach((rc, i) => (rc.riffle = { start: now, dur: f.durations.shuffle, i, n: pile.length }));
      if (pile.length) startAnim('shuffle', pile.map((rc) => rc.id), now, f.durations.shuffle);
      return;
    }
    const ids = req.cards.filter((id) => rcards.has(id));
    if (!ids.length) return;
    if (req.kind === 'clip' || req.kind === 'unclip' || req.kind === 'counter') {
      for (const id of ids) {
        const rc = rcards.get(id)!;
        if (req.kind === 'counter') rc.badgePop = now;
        else rc.pop = { start: now, dur: f.durations.clip, amp: CLIP_POP_SCALE };
      }
      startAnim(req.kind, ids, now, req.kind === 'counter' ? POP_MS * motionNow().scale : f.durations.clip);
      return;
    }
    const dur = req.kind === 'tap' || req.kind === 'untap' || req.kind === 'flip' ? TAP_FEEL_MS * motionNow().scale : arrivalMs(req.kind, f);
    for (const id of ids) rcards.get(id)!.lift.arc(now, heldLift() * 0.5, dur, false);
    startAnim(req.kind, ids, now, dur);
  }

  /** Whether a card still moves in any way: its pose, lift, sway, a pop, a riffle or its flight into the hand (M7-P4). */
  function cardMoving(rc: RCard): boolean {
    return rc.motion.moving || rc.lift.moving || rc.sway.moving || rc.pop !== null || rc.badgePop !== null || rc.riffle !== null || rc.leaving !== null;
  }

  /** Card motion for the debug hook (scene/types.ts MotionDebugState; PLAN M7-P4, gate M7-G "Idle frames stop"). */
  function motionDebug(): MotionDebugState {
    const now = performance.now();
    const heldRc = drag ? rcards.get(drag.ids[0]!) : undefined;
    const holds = [...frameHolds.values()].map((h) => h.reason);
    const running = anims.filter((a) => now < a.start + a.dur);
    for (const a of running) holds.push(`animation:${a.kind}`);
    if (drag) holds.push('drag');
    if ([...rcards.values()].some((rc) => cardMoving(rc))) holds.push('cards');
    return {
      motion: motionNow(),
      running: running.map((a) => ({ kind: a.kind, cards: [...a.cards], progress: progressOf(a, now) })),
      holds,
      held: heldRc ? { card: heldRc.id, liftMm: heldRc.lift.value, swayDeg: heldRc.sway.value } : null,
      magnet: magnet ? { kind: magnet.kind, target: magnet.target, pull: magnet.kind === 'hand' && !magnet.slot ? 1 : (magnetDrawn?.pull ?? 0) } : null,
    };
  }

  /** The stack lane as drawn (scene/stack.ts DebugStackEntry). */
  function stackDebug(): DebugStackEntry[] {
    syncCamera();
    const r = canvasRect();
    return entries.map((e) => {
      const pose = entryPose(e);
      const k = entryScale(e);
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (const c of cardCorners(drawnPose(pose, k), CARD_W * k, CARD_H * k)) {
        const v = new THREE.Vector3(c.x, 0, -c.y).project(camera);
        const px = r.left + ((v.x + 1) / 2) * r.width;
        const py = r.top + ((1 - v.y) / 2) * r.height;
        minX = Math.min(minX, px);
        maxX = Math.max(maxX, px);
        minY = Math.min(minY, py);
        maxY = Math.max(maxY, py);
      }
      return {
        item: e.item.id,
        kind: e.item.kind,
        index: e.index,
        number: e.number,
        controller: e.item.controller,
        face: e.face,
        marker: e.marker,
        pending: e.pending,
        pose,
        note: e.item.note ?? null,
        scale: k,
        screen: new DOMRect(minX, minY, maxX - minX, maxY - minY),
      };
    });
  }
  // --- Render and rig parts of the debug hook (M4-C seams; M4-P2 fills quality and stats, M4-P1 the rig) ------------
  let follow: FollowOptions = { stack: opts.follow?.stack ?? false, activePlayer: opts.follow?.activePlayer ?? false };
  function renderStats(): RenderStats {
    const info = renderer.info;
    return {
      ...stats,
      triangles: info.render.triangles,
      textures: info.memory.textures,
      geometries: info.memory.geometries,
      programs: info.programs?.length ?? 0,
      passes: runtime.post.passes(),
      shadows: runtime.effective.shadowMap || runtime.effective.contactShadows,
      quality: runtime.level.id,
      theme: theme.id,
    };
  }
  /** The camera's pose in table space (scene/camera/rig.ts). */
  function cameraPose(): CameraPose {
    const p = rig.pose();
    return { position: [...p.position], target: [...p.target], fovDeg: p.fovDeg, pitchDeg: p.pitchDeg };
  }
  const renderDebug: RenderDebug = {
    stats: () => renderStats(),
    quality: () => runtime.qualityChoice,
    setQuality: (id) => sceneApi.setQuality(id),
    framesDrawn: () => frame,
    // M8-C: the lifecycle counters (contracts.md Part C).
    ...lifecycleRender(),
  };
  const rigDebug: RigDebug = {
    rig: () => controls.rig(),
    setRig: (r, o) => controls.setRig(r, o),
    blend: () => controls.blend(),
    follow: () => controls.follow(),
    setFollow: (next) => controls.setFollow(next),
    pose: () => controls.pose(),
    tilt: () => controls.tilt(),
    setTilt: (t, o) => controls.setTilt(t, o),
  };

  const debugParts = {
    render: renderDebug,
    rig: rigDebug,
    cards: () => debug.cards(),
    camera: () => debug.camera(),
    lines: () => debug.lines(),
    frameStats: () => debug.frameStats(),
    drawnLines: () => debug.drawnLines(),
    pings: () => debug.pings(),
    stack: () => stackDebug(),
    tableView: () => tableViewDebug(),
    captions: () => captionLayer.debug(),
    // The touch part (M5-P1): the HUD replaces it with one that also knows its radial menu and thumb bar.
    touch: { gestures: () => recentGestures(), radial: () => null, thumbBar: () => [] },
    // The far-zoom stack badge (M5-P7).
    stackBadge: () => stackBadge.state(),
    // Paperclips, the hold ring, the drag group and the drop preview (M6-P1).
    clips: () => clipDebug(),
    // The selection strip's and the pile actions' anchors (M7-P5).
    affordances: () => affordanceDebug(),
    // Card motion, running animations and frame holds (M7-P4).
    motion: () => motionDebug(),
    // Look, do not touch (M7-P5): the switch and the count of actions this scene proposed.
    readOnly: { on: () => readOnly, set: (on: boolean) => setReadOnlyNow(on), proposed: () => proposed },
  };
  registerDebug(debugParts);

  /** The table's seats as this viewer sees them (M3-P1): canonical territory and avatar spot, and where they are on screen. */
  function tableViewDebug(): DebugTableView | null {
    if (!state) return null;
    const st = state;
    const v = rig.centre();
    const seats = Object.values(st.seats)
      .sort((a, b) => a.index - b.index)
      .flatMap((seat): DebugSeatView[] => {
        const sl = seatLayoutOf(st, layout, seat.id);
        if (!sl) return [];
        const territory = { x: sl.territory.x, y: sl.territory.y };
        const avatar = { x: sl.zones.avatar.x, y: sl.zones.avatar.y };
        const t = worldToScreen({ ...territory, z: 0 });
        const a = worldToScreen({ ...avatar, z: 0 });
        // Corners of the territory, the pile column and the command area on screen (M5-P7's ego framing).
        const cornersOf = (r: { x: number; y: number; w: number; d: number; rot: number }) =>
          [
            [-1, -1],
            [1, -1],
            [1, 1],
            [-1, 1],
          ].map(([u, v]) => worldToScreen({ ...rectPoint(r, (u! * r.w) / 2, (v! * r.d) / 2), z: 0 }));
        const pile = (p: Pose) => cornersOf({ ...p, w: CARD_W, d: CARD_H });
        const zones = { territory: cornersOf(sl.territory), library: pile(sl.zones.library), graveyard: pile(sl.zones.graveyard), exile: pile(sl.zones.exile), command: cornersOf(sl.zones.command) };
        return [{ seat: seat.id, index: seat.index, angle: sl.angle, territory, avatar, screen: t && a ? { territory: t, avatar: a } : null, zones }];
      });
    return { format: layout.format, table: { ...layout.table }, viewerAngle: viewerAngle(st, layout, viewerSeat), camera: { x: v.x, y: v.y, dist: v.dist }, seats };
  }

  // --- Camera controls (scene/camera/rig.ts; M4-P1) ------------------------------------------------------------------
  const blend = (animate = true) => (animate && !reduced() ? theme.motion.cameraBlendMs : 0);
  /** A client point inside the canvas as canvas px, or null outside it. */
  function canvasPoint(p: ScreenPoint | undefined): ScreenPoint | null {
    if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) return null;
    const c = toCanvas(p.x, p.y);
    const vp = rig.viewport;
    return c.x >= 0 && c.y >= 0 && c.x <= vp.w && c.y <= vp.h ? c : null;
  }
  /** The table rect a seat or a team (Two-Headed Giant's shared turn) occupies. */
  function territoryOf(who: string): Rect | null {
    if (!state) return null;
    const seat = seatLayoutOf(state, layout, who);
    if (seat) return seat.territory;
    const team = state.teams[who];
    const first = team ? seatLayoutOf(state, layout, team.seats[0]) : null;
    if (first?.team !== undefined) return layout.teams?.[first.team]?.territory ?? first.territory;
    return first?.territory ?? null;
  }
  /**
   * Whether the player may be dragging: follow moves wait until it ends (DESIGN: "nothing ever moves the camera while
   * the player is dragging"). Any pointer pressed anywhere on the page counts, a press on the table not yet past the
   * drag threshold and a hand-fan drag still in the HUD included.
   */
  const holding = () => drag !== null || itemDrag !== null || gesture !== null || pressedPointers.size > 0 || touchInput.active();
  let pendingFollow: FollowRequest[] = [];
  /** Ease to what the follow toggles ask for (DESIGN "Camera and navigation", Follow options). */
  function applyFollow(reqs: FollowRequest[]): void {
    for (const r of reqs) {
      if (r.kind === 'active') {
        const rect = territoryOf(r.who);
        if (rect) rig.goToRect(rect, performance.now(), blend());
      } else {
        const e = entries.find((x) => x.item.id === r.item);
        if (!e) continue;
        // Where it comes to rest in the lane (a spell card may still be on its way there).
        const p = e.pose;
        // Only when it is off screen: the camera brings it in, keeping the zoom.
        if (!rig.shows(p, FOLLOW_MARGIN_PX)) rig.focus(p, 'keep', performance.now(), blend());
      }
      dirty = true;
    }
  }
  function requestFollow(reqs: FollowRequest[]): void {
    if (!reqs.length) return;
    if (holding()) pendingFollow = [...pendingFollow.filter((p) => !reqs.some((r) => r.kind === p.kind)), ...reqs];
    else applyFollow(reqs);
  }
  const controls: TableCameraControls = {
    fit(animate = true) {
      rig.fit(performance.now(), blend(animate));
      dirty = true;
    },
    zoomAt(x, y, factor) {
      const c = toCanvas(x, y);
      rig.zoomAt(c.x, c.y, factor);
      dirty = true;
    },
    panBy(dx, dy) {
      rig.panBy(dx, dy);
      dirty = true;
    },
    goToSeat(seat) {
      if (!state || drag) return;
      const sl = seatLayoutOf(state, layout, seat);
      if (!sl) return;
      rig.goToRect(sl.territory, performance.now(), blend());
      dirty = true;
    },
    zoomTo(target) {
      if (drag) return;
      let p: TablePoint | null = null;
      const rc = rcards.get(target);
      if (rc) p = rc.motion.pose;
      else if (state) {
        const member = Object.values(state.cards).find((c) => c.pile?.id === target && c.pile.index === 0);
        const mr = member ? rcards.get(member.id) : undefined;
        if (mr) p = mr.motion.pose;
        else {
          const t = targets().find((x) => x.zone === target);
          if (t?.rect) p = t.rect;
          else if (t?.circle) p = t.circle;
        }
      }
      if (!p) return;
      rig.focus(p, 'close', performance.now(), blend());
      dirty = true;
    },
    setRig(next: CameraRig, o?: SetRigOptions) {
      if (next !== 'birdseye' && next !== 'ego') return;
      // Only a real switch is the viewer's choice: asking for the rig already shown keeps the theme's default in charge.
      if (next !== rig.rig()) rigChosen = true;
      rig.setRig(next, performance.now(), blend(o?.animate ?? true), canvasPoint(o?.anchor));
      dirty = true;
    },
    rig: () => rig.rig(),
    pitchBy(deg: number) {
      if (!Number.isFinite(deg)) return;
      rig.pitchBy(deg);
      dirty = true;
    },
    follow: () => ({ ...follow }),
    setFollow(next) {
      follow = { stack: next.stack ?? follow.stack, activePlayer: next.activePlayer ?? follow.activePlayer };
      if (!follow.stack) pendingFollow = pendingFollow.filter((r) => r.kind !== 'stackItem');
      if (!follow.activePlayer) pendingFollow = pendingFollow.filter((r) => r.kind !== 'active');
    },
    blend() {
      const b = rig.blendState();
      if (!b?.anchor) return b;
      const r = canvasRect();
      return { ...b, anchor: { table: b.anchor.table, screen: { x: b.anchor.screen.x + r.left, y: b.anchor.screen.y + r.top } } };
    },
    pose: () => cameraPose(),
    // The one continuous tilt (scene/types.ts TiltControls, M7-C): a stub over the two rigs until M7-P3 builds the
    // continuous rig. A tilt goes to the nearer rig; mid-blend the tilt is the blend's progress.
    tilt: () => stubTilt(),
    setTilt(t: Tilt, o?: SetTiltOptions) {
      const target = tiltForRig(rigForTilt(clampTilt(t)));
      const from = stubTilt();
      const source = o?.source ?? 'api';
      controls.setRig(rigForTilt(target), { ...(o?.animate !== undefined ? { animate: o.animate } : {}), ...(o?.anchor ? { anchor: o.anchor } : {}) });
      if (target !== from) opts.events.tilt?.({ phase: 'start', tilt: from, target, source });
    },
    tiltBy(dt: number, o?: SetTiltOptions) {
      if (!Number.isFinite(dt) || dt === 0) return;
      controls.setTilt(stubTilt() + dt, o);
    },
    tiltPresets: () => TILT_PRESETS,
  };

  /** The tilt of the two-rig camera (M7-C stub until M7-P3): the rig's tilt, or the blend's eased progress between them. */
  function stubTilt(): Tilt {
    const b = rig.blendState();
    if (!b) return tiltForRig(rig.rig());
    const a = tiltForRig(b.from);
    return a + (tiltForRig(b.to) - a) * b.t;
  }

  raf = requestAnimationFrame(tick);
  // The sound player follows the table's look (util/feel.ts; ui/sound.ts).
  tableTheme.set(theme.id);
  // M8-C: the frame loop is counted until dispose (contracts.md Part C).
  track('rafLoops', frameLoop);
  const meterSource = (): RenderInfo => ({
    width: canvas.width,
    height: canvas.height,
    pixelRatio: renderer.getPixelRatio(),
    devicePixelRatio: typeof devicePixelRatio === 'number' ? devicePixelRatio : 1,
    renderScale: runtime.renderScale,
    theme: theme.id,
    quality: runtime.level.id,
    post: runtime.post.passes(),
    shadows: runtime.effective.shadowMap || runtime.effective.contactShadows,
    sync: switches.sync,
  });
  frameMeter.setRender(meterSource);

  /** The game's layout for a table format, or null when the game has none for it (the scene keeps its own). */
  function layoutFor(format: TableState['format']): TableLayout | null {
    try {
      const l = opts.game.layout(format);
      return l.format === format ? l : null;
    } catch {
      return null;
    }
  }

  /** The stack lane's centre while the stack holds items (Wyrm's heat shimmer follows it), told to the theme on change. */
  let stackFocus: TablePoint | null = null;
  function syncStackFocus(force = false): void {
    const next = state && state.stack.length > 0 ? { x: layout.stackLane.x, y: layout.stackLane.y } : null;
    if (!force && next?.x === stackFocus?.x && next?.y === stackFocus?.y) return;
    stackFocus = next;
    runtime.setStackFocus(next);
  }

  /** Rebuild the theme for a new placement (table size, viewer seat, reduced motion). */
  function rebuildTheme(next: ThemePlacement): void {
    built = next;
    runtime.rebuild(next);
    syncStackFocus(true);
    cards.setShade(clampShade(theme.cardDressing.faceShade), runtime.keyLight);
    dirty = true;
  }

  /**
   * Switch "look, do not touch" (M7-P5; TableScene.setReadOnly): what is in hand is let go where it came from, a line
   * being drawn and a hold to clip are dropped, the pile actions and the selection strip go away, and the HUD hears of it
   * (SceneEvents.readOnly) so it hides its coach marks.
   */
  function setReadOnlyNow(on: boolean): void {
    if (on === readOnly) return;
    if (on) {
      if (drag) finishDrag(false, true);
      if (clipDrag) finishClipDrag(true);
      cancelHold();
      if (itemDrag) finishItemDrag(true);
      if (lineView.draft) lineView.draft = null;
      if (gesture && gesture.kind !== 'pan' && gesture.kind !== 'pitch') gesture = null;
      pileWant = null;
    }
    readOnly = on;
    opts.events.readOnly?.(on);
    affordDirty = true;
    dirty = true;
  }

  const sceneApi: SceneHandle = {
    frames,
    setMotion(next: MotionSettings) {
      // The viewer's motion setting (Settings.motion resolved; M7-P4): reduced motion cuts what moves now as well.
      motionSetting = { reduced: next.reduced, scale: next.reduced ? 0 : Math.max(0, Math.min(1, next.scale)) };
      feelCache = null;
      if (motionSetting.reduced) for (const rc of rcards.values()) rc.sway.cut();
      dirty = true;
    },
    animate(req: CardAnimationRequest) {
      playAnimation(req);
    },
    setReadOnly(on: boolean) {
      setReadOnlyNow(on);
    },
    update(next, nextView) {
      const prevState = state;
      const viewChanged = nextView !== view;
      state = next;
      const openChanged = nextView.openPile !== view.openPile || nextView.privateFaces !== view.privateFaces;
      view = nextView;
      // The table's format picks the layout (DESIGN "Players, seats and formats"; M3-P1): a format changed in the lobby
      // brings its own table size, territories and seat angles.
      const formatLayout = next.format !== layout.format ? layoutFor(next.format) : null;
      if (formatLayout) layout = formatLayout;
      // The theme is built for the table size, the viewer's seat (lights stand behind their edge) and reduced motion.
      const want = placement();
      if (want.table !== built.table || want.viewerAngle !== built.viewerAngle || want.reducedMotion !== built.reducedMotion || want.tableRot !== built.tableRot) rebuildTheme(want);
      if (formatLayout || prevState === null || Object.keys(prevState.seats).length !== Object.keys(next.seats).length) {
        rig.setTable(cameraTable(layout, viewerAngle(state, layout, viewerSeat)), viewerAngle(state, layout, viewerSeat), fitFrame(state, layout, viewerSeat), viewerLateral(state));
        rig.setEgoKeep(egoKeepOf(state));
        rebuildMarkings();
      } else if (prevState.seats !== next.seats) {
        // A chair taken or left changes which hand rows the fitted view must show, and the names at the avatar spots.
        rig.setFrame(fitFrame(state, layout, viewerSeat));
        if (Object.values(next.seats).some((s) => prevState.seats[s.id]?.name !== s.name)) rebuildMarkings();
      }
      if (prevState !== next || openChanged) relayout(performance.now());
      // The selection strip and the pile actions follow the state and the selection (M7-P5).
      if (prevState !== next || viewChanged) affordDirty = true;
      if (prevState !== next && !formatLayout) requestFollow(followRequests(prevState, next, follow));
      if (viewChanged) dirty = true;
      if (nextView.captions || captionLayer.active) captionLayer.set(nextView.captions ?? []);
    },
    setTheme(next) {
      tableTheme.set(next.id);
      // Hot-swap (DESIGN "Themes and rendering": switchable mid-game without reloading): the old theme's objects,
      // passes, lights, shadow maps and released materials go first; the state and the cards' motion stay.
      const oldBack = backOf(theme);
      releaseDressing();
      theme = next;
      built = placement();
      runtime.setTheme(next, built);
      syncStackFocus(true);
      applyDressing();
      swapBack(oldBack);
      cards.setBackground(theme.tokens.colours.surface);
      markMaterial.color.set(theme.tokens.colours.border);
      styleOverlays();
      ghostLayer.setOpacity(theme.cardDressing.ghost.opacity);
      rig.inertiaMs = theme.motion.panInertiaMs;
      // The theme's camera defaults: its ego parameters and bird's-eye tilt, and its preferred rig unless the viewer chose one.
      rig.setTheme(theme.camera.ego, theme.camera.birdseyeTiltDeg);
      if (!rigChosen && rig.rig() !== theme.camera.defaultRig) rig.setRig(theme.camera.defaultRig, performance.now(), blend(), null);
      dirty = true;
    },
    setLayout(nextLayout: TableLayout, seat: SeatId | null) {
      layout = nextLayout;
      viewerSeat = seat;
      rebuildTheme(placement());
      rig.setTable(cameraTable(layout, viewerAngle(state, layout, viewerSeat)), viewerAngle(state, layout, viewerSeat), fitFrame(state, layout, viewerSeat), viewerLateral(state));
      rig.setEgoKeep(egoKeepOf(state));
      rebuildMarkings();
      relayout(performance.now());
    },
    setCardBack(next: TextureSource | null) {
      // DESIGN "Card data and images", Card back: the official back is the viewer's opt-in, drawn whole.
      const oldBack = backOf(theme);
      backOverride = next;
      swapBack(oldBack);
    },
    setQuality(id: QualityId) {
      // Without reload (DESIGN "Themes and rendering", Renderer): a lower level drops shadows and post first.
      releaseDressing();
      runtime.setQuality(id);
      syncStackFocus(true);
      applyDressing();
      resize();
      dirty = true;
    },
    quality: () => runtime.level,
    renderStats: () => renderStats(),
    camera: controls,
    cardAt(x, y) {
      return pick(x, y)?.id ?? null;
    },
    zoneAt(x, y) {
      return zoneTargetAt(screenToTable(x, y), targets())?.zone ?? null;
    },
    startDrag(card, x, y) {
      if (!state || drag) return;
      const inst = state.cards[card];
      if (!inst) return;
      let rc = rcards.get(card);
      const added: InstanceId[] = [];
      if (!rc) {
        const p = screenToTable(x, y);
        const sl = seatLayoutOf(state, layout, inst.owner);
        const pose = { x: p.x, y: p.y, rot: sl?.angle ?? 0 };
        const priv = view.privateFaces[card];
        const key = inst.identity ? `${inst.identity.sid}#${inst.faceIndex}` : priv ? `${priv.sid}#${inst.faceIndex}` : BACK_KEY;
        if (inst.identity) faces.register(inst.identity, inst.faceIndex);
        else if (priv) faces.register(priv, inst.faceIndex);
        rc = {
          id: card,
          inst,
          place: { id: card, zone: inst.zone, kind: 'hand', rest: pose, z: 0, sort: [LAYER.dragged, 0, 0], key, ref: inst.identity ?? priv ?? null, faceIndex: inst.faceIndex, dimmed: false, fanned: false },
          motion: new CardMotion(pose),
          shownKey: key,
          shownDim: false,
          localUntil: 0,
          expect: null,
          tierDrawn: null,
          lift: new LiftMotion(),
          sway: new SwayMotion(),
          pop: null,
          badgePop: null,
          riffle: null,
          leaving: null,
        };
        rcards.set(card, rc);
        added.push(card);
      }
      if (startCardDrag(rc, -1, x, y, false, false, true)) {
        drag!.added = added;
        drag!.pointerId = activePointer ?? -1;
        // A card dragged out of the hand or a pile viewer is a table press from here on ("Talk while I hold or drag",
        // M6-P2): timed from its press on the HUD, ended by that pointer's release.
        if (activePointer !== null && pressedPointers.has(activePointer)) pressHold.adopt(activePointer, performance.now() - activePointerAt);
      }
    },
    startClipDrag(x, y) {
      if (!state || drag || clipDrag) return;
      startClipDrag(activePointer ?? -1, null, x, y, true);
    },
    cardsAt(x, y) {
      return cardsUnder(x, y).map((c) => c.id);
    },
    clipAt(x, y) {
      return clipUnder(x, y);
    },
    worldToScreen,
    screenToTable(x, y) {
      return screenToTable(x, y);
    },
    debug,
    dispose() {
      disposed = true;
      handRoom.set(null);
      // Cancel every animation and release every frame hold (M7-P5): tables are mounted and disposed many times.
      frameHolds.clear();
      anims = [];
      for (const rc of rcards.values()) {
        rc.motion.cut(rc.motion.target);
        rc.lift.cut(0);
        rc.sway.cut();
        rc.pop = null;
        rc.badgePop = null;
        rc.riffle = null;
        rc.leaving = null;
      }
      forgetMotion(motionKey);
      frameMeter.releaseRender(meterSource);
      pressHold.dispose();
      touchInput.reset();
      cancelAnimationFrame(raf);
      resizeObserver.disconnect();
      insetObserver.disconnect();
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('pointercancel', onPointerCancel);
      canvas.removeEventListener('pointerleave', onPointerLeave);
      canvas.removeEventListener('dblclick', onDoubleClick);
      canvas.removeEventListener('contextmenu', onContextMenu);
      canvas.removeEventListener('wheel', onWheel);
      removeEventListener('pointermove', onWindowMove);
      removeEventListener('pointerup', onWindowUp);
      removeEventListener('pointercancel', onWindowUp);
      removeEventListener('keydown', onKey);
      removeEventListener('pointerdown', trackPointer, true);
      removeEventListener('pointerup', releasePointer, true);
      removeEventListener('pointercancel', releasePointer, true);
      removeEventListener('pointermove', releaseIdlePointer, true);
      removeEventListener('blur', releaseAllPointers);
      releaseDressing();
      focusRing.dispose();
      runtime.dispose();
      boxes.dispose();
      contact.dispose();
      faces.dispose();
      cards.dispose();
      text.dispose();
      labels.dispose();
      lineView.dispose();
      ghostLayer.dispose();
      markerLayer.dispose();
      clipView.dispose();
      previewLayer.dispose();
      ringEl.remove();
      glyphEl.remove();
      hintEl.remove();
      captionLayer.dispose();
      markGeometry.dispose();
      markMaterial.dispose();
      renderer.dispose();
      // M8-C: what the renderer still held, and the context and frame loop released (contracts.md Part C).
      untrackContext(renderer);
      untrack('rafLoops', frameLoop);
      // Free the WebGL context now, not at GC: browsers cap live contexts (about 16).
      renderer.forceContextLoss();
      canvas.remove();
      // Debug parts must not point at a disposed scene (a newer scene's parts stay).
      const hook = typeof window === 'undefined' ? undefined : (window.__spellplane as Record<string, unknown> | undefined);
      if (hook) for (const [k, fn] of Object.entries(debugParts)) if (hook[k] === fn) delete hook[k];
      // M8-C: the render part's lifecycle members stay readable on Home (contracts.md Part C).
      registerBaseRender();
      marqueeEl.remove();
      stackBadge.dispose();
    },
  };

  // The HUD's drag starts with its own pointerdown; remember that pointer so its moves and release reach us.
  let activePointer: number | null = null;
  /** When the active pointer went down (performance.now()). */
  let activePointerAt = 0;
  function trackPointer(e: PointerEvent): void {
    activePointer = e.pointerId;
    activePointerAt = performance.now();
    pressedPointers.add(e.pointerId);
  }
  function releasePointer(e: PointerEvent): void {
    pressedPointers.delete(e.pointerId);
  }
  function releaseAllPointers(): void {
    pressedPointers.clear();
  }
  // A release the page never saw (the button let go outside the window, a native context menu that swallowed the
  // pointerup): the pointer's next move with no button down ends its press, so follow moves do not wait forever.
  function releaseIdlePointer(e: PointerEvent): void {
    if (e.buttons === 0 && pressedPointers.has(e.pointerId)) pressedPointers.delete(e.pointerId);
  }
  addEventListener('pointerdown', trackPointer, true);
  addEventListener('pointerup', releasePointer, true);
  addEventListener('pointercancel', releasePointer, true);
  addEventListener('pointermove', releaseIdlePointer, true);
  addEventListener('blur', releaseAllPointers);
  // The HUD's hover keys reach a marker through this (scene/stack.ts hoveredStackItem).
  registerStackHover(sceneApi, () => hoverItem);

  return sceneApi;
}

function sameCounters(a: Record<string, number>, b: Record<string, number>): boolean {
  const ka = Object.keys(a);
  if (ka.length !== Object.keys(b).length) return false;
  return ka.every((k) => a[k] === b[k]);
}

function samePose(a: Pose, b: Pose, eps = 0.01): boolean {
  return Math.abs(a.x - b.x) < eps && Math.abs(a.y - b.y) < eps && Math.abs(deltaDeg(a.rot, b.rot)) < eps;
}
