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
 */
import * as THREE from 'three';
import type { ActionDraft } from '../core/actions';
import { CAMERA, GEOMETRY } from '../core/geometry';
import type { CardInstance, InstanceId, Pose, SeatId, StackItemId, TableState, ZoneId } from '../core/types';
import type { TableLayout } from '../games/types';
import type { ThemeInstance } from '../themes/types';
import { registerDebug } from '../util/debug';
import { BirdseyeRig, NO_INSETS, type Insets } from './camera';
import { CardLayer, type CardDraw } from './cards';
import { BACK_KEY, FaceTextures } from './faces';
import { dropActions, tapActions, tempMoveActions, toStoredPoses } from './gestures';
import { LAYER, compareSort, displayedRot, dropTargets, fitFrame, markings, placeCards, presentationOf, seatLayoutOf, viewerAngle, type Placement } from './layout';
import { blockPlan, fanAttacker, fanUnder, settleSlots, withUnblock, type CombatContext } from './combat';
import { ghostSegments, markerSegments, markerSize } from './ghost';
import { LineLayer, LineView, lineSourceOf, type DebugPing, type DebugSeatView, type DebugTableView, type DrawnLine, type LineDraw, type SceneDebugLine } from './lines';
import { CARD_H, CARD_W, cardCorners, cardHalfExtents, deltaDeg, forward, legibleScale, pointInCard, pointInRect, rot2 } from './math';
import { CardMotion } from './motion';
import { drawnPose, entryAt, entryScale, hoverHighlights, itemAnchor, labelPoint, notePoint, registerStackHover, slotAt, stackEntries, type DebugStackEntry, type StackEntry } from './stack';
import { resolveDrop, zoneTargetAt, type DropResult, type Extent, type SnapCard } from './snap';
import { TextLayer, type TextSpec } from './text';
import { tierForScreenHeight } from './textures';
import type {
  CameraControls,
  CameraRig,
  DebugCamera,
  DebugCard,
  FrameStats,
  SceneDebugParts,
  ScreenPoint,
  TablePoint,
  TablePoint3,
  TableScene,
  TableSceneOptions,
  ViewState,
} from './types';

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
  | { kind: 'press'; pointerId: number; button: number; card: InstanceId | null; item: StackItemId | null; x0: number; y0: number; shift: boolean; alt: boolean; pileGrab: boolean }
  | { kind: 'pan'; pointerId: number; last: { x: number; y: number }; samples: { x: number; y: number; t: number }[] }
  | { kind: 'marquee'; pointerId: number; x0: number; y0: number; x1: number; y1: number; base: InstanceId[] }
  | { kind: 'line'; pointerId: number }
  | { kind: 'drag' }
  | { kind: 'pinch' };

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
const GHOST_WIDTH_PX = 1;
const MARKER_WIDTH_PX = 2;
/** After a right-drag drew a line, the context menu that some platforms fire on release is ignored this long, ms. */
const MENU_SUPPRESS_MS = 400;
const TOUCH_THRESHOLD_PX = 8;
/** How long a dropped card waits for the state to confirm its new pose before returning. */
const EXPECT_MS = 1500;

export function createTableScene(host: HTMLElement, opts: TableSceneOptions): SceneHandle {
  let theme = opts.theme;
  let layout = opts.layout;
  let viewerSeat = opts.viewerSeat;
  let state: TableState | null = null;
  let view: ViewState = { selection: [], hovered: null, privateFaces: {}, reducedMotion: false, pings: [], openPile: null };

  // --- Three.js -------------------------------------------------------------------------------------------------
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: false });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, theme.quality[0]?.pixelRatio ?? 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.info.autoReset = true;
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

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(CAMERA.birdseye.fovDeg, 1, 10, 100000);
  const viewport = () => ({ w: Math.max(1, host.clientWidth || innerWidth), h: Math.max(1, host.clientHeight || innerHeight) });
  const rig = new BirdseyeRig(layout.table, viewport(), viewerAngle(null, layout, viewerSeat), theme.motion.panInertiaMs);
  // The HUD tells the scene which screen edges its screen-anchored layer covers through the host's
  // `data-fit-insets="top right bottom left"` (CSS px); fitting the table keeps the table clear of them.
  const readInsets = (): Insets => {
    const v = (host.getAttribute('data-fit-insets') ?? '').trim().split(/\s+/).map(Number);
    if (v.length !== 4 || v.some((n) => !Number.isFinite(n) || n < 0)) return NO_INSETS;
    return { top: v[0]!, right: v[1]!, bottom: v[2]!, left: v[3]! };
  };
  rig.insets = readInsets();
  rig.view = rig.fitView();
  const insetObserver = new MutationObserver(() => {
    rig.setInsets(readInsets());
    dirty = true;
  });
  insetObserver.observe(host, { attributes: true, attributeFilter: ['data-fit-insets'] });

  let themeInstance: ThemeInstance = theme.build({ renderer, scene, camera, table: layout.table, quality: theme.quality[0]!, reducedMotion: false });

  const faces = new FaceTextures(renderer, opts.faces, theme.cardDressing.back ?? opts.game.cardBack);
  faces.onChange = () => (dirty = true);
  const cards = new CardLayer(scene, theme.tokens.colours.surface);
  scene.add(cards.mesh);
  const text = new TextLayer();
  // Table markings (zone labels) lie under the cards, like the hairlines.
  const labels = new TextLayer(1, 'zone-labels');
  // Glyph layout runs in a worker: redraw once a batch finishes.
  text.object.addEventListener('synccomplete', () => (dirty = true));
  labels.object.addEventListener('synccomplete', () => (dirty = true));
  scene.add(text.object);
  scene.add(labels.object);
  // Ghost outlines at the home slots of displaced cards (under the cards) and their displacement markers (over them).
  const ghostLayer = new LineLayer({ renderOrder: 1, opacity: theme.cardDressing.ghost.opacity, name: 'ghosts' });
  const markerLayer = new LineLayer({ renderOrder: 4, name: 'displacement-markers' });
  scene.add(ghostLayer.object);
  scene.add(markerLayer.object);
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
  const touches = new Map<number, { x: number; y: number }>();
  let pinch: { d: number; cx: number; cy: number } | null = null;
  let dirty = true;
  let frame = 0;
  let stats: FrameStats = { drawCalls: 0, textureBytes: 0, frameMs: 0 };
  let lastTick = performance.now();
  let raf = 0;
  let disposed = false;
  let hovered: InstanceId | null = null;
  /** The stack item under the pointer (DESIGN "The effect stack": hovering an item highlights its source and targets). */
  let hoverItem: string | null = null;
  /** The stack lane as drawn (scene/stack.ts), refreshed with every state. */
  let entries: StackEntry[] = [];
  /** The marker being dragged, if any. */
  let itemDrag: ItemDrag | null = null;
  let idCounter = 0;
  const idPrefix = Math.random().toString(36).slice(2, 8);
  const newId = (p: string) => `${p}-${idPrefix}-${(++idCounter).toString(36)}`;
  const reduced = () => view.reducedMotion;

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
      const e = entries.find((x) => x.item.id === item);
      return e ? { point: itemAnchor(entryPose(e)), shape: { kind: 'point' } } : null;
    },
    extraLines: () => markerLines(),
  });
  scene.add(lineView.lines.object);
  scene.add(lineView.pingRings);
  const seatAngleOf = (seat: SeatId): number => (state ? (seatLayoutOf(state, layout, seat)?.angle ?? 0) : 0);
  const combatCtx: CombatContext = { angleOf: seatAngleOf, newId };

  const dispatch = (actions: ActionDraft[]) => {
    for (const a of actions) opts.dispatch(a);
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
  function relayout(now: number): void {
    if (!state) return;
    const places = placeCards(state, view, { game: opts.game, layout, viewerSeat });
    entries = stackEntries(state, layout.stackLane, viewerAngle(state, layout, viewerSeat));
    if (hoverItem && !state.stack.some((i) => i.id === hoverItem)) hoverItem = null;
    for (const id of [...rcards.keys()]) if (!places.has(id) && !drag?.ids.includes(id)) rcards.delete(id);
    // Cards a settle sends home move together with the settle timing, staggered, their attachments riding along
    // (DESIGN "Specification: geometry, layout and motion", Motion).
    const settling = settleSlots(state, places.keys(), (id) => rcards.get(id)?.inst);
    for (const [id, place] of places) {
      const inst = state.cards[id]!;
      if (place.ref) faces.register(place.ref, place.faceIndex);
      let rc = rcards.get(id);
      if (!rc) {
        rc = { id, inst, place, motion: new CardMotion(place.rest), shownKey: place.key, shownDim: place.dimmed, localUntil: 0, expect: null, tierDrawn: null };
        rcards.set(id, rc);
        continue;
      }
      const prev = rc.inst;
      rc.inst = inst;
      rc.place = place;
      if (prev.face !== inst.face && rc.shownKey !== place.key) rc.motion.startFlip(now, theme.motion, reduced());
      else if (rc.motion.flipSwapped) {
        rc.shownKey = place.key;
        rc.shownDim = place.dimmed;
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
      const kind = prev.tapped !== inst.tapped && onlyRot ? 'tap' : now < rc.localUntil ? 'spring' : 'remote';
      rc.motion.moveTo(place.rest, kind, now, theme.motion, reduced());
    }
    sortOrder();
    dirty = true;
  }

  function sortOrder(): void {
    order = [...rcards.values()].sort((a, b) => compareSort(sortKey(a), sortKey(b)));
  }

  function sortKey(rc: RCard): readonly number[] {
    if (drag?.ids.includes(rc.id)) return [LAYER.dragged, drag.ids.indexOf(rc.id), 0];
    return rc.place.sort;
  }

  // --- Rendering ----------------------------------------------------------------------------------------------------
  function syncCamera(): void {
    const v = rig.view;
    const vp = rig.viewport;
    const f = forward(v.angle);
    camera.fov = rig.fovDeg;
    camera.aspect = vp.w / vp.h;
    camera.near = Math.max(1, v.dist - 400);
    camera.far = v.dist + 400;
    camera.position.set(v.cx, v.dist, -v.cy);
    camera.up.set(f.x, 0, -f.y);
    camera.lookAt(v.cx, 0, -v.cy);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
  }

  function resize(): void {
    const vp = viewport();
    renderer.setSize(vp.w, vp.h, false);
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
      const pose = rc.motion.pose;
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
        specs.set(`ctr:${rc.id}`, { text: kinds.map((k) => counterText(k, c.counters[k]!)).join('\n'), x: p.x, y: p.y, z: 20, rot: pose.rot, size: COUNTER_SIZE, scale: counterScale, colour: t.fg, outline: t.surface, anchorX: 'center', anchorY: 'middle' });
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
    // seat colour (DESIGN "The effect stack", Reading it; Note).
    for (const e of entries) {
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

  /** Outline of a stack entry: its controller's seat colour, pulsing while its round waits (reduced motion: steady). */
  function entryHighlight(e: StackEntry): { colour: string; width: number } {
    const base = 0.8;
    if (!e.pending) return { colour: seatColour(e.item.controller), width: base };
    const pulse = reduced() ? 1 : 0.5 + 0.5 * Math.sin((lastTick / 900) * Math.PI * 2);
    return { colour: seatColour(e.item.controller), width: base + 1.4 * pulse };
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

  /** A ping is still fading: keep drawing. */
  let pingsLive = false;

  function draw(): void {
    const t0 = performance.now();
    frame++;
    syncCamera();
    const cardPx = CARD_H * rig.pxPerMm();
    const want = tierForScreenHeight(cardPx);
    const selection = new Set(view.selection);
    const dressing = theme.cardDressing;
    const vp = rig.viewport;
    const sorted: { sort: readonly number[]; draw: CardDraw }[] = [];
    const lit = new Set(hoverItem && state ? hoverHighlights(state, hoverItem) : []);
    const slotOf = new Map(entries.map((e) => [e.item.card ?? '', e]));
    for (const rc of order) {
      const pose = rc.motion.pose;
      if (rc.motion.flipSwapped) {
        rc.shownKey = rc.place.key;
        rc.shownDim = rc.place.dimmed;
      }
      const s = rig.tableToScreen(pose);
      const onScreen = s.x > -cardPx && s.y > -cardPx && s.x < vp.w + cardPx && s.y < vp.h + cardPx;
      const uv = faces.use(rc.shownKey, onScreen ? want : 'small', frame);
      rc.tierDrawn = uv ? (['small', 'normal', 'large'] as const)[uv.tier]! : null;
      const dragging = drag?.ids.includes(rc.id) ?? false;
      const sel = selection.has(rc.id);
      const hov = view.hovered === rc.id || hovered === rc.id || lit.has(rc.id);
      const entry = rc.place.kind === 'stack' && !dragging ? slotOf.get(rc.id) : undefined;
      sorted.push({
        sort: sortKey(rc),
        draw: {
          pose,
          z: rc.place.z + (dragging ? GEOMETRY.dragLift : 0),
          scaleX: rc.motion.flipScale(lastTick),
          uv,
          dim: rc.shownDim ? 1 - dressing.faceDownOwnerOpacity : 0,
          highlight: sel ? { colour: dressing.selected.colour, width: dressing.selected.width } : hov ? { colour: dressing.hover.colour, width: dressing.hover.width } : entry ? entryHighlight(entry) : null,
        },
      });
    }
    // Ability, trigger and copy markers take their slots in the lane, between the spells (scene/stack.ts).
    for (const e of entries) {
      if (!e.marker) continue;
      const src = e.face ? rcards.get(e.face) : undefined;
      const k = entryScale(e);
      const pose = drawnPose(entryPose(e), k);
      const s = rig.tableToScreen(pose);
      const onScreen = s.x > -cardPx && s.y > -cardPx && s.x < vp.w + cardPx && s.y < vp.h + cardPx;
      const uv = faces.use(src ? src.shownKey : BACK_KEY, onScreen ? want : 'small', frame);
      const held = itemDrag?.item === e.item.id;
      const hov = hoverItem === e.item.id || held;
      sorted.push({
        sort: held ? [LAYER.dragged, 0, 0] : [LAYER.stack, 0, e.index],
        draw: { pose, z: held ? GEOMETRY.dragLift : 0, scaleX: 1, scale: k, uv, dim: 0, highlight: hov ? { colour: dressing.hover.colour, width: dressing.hover.width } : entryHighlight(e) },
      });
    }
    sorted.sort((a, b) => compareSort(a.sort, b.sort));
    const draws = sorted.map((x) => x.draw);
    cards.setTextures(faces.textures());
    cards.write(draws);
    lineView.sync();
    const specs = textSpecs();
    lineView.labelSpecs(specs);
    text.sync(specs);
    labels.sync(labelSpecs());
    syncDisplaced();
    pingsLive = lineView.syncPings(performance.now());
    themeInstance.update(0);
    renderer.render(scene, camera);
    stats = { drawCalls: renderer.info.render.calls, textureBytes: faces.bytes, frameMs: performance.now() - t0 };
    dirty = false;
  }

  function tick(): void {
    if (disposed) return;
    raf = requestAnimationFrame(tick);
    const now = performance.now();
    const dt = Math.min(100, now - lastTick);
    lastTick = now;
    let changed = rig.step(now, dt);
    if (drag) {
      followDrag();
      changed = true;
    }
    for (const rc of rcards.values()) {
      if (rc.motion.moving && rc.motion.step(now, dt, theme.motion)) changed = true;
      else if (rc.motion.moving === false && rc.shownKey !== rc.place.key && rc.motion.flipSwapped) changed = true;
      if (rc.expect && now > rc.expect.until) {
        rc.expect = null;
        if (!samePose(rc.motion.target, rc.place.rest)) rc.motion.moveTo(rc.place.rest, 'spring', now, theme.motion, reduced());
        changed = true;
      }
      if (rc.motion.moving) changed = true;
    }
    if (faces.pump(frame)) changed = true;
    if (pingsLive) changed = true;
    if (!reduced() && entries.some((e) => e.pending)) changed = true;
    if (changed || dirty) draw();
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
    syncCamera();
    const v = new THREE.Vector3(p.x, p.z, -p.y).project(camera);
    if (!Number.isFinite(v.x) || !Number.isFinite(v.y)) return null;
    const r = canvasRect();
    return { x: r.left + ((v.x + 1) / 2) * r.width, y: r.top + ((1 - v.y) / 2) * r.height };
  }

  /** Topmost drawn card under a viewport point; null when a stack marker covers that point. */
  function pick(x: number, y: number, exclude?: ReadonlySet<InstanceId>): RCard | null {
    const p = screenToTable(x, y);
    const marker = markerAt(p);
    for (let i = order.length - 1; i >= 0; i--) {
      const rc = order[i]!;
      if (exclude?.has(rc.id)) continue;
      if (!pointInCard(p, rc.motion.pose)) continue;
      // A marker covers what lies under it: older items of the lane and anything on the table below the lane.
      if (marker && (rc.place.kind === 'stack' ? (entries.find((e) => e.item.card === rc.id)?.index ?? -1) < marker.index : rc.place.sort[0] < LAYER.stack)) return null;
      return rc;
    }
    return null;
  }

  /** The topmost stack entry at a table point when it is a marker (markers are not cards). */
  function markerAt(p: TablePoint): StackEntry | null {
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

  function setHoverItem(item: string | null): void {
    if (item === hoverItem) return;
    hoverItem = item;
    dirty = true;
  }

  function targets() {
    return state ? dropTargets(state, layout, viewerAngle(state, layout, viewerSeat), opts.game) : [];
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
    if (!state) return false;
    const inst = rc.inst;
    const zoneObj = state.zones[inst.zone];
    const pres = presentationOf(opts.game, state, inst.zone);
    // Library cards are drawn through the draw action (a private effect), other seats' hands are not ours to drag.
    if (!external && zoneObj && zoneObj.visibility !== 'public') return false;
    let ids: InstanceId[] = [rc.id];
    let keepPile = false;
    if (pres === 'free') {
      const sel = view.selection.filter((id) => id !== rc.id && state!.cards[id] && isBattlefield(state!.cards[id]!.zone));
      if (view.selection.includes(rc.id) && sel.length > 0) ids = [rc.id, ...sel];
      else if (inst.pile && (inst.pile.index === 0 || pileGrab)) {
        const members = Object.values(state.cards)
          .filter((c) => c.pile?.id === inst.pile!.id)
          .sort((a, b) => a.pile!.index - b.pile!.index)
          .map((c) => c.id);
        ids = [members[0]!, ...members.slice(1)];
        keepPile = true;
      }
    }
    const anchor = rcards.get(ids[0]!)!;
    const p = screenToTable(x, y);
    const start = new Map<InstanceId, Pose>();
    for (const id of ids) {
      const r = rcards.get(id);
      if (r) start.set(id, { ...r.motion.pose, rot: r.place.rest.rot });
    }
    const a = anchor.motion.pose;
    drag = { pointerId, ids, offset: { x: a.x - p.x, y: a.y - p.y }, start, keepPile, temp, last: { x, y }, external, added: [] };
    for (const id of ids) rcards.get(id)!.expect = null;
    sortOrder();
    dirty = true;
    return true;
  }

  /** Drag targets follow the pointer (recomputed each frame so zooming mid-drag keeps the card under the cursor). */
  function followDrag(): void {
    if (!drag) return;
    const p = screenToTable(drag.last.x, drag.last.y);
    const a0 = drag.start.get(drag.ids[0]!)!;
    const ax = p.x + drag.offset.x;
    const ay = p.y + drag.offset.y;
    for (const id of drag.ids) {
      const rc = rcards.get(id);
      const s = drag.start.get(id);
      if (!rc || !s) continue;
      const pose = { x: ax + (s.x - a0.x), y: ay + (s.y - a0.y), rot: s.rot };
      if (reduced()) rc.motion.cut(pose);
      else rc.motion.follow(pose);
    }
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

  function finishDrag(ctrl: boolean, cancel = false): void {
    const d = drag;
    if (!d || !state) {
      drag = null;
      return;
    }
    drag = null;
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
    if (cancel || !anchorRc || insts.length === 0) return back();
    const p = screenToTable(d.last.x, d.last.y);
    const a0 = d.start.get(d.ids[0]!)!;
    const anchorPose: Pose = { x: p.x + d.offset.x, y: p.y + d.offset.y, rot: a0.rot };
    let actions: ActionDraft[];
    let predicted: Map<InstanceId, Pose> | null = null;
    // Dropped onto another seat's attacker (or its blocker fan): a block (DESIGN "Combat and annotation", Block).
    const under = d.external ? null : pick(d.last.x, d.last.y, new Set(d.ids));
    // Dropped back inside its own fan with nothing under the pointer: a reorder (or nothing), not an unblock.
    const attacker = (under ? fanAttacker(state, under.id) : null) ?? (d.external ? null : fanUnder(state, d.ids, p, combatCtx));
    const plan = attacker ? blockPlan(state, d.ids, attacker, p, combatCtx) : null;
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
    if (d.temp) {
      actions = tempMoveActions(insts, d.start, anchorPose, { newId });
      predicted = offsetPoses(d, anchorPose);
    } else {
      const dest = destinationAt({ x: anchorPose.x, y: anchorPose.y }, insts[0]!);
      const dragged = new Set(d.ids);
      const snapCards: SnapCard[] = [];
      for (const rc of rcards.values()) {
        if (dragged.has(rc.id) || rc.place.kind !== 'free' || rc.place.fanned) continue;
        const sl = seatLayoutOf(state, layout, rc.inst.controller);
        // Drawn pose: a tapped card's extents are those of the turned card.
        snapCards.push({ id: rc.id, pose: rc.place.rest, frameDeg: sl?.angle ?? 0, ...(rc.inst.pile ? { pile: rc.inst.pile } : {}) });
      }
      const result: DropResult = resolveDrop(
        { pose: anchorPose, cursor: p, single: d.ids.length === 1, ctrl, frameDeg: dest?.frameDeg ?? 0, extent: groupExtent(d) },
        { table: layout.table, cards: snapCards, targets: targets() },
      );
      lastDrop = result;
      // An item's card dropped back into the lane moves to the slot under the pointer (DESIGN "The effect stack",
      // Resolving 4: items can be reordered by hand).
      const anchorInst = insts[0]!;
      if (result.kind === 'zone' && result.zone === anchorInst.zone && presentationOf(opts.game, state, result.zone) === 'cascade-lane') {
        const item = state.stack.find((i) => i.card === anchorInst.id);
        const to = slotAt(layout.stackLane, viewerAngle(state, layout, viewerSeat), p, state.stack.length);
        if (!item || state.stack.indexOf(item) === to) return back();
        for (const id of d.ids) {
          const r = rcards.get(id);
          if (r) r.localUntil = now + EXPECT_MS;
        }
        back();
        dispatch([{ type: 'stackReorder', item: item.id, index: to }]);
        return;
      }
      if (result.kind !== 'zone' && !dest) return back();
      actions = dropActions(state, insts, d.start, result, dest ?? { zone: insts[0]!.zone, controller: insts[0]!.controller }, {
        newId,
        keepPile: d.keepPile,
        presentation: (z) => presentationOf(opts.game, state!, z),
      });
      if (result.kind !== 'zone') predicted = offsetPoses(d, result.pose);
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
    if (e.pointerType === 'touch') {
      touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (touches.size === 2) {
        // Two fingers always drive the camera: abandon any one-finger gesture.
        if (drag) finishDrag(false, true);
        gesture = { kind: 'pinch' };
        pinch = pinchOf();
        canvas.setPointerCapture(e.pointerId);
        return;
      }
    }
    if (gesture) return;
    if (e.button !== 0 && e.button !== 1 && e.button !== 2) return;
    if (e.button === 1) e.preventDefault();
    const rc = pick(e.clientX, e.clientY);
    // Right button: a press on a public card may become a line (right-drag); elsewhere it is the context menu alone.
    if (e.button === 2 && (!rc || !lineSource(rc))) return;
    menuPending = null;
    const pileGrab = !!rc && rc.inst.pile?.kind === 'squared' && onPileBadge(rc, e.clientX, e.clientY);
    const item = rc ? null : (markerAt(screenToTable(e.clientX, e.clientY))?.item.id ?? null);
    gesture = { kind: 'press', pointerId: e.pointerId, button: e.button, card: rc?.id ?? null, item, x0: e.clientX, y0: e.clientY, shift: e.shiftKey, alt: e.altKey, pileGrab };
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
    const p = screenToTable(x, y);
    const pose = rc.motion.pose;
    const [bx, by] = rot2(-CARD_W / 2 + 8, CARD_H / 2 - 8, pose.rot);
    return Math.hypot(p.x - (pose.x + bx), p.y - (pose.y + by)) <= 8;
  }

  function pinchOf(): { d: number; cx: number; cy: number } | null {
    const pts = [...touches.values()];
    if (pts.length < 2) return null;
    const [a, b] = pts as [{ x: number; y: number }, { x: number; y: number }];
    return { d: Math.hypot(a.x - b.x, a.y - b.y), cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 };
  }

  function onPointerMove(e: PointerEvent): void {
    if (e.pointerType === 'touch' && touches.has(e.pointerId)) touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (gesture?.kind === 'pinch') {
      const next = pinchOf();
      if (pinch && next && pinch.d > 0) {
        const c = toCanvas(next.cx, next.cy);
        rig.panBy(next.cx - pinch.cx, next.cy - pinch.cy);
        rig.zoomAt(c.x, c.y, next.d / pinch.d);
        dirty = true;
      }
      pinch = next;
      return;
    }
    if (drag && e.pointerId === drag.pointerId && !drag.external) {
      drag.last = { x: e.clientX, y: e.clientY };
      return;
    }
    if (gesture?.kind === 'line' && e.pointerId === gesture.pointerId) {
      const dr = lineView.draft;
      if (dr) {
        dr.cur = screenToTable(e.clientX, e.clientY);
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
      const rc = pick(e.clientX, e.clientY);
      setHover(rc?.id ?? null);
      setHoverItem(itemAt(e.clientX, e.clientY, rc));
      return;
    }
    if (e.pointerId !== ('pointerId' in gesture ? gesture.pointerId : -1)) return;
    if (gesture.kind === 'press') {
      const g = gesture;
      const moved = Math.hypot(e.clientX - g.x0, e.clientY - g.y0);
      if (moved < (e.pointerType === 'touch' ? TOUCH_THRESHOLD_PX : DRAG_THRESHOLD_PX)) return;
      const rc = g.card ? rcards.get(g.card) : null;
      if (g.button === 2) {
        const source = rc ? lineSource(rc) : null;
        menuPending = null;
        lineView.draft = source && rc ? { pointerId: g.pointerId, source, sourceCard: rc.id, target: lineTargetAt(e.clientX, e.clientY, rc.id), cur: screenToTable(e.clientX, e.clientY), shift: e.shiftKey || g.shift } : null;
        gesture = lineView.draft ? { kind: 'line', pointerId: g.pointerId } : null;
        if (!gesture) release(e);
        setHover(null);
        dirty = true;
        return;
      }
      if (g.button === 0 && rc && startCardDrag(rc, g.pointerId, g.x0, g.y0, g.alt, g.pileGrab)) {
        gesture = { kind: 'drag' };
        drag!.last = { x: e.clientX, y: e.clientY };
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
    if (gesture.kind === 'pan') {
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

  function showMarquee(g: Extract<Gesture, { kind: 'marquee' }>): void {
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
    if (e.pointerType === 'touch') touches.delete(e.pointerId);
    if (gesture?.kind === 'pinch') {
      if (touches.size === 0) {
        gesture = null;
        pinch = null;
      } else pinch = pinchOf();
      return;
    }
    if (drag && e.pointerId === drag.pointerId && !drag.external) {
      drag.last = { x: e.clientX, y: e.clientY };
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
    const g = gesture;
    if (!g || ('pointerId' in g && g.pointerId !== e.pointerId)) return;
    gesture = null;
    release(e);
    if (g.kind === 'line') {
      menuSuppressUntil = performance.now() + MENU_SUPPRESS_MS;
      const dr = lineView.draft;
      dispatch(lineView.finish(dr ? lineTargetAt(e.clientX, e.clientY, dr.sourceCard) : null, e.shiftKey, newId));
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
      if (g.card) {
        if (g.shift) setSelection(view.selection.includes(g.card) ? view.selection.filter((id) => id !== g.card) : [...view.selection, g.card]);
        else if (!view.selection.includes(g.card) || view.selection.length > 1) setSelection([g.card]);
      } else {
        if (!g.shift && view.selection.length) setSelection([]);
        // A tap on a seat's avatar spot goes to that seat (DESIGN "Camera and navigation": go to another seat, tap an avatar).
        const seat = g.item ? null : lineView.avatarAt(screenToTable(e.clientX, e.clientY));
        if (seat?.kind === 'seat') controls.goToSeat(seat.id);
      }
    } else if (g.kind === 'pan') {
      const s = g.samples;
      const first = s[0]!;
      const last = s[s.length - 1]!;
      const dt = last.t - first.t;
      if (!reduced() && dt > 0 && performance.now() - last.t < 80) rig.fling((last.x - first.x) / dt, (last.y - first.y) / dt);
    } else if (g.kind === 'marquee') {
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
  }

  function release(e: PointerEvent): void {
    try {
      if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
    } catch {
      // ignore
    }
  }

  function onPointerCancel(e: PointerEvent): void {
    touches.delete(e.pointerId);
    if (drag && drag.pointerId === e.pointerId) finishDrag(false, true);
    if (itemDrag && itemDrag.pointerId === e.pointerId) finishItemDrag(true);
    if (gesture?.kind === 'marquee') marqueeEl.style.display = 'none';
    if (gesture?.kind === 'line') dirty = true;
    lineView.draft = null;
    gesture = null;
    pinch = null;
    menuPending = null;
  }

  function onDoubleClick(e: MouseEvent): void {
    if (!state) return;
    const rc = pick(e.clientX, e.clientY);
    if (!rc) {
      // Double-click on empty space beside a card zooms to it (DESIGN "Camera and navigation").
      const p = screenToTable(e.clientX, e.clientY);
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
      setHover(null);
      setHoverItem(null);
    }
  }

  // External drag (from the HUD's hand fan) listens on window.
  function onWindowMove(e: PointerEvent): void {
    if (drag?.external && e.pointerId === drag.pointerId) drag.last = { x: e.clientX, y: e.clientY };
  }
  function onWindowUp(e: PointerEvent): void {
    if (drag?.external && e.pointerId === drag.pointerId) {
      drag.last = { x: e.clientX, y: e.clientY };
      finishDrag(e.ctrlKey, e.type === 'pointercancel');
    }
  }
  function onKey(e: KeyboardEvent): void {
    if (e.key === 'Escape' && drag) finishDrag(false, true);
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
  const resizeObserver = new ResizeObserver(() => resize());
  resizeObserver.observe(host);
  resize();

  // --- Debug ----------------------------------------------------------------------------------------------------------
  function screenRect(rc: RCard): DOMRect {
    syncCamera();
    const r = canvasRect();
    const z = rc.place.z + (drag?.ids.includes(rc.id) ? GEOMETRY.dragLift : 0);
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
        const visible = screen.right > r.left && screen.left < r.right && screen.bottom > r.top && screen.top < r.bottom;
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
          moving: rc.motion.moving,
          tier: rc.tierDrawn,
          order: i,
          displaced: ghostOf(rc) !== null,
          ghost: ghostOf(rc),
        };
      });
    },
    camera(): DebugCamera {
      const v = rig.view;
      return { rig: 'birdseye', fov: rig.fovDeg, position: [v.cx, v.cy, v.dist], pitch: 90 };
    },
    lines: () => lineView.debugLines(),
    drawnLines: () => lineView.debugDrawn(),
    pings: () => lineView.debugPings(performance.now()),
    frameStats() {
      return { ...stats };
    },
    lastDrop: () => lastDrop,
    idle: () => !drag && !rig.moving && ![...rcards.values()].some((rc) => rc.motion.moving),
    pendingTextures: () => faces.pending,
  };
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
  const debugParts = {
    cards: () => debug.cards(),
    camera: () => debug.camera(),
    lines: () => debug.lines(),
    frameStats: () => debug.frameStats(),
    drawnLines: () => debug.drawnLines(),
    pings: () => debug.pings(),
    stack: () => stackDebug(),
    tableView: () => tableViewDebug(),
  };
  registerDebug(debugParts);

  /** The table's seats as this viewer sees them (M3-P1): canonical territory and avatar spot, and where they are on screen. */
  function tableViewDebug(): DebugTableView | null {
    if (!state) return null;
    const st = state;
    const v = rig.view;
    const seats = Object.values(st.seats)
      .sort((a, b) => a.index - b.index)
      .flatMap((seat): DebugSeatView[] => {
        const sl = seatLayoutOf(st, layout, seat.id);
        if (!sl) return [];
        const territory = { x: sl.territory.x, y: sl.territory.y };
        const avatar = { x: sl.zones.avatar.x, y: sl.zones.avatar.y };
        const t = worldToScreen({ ...territory, z: 0 });
        const a = worldToScreen({ ...avatar, z: 0 });
        return [{ seat: seat.id, index: seat.index, angle: sl.angle, territory, avatar, screen: t && a ? { territory: t, avatar: a } : null }];
      });
    return { format: layout.format, table: { ...layout.table }, viewerAngle: viewerAngle(st, layout, viewerSeat), camera: { x: v.cx, y: v.cy, dist: v.dist }, seats };
  }

  // --- Camera controls ------------------------------------------------------------------------------------------------
  const blend = (animate = true) => (animate && !reduced() ? theme.motion.cameraBlendMs : 0);
  const controls: CameraControls = {
    fit(animate = true) {
      rig.animateTo(rig.fitView(), performance.now(), blend(animate));
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
      rig.animateTo(rig.rectView(sl.territory), performance.now(), blend());
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
      rig.animateTo({ cx: p.x, cy: p.y, dist: rig.minDist(), angle: rig.view.angle }, performance.now(), blend());
      dirty = true;
    },
    setRig(_rig: CameraRig) {
      // M0 ships the bird's-eye rig only; the ego rig arrives with M4-P1.
    },
    rig: () => 'birdseye',
  };

  raf = requestAnimationFrame(tick);

  /** The game's layout for a table format, or null when the game has none for it (the scene keeps its own). */
  function layoutFor(format: TableState['format']): TableLayout | null {
    try {
      const l = opts.game.layout(format);
      return l.format === format ? l : null;
    } catch {
      return null;
    }
  }

  const sceneApi: SceneHandle = {
    update(next, nextView) {
      const prevState = state;
      const viewChanged = nextView !== view;
      state = next;
      const openChanged = nextView.openPile !== view.openPile || nextView.privateFaces !== view.privateFaces;
      view = nextView;
      // The table's format picks the layout (DESIGN "Players, seats and formats"; M3-P1): a format changed in the lobby
      // brings its own table size, territories and seat angles.
      const formatLayout = next.format !== layout.format ? layoutFor(next.format) : null;
      if (formatLayout) {
        layout = formatLayout;
        themeInstance.dispose();
        themeInstance = theme.build({ renderer, scene, camera, table: layout.table, quality: theme.quality[0]!, reducedMotion: reduced() });
      }
      if (formatLayout || prevState === null || Object.keys(prevState.seats).length !== Object.keys(next.seats).length) {
        rig.setTable(layout.table, viewerAngle(state, layout, viewerSeat), fitFrame(state, layout, viewerSeat));
        rebuildMarkings();
      } else if (prevState.seats !== next.seats) {
        // A chair taken or left changes which hand rows the fitted view must show, and the names at the avatar spots.
        rig.setFrame(fitFrame(state, layout, viewerSeat));
        if (Object.values(next.seats).some((s) => prevState.seats[s.id]?.name !== s.name)) rebuildMarkings();
      }
      if (prevState !== next || openChanged) relayout(performance.now());
      if (viewChanged) dirty = true;
    },
    setTheme(next) {
      themeInstance.dispose();
      theme = next;
      themeInstance = theme.build({ renderer, scene, camera, table: layout.table, quality: theme.quality[0]!, reducedMotion: reduced() });
      cards.setBackground(theme.tokens.colours.surface);
      markMaterial.color.set(theme.tokens.colours.border);
      ghostLayer.setOpacity(theme.cardDressing.ghost.opacity);
      rig.inertiaMs = theme.motion.panInertiaMs;
      dirty = true;
    },
    setLayout(nextLayout: TableLayout, seat: SeatId | null) {
      layout = nextLayout;
      viewerSeat = seat;
      themeInstance.dispose();
      themeInstance = theme.build({ renderer, scene, camera, table: layout.table, quality: theme.quality[0]!, reducedMotion: reduced() });
      rig.setTable(layout.table, viewerAngle(state, layout, viewerSeat), fitFrame(state, layout, viewerSeat));
      rebuildMarkings();
      relayout(performance.now());
    },
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
        };
        rcards.set(card, rc);
        added.push(card);
      }
      if (startCardDrag(rc, -1, x, y, false, false, true)) {
        drag!.added = added;
        drag!.pointerId = activePointer ?? -1;
      }
    },
    worldToScreen,
    screenToTable(x, y) {
      return screenToTable(x, y);
    },
    debug,
    dispose() {
      disposed = true;
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
      themeInstance.dispose();
      faces.dispose();
      cards.dispose();
      text.dispose();
      labels.dispose();
      lineView.dispose();
      ghostLayer.dispose();
      markerLayer.dispose();
      markGeometry.dispose();
      markMaterial.dispose();
      renderer.dispose();
      // Free the WebGL context now, not at GC: browsers cap live contexts (about 16).
      renderer.forceContextLoss();
      canvas.remove();
      // Debug parts must not point at a disposed scene (a newer scene's parts stay).
      const hook = typeof window === 'undefined' ? undefined : (window.__spellplane as Record<string, unknown> | undefined);
      if (hook) for (const [k, fn] of Object.entries(debugParts)) if (hook[k] === fn) delete hook[k];
      marqueeEl.remove();
    },
  };

  // The HUD's drag starts with its own pointerdown; remember that pointer so its moves and release reach us.
  let activePointer: number | null = null;
  function trackPointer(e: PointerEvent): void {
    activePointer = e.pointerId;
  }
  addEventListener('pointerdown', trackPointer, true);
  // The HUD's hover keys reach a marker through this (scene/stack.ts hoveredStackItem).
  registerStackHover(sceneApi, () => hoverItem);

  return sceneApi;
}

function samePose(a: Pose, b: Pose, eps = 0.01): boolean {
  return Math.abs(a.x - b.x) < eps && Math.abs(a.y - b.y) < eps && Math.abs(deltaDeg(a.rot, b.rot)) < eps;
}
