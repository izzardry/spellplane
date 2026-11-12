/**
 * The draft surface: pack fan or grid on the private table, pool area sorted by colour, waiting-pack indicators,
 * Rochester and Grid on the shared table (DESIGN "Pre-game: draft, sealed and deck building", Drafting interaction).
 * Contracts: M2-C; implementer: M2-P4.
 *
 * A pure view of local data the HUD hands it (DraftSurfaceView): it never touches the network or the secret store and
 * reports gestures through `events`. Click a pack card to mark it, click it again to confirm (Enter is the HUD's);
 * confirmed picks fly to the pool area, which sorts into colour columns and stays visible while drafting. Packs
 * waiting at each seat are drawn as a pile of backs per seat with its count. In a Grid draft, row and column handles
 * around the 3×3 grid take a line.
 *
 * Layout (table mm, viewer at the bottom, see DRAFT_LAYOUT): the seats' queue piles in a column at the left, the pack
 * (two arced rows of up to eight, or the 3×3 grid) at the top, the pool in eight cascade columns below it
 * (W, U, B, R, G, multicolour, colourless, land), cascade offset 14 per card, compressed when a column runs long.
 */
import * as THREE from 'three';
import { CAMERA, GEOMETRY } from '../core/geometry';
import { seatsInOrder } from '../core/selectors';
import type { CardRef, DraftCard, InstanceId, PackId, Pose, SeatId, TableState } from '../core/types';
import type { CardData } from '../data/types';
import type { Theme, ThemeInstance } from '../themes/types';
import { BirdseyeRig, NO_INSETS, type FrameBox, type Insets } from './camera';
import { CardLayer, type CardDraw } from './cards';
import { BACK_KEY, FaceTextures, faceKey } from './faces';
import { CARD_H, CARD_W, cardCorners, deltaDeg, forward, pointInCard } from './math';
import { CardMotion } from './motion';
import { tierForScreenHeight } from './textures';
import type { CameraControls, CreateDraftSurface, DebugCard, DraftSurface, DraftSurfaceOptions, DraftSurfaceView, ScreenPoint, TablePoint } from './types';

// ---------------------------------------------------------------------------------------------------------------------
// Pure layout (unit-tested in tests/unit/ui/draft/layout.test.ts)
// ---------------------------------------------------------------------------------------------------------------------

/** Draft table layout constants, mm (DESIGN "Specification: geometry, layout and motion": card 63 × 88, cascade 14). */
export const DRAFT_LAYOUT = {
  /** Centre x of the pack area and the pool columns. */
  packX: 60,
  /** Centre y of the first pack row; further rows step down by `rowStep`. */
  firstRowY: 230,
  rowStep: GEOMETRY.card.h + 10,
  /** Horizontal step between pack cards and between pool columns (card plus 8). */
  colStep: GEOMETRY.card.w + 8,
  /** At most this many cards per fan row. */
  perRow: 8,
  /** Fan arc: outer cards drop this far and turn this many degrees. */
  fanDrop: 8,
  fanTiltDeg: 3,
  /** A marked card is raised this far toward the far edge. */
  markRaise: 6,
  /** Grid cells: horizontal step (card plus 10). */
  gridStep: GEOMETRY.card.w + 10,
  /** Space between the pack area's lowest card edge and the pool's first card edge. */
  poolGap: 56,
  /** Pool cascade offset per card (the design's cascade offset) and the depth a column may use before it compresses. */
  cascade: GEOMETRY.cascadeOffset,
  poolDepth: 256,
  /** The queue column: x of the piles, y of the first, step between seats, pile scale. */
  queueX: -360,
  queueStep: 110,
  queueScale: 0.55,
  /** Offset per pack in a queue pile (mm, before scaling), and how many backs a pile draws at most. */
  queueFan: 3,
  queueMax: 8,
  /** Frame left and right edges (x). */
  left: -430,
  right: 360,
  /** Frame top edge (y), above the grid's column handles. */
  top: 310,
  /** Margin below the pool's lowest card. */
  bottomMargin: 10,
} as const;

/** Pool columns in colour order (DESIGN "Pre-game", Drafting interaction: the pool auto-sorts by colour). */
export type PoolColumn = 'W' | 'U' | 'B' | 'R' | 'G' | 'M' | 'C' | 'L';
export const POOL_COLUMNS: readonly PoolColumn[] = ['W', 'U', 'B', 'R', 'G', 'M', 'C', 'L'];
export const POOL_COLUMN_LABELS: Readonly<Record<PoolColumn, string>> = { W: 'White', U: 'Blue', B: 'Black', R: 'Red', G: 'Green', M: 'Multicolour', C: 'Colourless', L: 'Land' };

const COLOURS = new Set(['W', 'U', 'B', 'R', 'G']);

/** The pool column of a card: lands, then mono colours, multicolour, colourless; unknown (loading) data is colourless. */
export function poolColumnOf(data: CardData | null): PoolColumn {
  if (!data) return 'C';
  const front = data.card_faces?.[0];
  const type = front?.type_line ?? data.type_line ?? '';
  if (/\bLand\b/.test(type)) return 'L';
  const colours = (data.colors ?? front?.colors ?? []).filter((c) => COLOURS.has(c));
  const unique = [...new Set(colours)];
  if (unique.length === 0) return 'C';
  if (unique.length > 1) return 'M';
  return unique[0] as PoolColumn;
}

/** One pool card placed in its column. */
export interface PoolSlot {
  /** Index in the pool (pick order); the debug id is `pool:<index>`. */
  index: number;
  ref: CardRef;
  column: PoolColumn;
  /** Position within the column, 0 at the top. */
  row: number;
  pose: Pose;
}

/**
 * Sort the pool into colour columns: within a column by mana value, then name, then pick order (stable for equal cards).
 * Columns keep fixed places, so a card never changes column when another colour arrives.
 */
export function poolColumns(pool: readonly CardRef[], card: (ref: CardRef) => CardData | null): Record<PoolColumn, { index: number; ref: CardRef }[]> {
  const out = Object.fromEntries(POOL_COLUMNS.map((c) => [c, [] as { index: number; ref: CardRef; cmc: number; name: string }[]])) as Record<PoolColumn, { index: number; ref: CardRef; cmc: number; name: string }[]>;
  pool.forEach((ref, index) => {
    const data = card(ref);
    out[poolColumnOf(data)].push({ index, ref, cmc: data?.cmc ?? 0, name: data?.name ?? '' });
  });
  for (const c of POOL_COLUMNS) out[c].sort((a, b) => a.cmc - b.cmc || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0) || a.index - b.index);
  return Object.fromEntries(POOL_COLUMNS.map((c) => [c, out[c].map(({ index, ref }) => ({ index, ref }))])) as Record<PoolColumn, { index: number; ref: CardRef }[]>;
}

/** Rows the pack area takes: three for the grid, else two (one fan row per eight cards, at least two so the pool stays put). */
export function packRows(cardCount: number, layout: 'fan' | 'grid'): number {
  if (layout === 'grid') return 3;
  return Math.max(2, Math.ceil(cardCount / DRAFT_LAYOUT.perRow));
}

/** Centre y of pack row `r`. */
export const rowY = (r: number): number => DRAFT_LAYOUT.firstRowY - r * DRAFT_LAYOUT.rowStep;

/** Where the pool starts for a pack area of `rows` rows: the label's y and the first card's centre y. */
export function poolTop(rows: number): { labelY: number; cardY: number } {
  const bottom = rowY(rows - 1) - CARD_H / 2;
  return { labelY: bottom - 32, cardY: bottom - DRAFT_LAYOUT.poolGap - CARD_H / 2 };
}

/** The fitted frame and the table plane for a pack area of `rows` rows. */
export function draftFrame(rows: number): { frame: FrameBox; table: { w: number; d: number } } {
  const L = DRAFT_LAYOUT;
  const bottom = poolTop(rows).cardY - CARD_H / 2 - L.poolDepth - L.bottomMargin;
  const frame: FrameBox = { x: (L.left + L.right) / 2, y: (L.top + bottom) / 2, w: L.right - L.left, d: L.top - bottom };
  const table = { w: 2 * Math.max(-L.left, L.right) + 40, d: 2 * Math.max(L.top, -bottom) + 40 };
  return { frame, table };
}

/**
 * Poses of the pack's cards in pack order (null for a taken grid cell). Fan: up to eight per row, rows filled evenly,
 * the outer cards dropped and turned a little (a fan, cards never overlap). Grid: 3×3, row 0 at the top.
 */
export function packPoses(cards: readonly (DraftCard | null)[], layout: 'fan' | 'grid'): (Pose | null)[] {
  const L = DRAFT_LAYOUT;
  if (layout === 'grid') {
    return cards.map((c, i) => (c ? { x: L.packX + ((i % 3) - 1) * L.gridStep, y: rowY(Math.floor(i / 3)), rot: 0 } : null));
  }
  const live = cards.map((c, i) => (c ? i : -1)).filter((i) => i >= 0);
  const rows = Math.max(1, Math.ceil(live.length / L.perRow));
  const per = Math.ceil(live.length / rows);
  const out: (Pose | null)[] = cards.map(() => null);
  const half = (L.perRow - 1) / 2;
  live.forEach((cardIndex, k) => {
    const r = Math.floor(k / per);
    const inRow = Math.min(per, live.length - r * per);
    const i = k - r * per;
    const off = i - (inRow - 1) / 2;
    const t = off / half;
    out[cardIndex] = { x: L.packX + off * L.colStep, y: rowY(r) - L.fanDrop * t * t, rot: L.fanTiltDeg * t };
  });
  return out;
}

/** Pool slots for a pack area of `rows` rows: fixed colour columns, cascading toward the owner, compressed past `poolDepth`. */
export function poolSlots(pool: readonly CardRef[], card: (ref: CardRef) => CardData | null, rows: number): PoolSlot[] {
  const L = DRAFT_LAYOUT;
  const cols = poolColumns(pool, card);
  const top = poolTop(rows).cardY;
  const out: PoolSlot[] = [];
  POOL_COLUMNS.forEach((column, c) => {
    const list = cols[column];
    const step = list.length > 1 ? Math.min(L.cascade, L.poolDepth / (list.length - 1)) : L.cascade;
    const x = L.packX + (c - (POOL_COLUMNS.length - 1) / 2) * L.colStep;
    list.forEach((e, row) => out.push({ index: e.index, ref: e.ref, column, row, pose: { x, y: top - row * step, rot: 0 } }));
  });
  return out;
}

/** The pile pose of each drafting seat's waiting packs, in seat order. */
export function queuePlaces(seats: readonly SeatId[]): { seat: SeatId; pose: Pose }[] {
  const L = DRAFT_LAYOUT;
  return seats.map((seat, i) => ({ seat, pose: { x: L.queueX, y: L.firstRowY - i * L.queueStep, rot: 0 } }));
}

/** Cards one confirm takes: the picks per pass, or fewer when the pack holds fewer (and at least one). */
export function picksNeeded(picks: number, available: number): number {
  return Math.max(1, Math.min(Math.max(1, Math.floor(picks)), available));
}

/** Whether the marked cards make a complete pick (Enter or a second click confirms them). */
export function canConfirm(marked: readonly InstanceId[], picks: number, available: number): boolean {
  return available > 0 && marked.length >= picksNeeded(picks, available);
}

/**
 * A click on pack card `card` (DESIGN "Pre-game", Drafting interaction: click a card to mark it, click again to
 * confirm). With one pick per pass a click marks the card (replacing another mark) and a click on the marked card
 * confirms it. With N picks per pass clicks add marks until N are marked (a further card replaces the oldest mark); a
 * click on a marked card confirms once N are marked, else it unmarks that card.
 */
export function clickPick(marked: readonly InstanceId[], picks: number, available: number, card: InstanceId): { kind: 'mark' | 'confirm'; cards: InstanceId[] } {
  const need = picksNeeded(picks, available);
  if (marked.includes(card)) {
    if (marked.length >= need) return { kind: 'confirm', cards: marked.slice(0, need) };
    return { kind: 'mark', cards: marked.filter((c) => c !== card) };
  }
  if (need === 1) return { kind: 'mark', cards: [card] };
  const kept = marked.length >= need ? marked.slice(marked.length - need + 1) : [...marked];
  return { kind: 'mark', cards: [...kept, card] };
}

/** Cell indices of a grid line (row 0 = cells 0..2, column 0 = cells 0, 3, 6). */
export function gridLineCells(line: 'row' | 'col', index: 0 | 1 | 2): number[] {
  return line === 'row' ? [index * 3, index * 3 + 1, index * 3 + 2] : [index, index + 3, index + 6];
}

/** Whether a grid line still holds a card (a taken line, or one emptied by crossing lines, cannot be taken). */
export function gridLineOpen(cells: readonly (DraftCard | null)[], line: 'row' | 'col', index: 0 | 1 | 2): boolean {
  return gridLineCells(line, index).some((i) => cells[i] != null);
}

const refKey = (r: CardRef): string => `${r.sid}${r.foil ? '*' : ''}`;

// ---------------------------------------------------------------------------------------------------------------------
// The surface
// ---------------------------------------------------------------------------------------------------------------------

/** A draft card as the surface's debug reports it (pack cards by instance id, pool cards as `pool:<index>`). */
export interface DraftDebugCard extends DebugCard {
  area: 'pack' | 'pool';
  ref: CardRef;
  marked: boolean;
  hovered: boolean;
  foil: boolean;
  /** Pool column, null for pack cards. */
  column: PoolColumn | null;
  moving: boolean;
}

/** A waiting-pack pile as drawn. */
export interface DraftDebugQueue {
  seat: SeatId;
  count: number;
  /** Backs drawn (at most DRAFT_LAYOUT.queueMax). */
  drawn: number;
  screen: DOMRect;
}

/** The surface's debug parts plus extras for the draft UI's own tests. */
export interface DraftSurfaceDebug {
  cards(): DraftDebugCard[];
  queues(): DraftDebugQueue[];
  /** No card animation or camera motion in progress. */
  idle(): boolean;
  /** Face textures still loading. */
  pendingTextures(): number;
  /** The packId shown, its layout and whether it lies on the shared table. */
  pack(): { packId: PackId; layout: 'fan' | 'grid'; shared: boolean } | null;
}

/** A DraftSurface whose debug carries the extras (assignable to DraftSurface). */
export type DraftSurfaceHandle = Omit<DraftSurface, 'debug'> & {
  readonly debug: DraftSurfaceDebug;
  /** The draft card under a viewport point (pack id or `pool:<index>`), or null. */
  cardAt(x: number, y: number): string | null;
  /** Viewport point of a table point. */
  toScreen(p: TablePoint): ScreenPoint;
};

interface RCard {
  id: string;
  area: 'pack' | 'pool';
  ref: CardRef;
  key: string;
  motion: CardMotion;
  column: PoolColumn | null;
  /** Draw order within its area. */
  order: number;
  tier: 'small' | 'normal' | 'large' | null;
}

const DRAG_THRESHOLD_PX = 4;
const SMALL_CAPS = 'font-variant: all-small-caps; letter-spacing: 0.08em;';

export function createDraftSurfaceImpl(host: HTMLElement, opts: DraftSurfaceOptions): DraftSurfaceHandle {
  let theme: Theme = opts.theme;
  const card = (ref: CardRef): CardData | null => opts.card?.(ref) ?? null;
  let state: TableState | null = null;
  let view: DraftSurfaceView | null = null;
  let rows = 2;

  // --- Three.js -------------------------------------------------------------------------------------------------
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: false });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, theme.quality[0]?.pixelRatio ?? 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const canvas = renderer.domElement;
  canvas.style.display = 'block';
  canvas.style.width = '100%';
  canvas.style.height = '100%';
  canvas.style.touchAction = 'none';
  canvas.setAttribute('data-scene', 'draft');
  if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
  host.appendChild(canvas);

  const overlay = document.createElement('div');
  overlay.setAttribute('data-scene', 'draft-overlay');
  Object.assign(overlay.style, { position: 'absolute', inset: '0', pointerEvents: 'none', overflow: 'hidden', fontFamily: theme.tokens.type.family });
  host.appendChild(overlay);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(CAMERA.birdseye.fovDeg, 1, 10, 100000);
  const viewport = () => ({ w: Math.max(1, host.clientWidth || innerWidth), h: Math.max(1, host.clientHeight || innerHeight) });
  let geometry = draftFrame(rows);
  const rig = new BirdseyeRig(geometry.table, viewport(), 0, theme.motion.panInertiaMs);
  rig.setTable(geometry.table, 0, geometry.frame);
  // Like the table scene, the HUD names the screen edges its own layer covers through `data-fit-insets`.
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

  let themeInstance: ThemeInstance = theme.build({ renderer, scene, camera, table: geometry.table, quality: theme.quality[0]!, reducedMotion: false });
  const faces = new FaceTextures(renderer, opts.faces, theme.cardDressing.back ?? opts.game.cardBack);
  faces.onChange = () => (dirty = true);
  const cards = new CardLayer(scene, theme.tokens.colours.surface);
  scene.add(cards.mesh);

  // Hairline outlines of the pack area and the pool area (Paper: zones are hairline outlines with small caps labels).
  const outlineGeometry = new THREE.BufferGeometry();
  const outlineMaterial = new THREE.LineBasicMaterial({ color: theme.tokens.colours.border, depthTest: false, depthWrite: false, transparent: true });
  const outlines = new THREE.LineSegments(outlineGeometry, outlineMaterial);
  outlines.renderOrder = 1;
  outlines.frustumCulled = false;
  scene.add(outlines);

  // --- Surface state --------------------------------------------------------------------------------------------
  const rcards = new Map<string, RCard>();
  let packOrder: string[] = [];
  let poolOrder: string[] = [];
  let hovered: string | null = null;
  let hoverLine: { line: 'row' | 'col'; index: 0 | 1 | 2 } | null = null;
  let queues: { seat: SeatId; count: number; pose: Pose; name: string; colour: string }[] = [];
  let dirty = true;
  let frame = 0;
  let raf = 0;
  let disposed = false;
  let lastTick = performance.now();
  const reduced = () => view?.reducedMotion ?? false;

  function setRows(next: number): void {
    if (next === rows) return;
    rows = next;
    const g = draftFrame(rows);
    const tableChanged = g.table.w !== geometry.table.w || g.table.d !== geometry.table.d;
    geometry = g;
    if (tableChanged) {
      themeInstance.dispose();
      themeInstance = theme.build({ renderer, scene, camera, table: geometry.table, quality: theme.quality[0]!, reducedMotion: reduced() });
      rig.table = geometry.table;
    }
    rig.setFrame(geometry.frame);
    rebuildOutlines();
  }

  function rebuildOutlines(): void {
    const L = DRAFT_LAYOUT;
    const segs: number[] = [];
    const rect = (x0: number, y0: number, x1: number, y1: number) => {
      const pts = [
        [x0, y0, x1, y0],
        [x1, y0, x1, y1],
        [x1, y1, x0, y1],
        [x0, y1, x0, y0],
      ];
      for (const [a, b, c, d] of pts) segs.push(a!, 0.05, -b!, c!, 0.05, -d!);
    };
    const halfW = (L.perRow * L.colStep) / 2 + 6;
    const packTop = L.firstRowY + CARD_H / 2 + 10;
    const packBottom = rowY(rows - 1) - CARD_H / 2 - L.fanDrop - 4;
    rect(L.packX - halfW, packBottom, L.packX + halfW, packTop);
    const pt = poolTop(rows);
    const poolBottom = pt.cardY - CARD_H / 2 - L.poolDepth - 4;
    rect(L.packX - halfW, poolBottom, L.packX + halfW, pt.labelY + 10);
    const pos = new THREE.Float32BufferAttribute(segs, 3);
    outlineGeometry.setAttribute('position', pos);
    outlineGeometry.computeBoundingSphere();
    dirty = true;
  }
  rebuildOutlines();

  // --- State -> render cards ------------------------------------------------------------------------------------
  function relayout(prev: DraftSurfaceView | null): void {
    if (!view) return;
    const now = performance.now();
    const pack = view.pack;
    const layout = pack?.layout ?? 'fan';
    setRows(packRows(pack ? pack.cards.filter((c) => c).length : 0, layout));
    const marked = new Set(view.marked);
    const live = new Set<string>();

    // Pack cards that left the pack since the last view: a confirmed pick flies from there to its pool slot.
    const flyFrom = new Map<string, Pose[]>();
    if (prev?.pack) {
      const still = new Set((pack?.cards ?? []).filter((c): c is DraftCard => !!c).map((c) => c.id));
      for (const c of prev.pack.cards) {
        if (!c || still.has(c.id)) continue;
        const rc = rcards.get(c.id);
        if (!rc) continue;
        const list = flyFrom.get(refKey(c.ref)) ?? [];
        list.push(rc.motion.pose);
        flyFrom.set(refKey(c.ref), list);
      }
    }

    packOrder = [];
    if (pack) {
      const poses = packPoses(pack.cards, layout);
      pack.cards.forEach((c, i) => {
        const p = poses[i];
        if (!c || !p) return;
        const pose = marked.has(c.id) ? { ...p, y: p.y + DRAFT_LAYOUT.markRaise } : p;
        place(c.id, 'pack', c.ref, pose, null, packOrder.length, null, now);
        packOrder.push(c.id);
        live.add(c.id);
      });
    }

    const prevPool = prev?.pool.length ?? view.pool.length;
    const slots = poolSlots(view.pool, card, rows);
    const byIndex = [...slots].sort((a, b) => POOL_COLUMNS.indexOf(a.column) - POOL_COLUMNS.indexOf(b.column) || a.row - b.row);
    poolOrder = [];
    for (const s of byIndex) {
      const id = `pool:${s.index}`;
      let from: Pose | null = null;
      if (s.index >= prevPool && !rcards.has(id)) from = flyFrom.get(refKey(s.ref))?.shift() ?? null;
      place(id, 'pool', s.ref, s.pose, s.column, poolOrder.length, from, now);
      poolOrder.push(id);
      live.add(id);
    }
    for (const id of [...rcards.keys()]) if (!live.has(id)) rcards.delete(id);

    // Waiting packs behind each seat (DESIGN: "Waiting packs queue visibly behind each seat").
    const seats = state ? seatsInOrder(state).filter((s) => Object.hasOwn(view!.waiting, s)) : Object.keys(view.waiting);
    queues = queuePlaces(seats).map(({ seat, pose }) => {
      const s = state?.seats[seat];
      const colour = theme.tokens.colours.seats[s?.colour ?? 0]?.colour ?? theme.tokens.colours.fg;
      return { seat, count: Math.max(0, Math.floor(view!.waiting[seat] ?? 0)), pose, name: s?.name || seat, colour };
    });
    if (hovered && !rcards.has(hovered)) hovered = null;
    dirty = true;
  }

  function place(id: string, area: 'pack' | 'pool', ref: CardRef, pose: Pose, column: PoolColumn | null, order: number, from: Pose | null, now: number): void {
    const key = faceKey(ref, 0);
    faces.register(ref, 0);
    let rc = rcards.get(id);
    if (!rc) {
      rc = { id, area, ref, key, motion: new CardMotion(from ?? pose), column, order, tier: null };
      rcards.set(id, rc);
      if (from) rc.motion.moveTo(pose, 'spring', now, theme.motion, reduced());
      return;
    }
    rc.area = area;
    rc.column = column;
    rc.order = order;
    if (rc.key !== key) {
      rc.key = key;
      rc.ref = ref;
    }
    const t = rc.motion.target;
    if (Math.abs(t.x - pose.x) > 1e-6 || Math.abs(t.y - pose.y) > 1e-6 || Math.abs(deltaDeg(t.rot, pose.rot)) > 1e-6) rc.motion.moveTo(pose, 'spring', now, theme.motion, reduced());
  }

  // --- Rendering ------------------------------------------------------------------------------------------------
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
    dirty = true;
  }

  const lineCells = (): Set<number> => (hoverLine ? new Set(gridLineCells(hoverLine.line, hoverLine.index)) : new Set());

  function draw(): void {
    frame++;
    syncCamera();
    const px = CARD_H * rig.pxPerMm();
    const want = tierForScreenHeight(px);
    const dressing = theme.cardDressing;
    const marked = new Set(view?.marked ?? []);
    const draws: CardDraw[] = [];
    // Waiting packs: a pile of backs per seat, the newest on top.
    for (const q of queues) {
      const n = Math.min(q.count, DRAFT_LAYOUT.queueMax);
      for (let k = 0; k < n; k++) {
        const off = (k - (n - 1) / 2) * DRAFT_LAYOUT.queueFan * DRAFT_LAYOUT.queueScale;
        draws.push({ pose: { x: q.pose.x + off, y: q.pose.y + off, rot: 0 }, z: k * GEOMETRY.squaredStep, scaleX: 1, scale: DRAFT_LAYOUT.queueScale, uv: faces.use(BACK_KEY, 'small', frame), dim: 0, highlight: null });
      }
    }
    const lit = lineCells();
    const cellOf = new Map<string, number>();
    view?.pack?.cards.forEach((c, i) => c && cellOf.set(c.id, i));
    for (const id of [...poolOrder, ...packOrder]) {
      const rc = rcards.get(id);
      if (!rc) continue;
      const uv = faces.use(rc.key, want, frame);
      rc.tier = uv ? (['small', 'normal', 'large'] as const)[uv.tier]! : null;
      const isMarked = rc.area === 'pack' && marked.has(rc.id);
      const isHover = hovered === rc.id || (rc.area === 'pack' && lit.has(cellOf.get(rc.id) ?? -1));
      draws.push({
        pose: rc.motion.pose,
        z: 0,
        scaleX: 1,
        uv,
        dim: 0,
        highlight: isMarked ? { colour: dressing.selected.colour, width: dressing.selected.width } : isHover ? { colour: dressing.hover.colour, width: dressing.hover.width } : null,
      });
    }
    cards.setTextures(faces.textures());
    cards.write(draws);
    themeInstance.update(0);
    renderer.render(scene, camera);
    syncOverlay();
    dirty = false;
  }

  function tick(): void {
    if (disposed) return;
    raf = requestAnimationFrame(tick);
    const now = performance.now();
    const dt = Math.min(100, now - lastTick);
    lastTick = now;
    let changed = rig.step(now, dt);
    for (const rc of rcards.values()) if (rc.motion.moving && rc.motion.step(now, dt, theme.motion)) changed = true;
    for (const rc of rcards.values()) if (rc.motion.moving) changed = true;
    if (faces.pump(frame)) changed = true;
    if (changed || dirty) draw();
  }

  // --- DOM overlay: labels, foil badges, queue counts, grid handles ----------------------------------------------
  const items = new Map<string, HTMLElement>();
  function item(key: string, make: () => HTMLElement): HTMLElement {
    let el = items.get(key);
    if (!el) {
      el = make();
      el.dataset.key = key;
      items.set(key, el);
      overlay.appendChild(el);
    }
    return el;
  }
  function label(key: string, testid: string, css: string): HTMLElement {
    return item(key, () => {
      const el = document.createElement('div');
      el.dataset.testid = testid;
      el.style.cssText = `position:absolute;white-space:nowrap;color:${theme.tokens.colours.muted};font-size:${theme.tokens.type.small}px;${css}`;
      return el;
    });
  }
  const toScreen = (p: TablePoint): ScreenPoint => rig.tableToScreen(p);
  function at(el: HTMLElement, p: TablePoint, ax: 'left' | 'center' | 'right' = 'center', ay: 'top' | 'middle' | 'bottom' = 'middle'): void {
    const s = toScreen(p);
    const tx = ax === 'left' ? '0' : ax === 'center' ? '-50%' : '-100%';
    const ty = ay === 'top' ? '0' : ay === 'middle' ? '-50%' : '-100%';
    el.style.left = `${s.x}px`;
    el.style.top = `${s.y}px`;
    el.style.transform = `translate(${tx}, ${ty})`;
  }

  function gridHandle(line: 'row' | 'col', index: 0 | 1 | 2): HTMLButtonElement {
    return item(`take-${line}-${index}`, () => {
      const b = document.createElement('button');
      b.type = 'button';
      b.dataset.testid = 'grid-take';
      b.dataset.line = line;
      b.dataset.index = String(index);
      b.textContent = line === 'row' ? `Row ${index + 1}` : `Column ${index + 1}`;
      b.setAttribute('aria-label', line === 'row' ? `Take row ${index + 1}` : `Take column ${index + 1}`);
      b.style.cssText = `position:absolute;pointer-events:auto;cursor:pointer;font:inherit;font-size:${theme.tokens.type.small}px;padding:2px 8px;border-radius:${theme.tokens.radii.sm}px;border:1px solid ${theme.tokens.colours.border};background:${theme.tokens.colours.bg};color:${theme.tokens.colours.fg};`;
      b.addEventListener('pointerenter', () => {
        hoverLine = { line, index };
        dirty = true;
      });
      b.addEventListener('pointerleave', () => {
        if (hoverLine?.line === line && hoverLine.index === index) hoverLine = null;
        dirty = true;
      });
      b.addEventListener('click', () => {
        if (b.disabled) return;
        opts.events.takeLine?.(line, index);
      });
      return b;
    }) as HTMLButtonElement;
  }

  function syncOverlay(): void {
    const L = DRAFT_LAYOUT;
    const seen = new Set<string>();
    const show = (el: HTMLElement) => {
      seen.add(el.dataset.key!);
      el.style.display = '';
    };
    const pack = view?.pack ?? null;
    const halfW = (L.perRow * L.colStep) / 2;
    // Pack area label.
    const packLabel = label('pack-label', 'draft-pack-label', SMALL_CAPS);
    const count = pack ? pack.cards.filter((c) => c).length : 0;
    packLabel.textContent = !pack ? 'Pack' : pack.layout === 'grid' ? `Shared table · grid · ${count} cards` : pack.shared ? `Shared table · ${count} cards` : `Your pack · ${count} cards`;
    at(packLabel, { x: L.packX - halfW, y: L.firstRowY + CARD_H / 2 + 12 }, 'left', 'bottom');
    show(packLabel);
    if (!pack && view) {
      const w = label('pack-empty', 'draft-pack-empty', `font-size:${theme.tokens.type.size}px;`);
      w.textContent = 'Waiting for a pack';
      at(w, { x: L.packX, y: (L.firstRowY + rowY(rows - 1)) / 2 });
      show(w);
    }
    // Pool label and column labels.
    const pt = poolTop(rows);
    const poolLabel = label('pool-label', 'draft-pool-label', SMALL_CAPS);
    poolLabel.textContent = `Pool · ${view?.pool.length ?? 0}`;
    at(poolLabel, { x: L.packX - halfW + 4, y: pt.labelY }, 'left', 'middle');
    show(poolLabel);
    const perColumn = new Map<PoolColumn, number>();
    for (const rc of rcards.values()) if (rc.column) perColumn.set(rc.column, (perColumn.get(rc.column) ?? 0) + 1);
    POOL_COLUMNS.forEach((c, i) => {
      const n = perColumn.get(c) ?? 0;
      if (!n) return;
      const el = label(`col-${c}`, 'draft-pool-column', SMALL_CAPS);
      el.dataset.column = c;
      el.dataset.count = String(n);
      el.textContent = `${POOL_COLUMN_LABELS[c]} ${n}`;
      at(el, { x: L.packX + (i - (POOL_COLUMNS.length - 1) / 2) * L.colStep, y: pt.labelY - 12 }, 'center', 'middle');
      show(el);
    });
    // Waiting packs per seat.
    for (const q of queues) {
      const el = label(`queue-${q.seat}`, 'draft-queue', `text-align:center;color:${theme.tokens.colours.fg};`);
      el.dataset.seat = q.seat;
      el.dataset.count = String(q.count);
      el.textContent = '';
      const dot = document.createElement('span');
      dot.style.cssText = `display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:4px;background:${q.colour};`;
      const name = document.createElement('span');
      name.textContent = q.name;
      const num = document.createElement('strong');
      num.dataset.testid = 'draft-queue-count';
      num.style.marginLeft = '6px';
      num.textContent = String(q.count);
      el.append(dot, name, num);
      el.title = `${q.name}: ${q.count} ${q.count === 1 ? 'pack' : 'packs'} waiting`;
      at(el, { x: q.pose.x, y: q.pose.y - (CARD_H * L.queueScale) / 2 - 8 }, 'center', 'top');
      show(el);
    }
    // Foil badges (DESIGN "Pre-game", Pack generation: foils are marked with a badge; the face itself is untouched).
    for (const rc of rcards.values()) {
      if (!rc.ref.foil) continue;
      const el = label(`foil-${rc.id}`, 'draft-foil', `font-size:10px;font-weight:${theme.tokens.type.weightBold};padding:0 4px;border-radius:3px;background:${theme.tokens.colours.bg};color:${theme.tokens.colours.fg};border:1px solid ${theme.tokens.colours.border};`);
      el.dataset.card = rc.id;
      el.textContent = 'Foil';
      const p = rc.motion.pose;
      at(el, { x: p.x + CARD_W / 2 - 2, y: p.y + CARD_H / 2 + 2 }, 'right', 'bottom');
      show(el);
    }
    // Grid handles: a row button left of each row, a column button above each column.
    if (pack?.layout === 'grid') {
      for (const index of [0, 1, 2] as const) {
        const r = gridHandle('row', index);
        r.disabled = !gridLineOpen(pack.cards, 'row', index);
        r.style.opacity = r.disabled ? '0.4' : '1';
        at(r, { x: L.packX - 1.5 * L.gridStep - 4, y: rowY(index) }, 'right', 'middle');
        show(r);
        const c = gridHandle('col', index);
        c.disabled = !gridLineOpen(pack.cards, 'col', index);
        c.style.opacity = c.disabled ? '0.4' : '1';
        at(c, { x: L.packX + (index - 1) * L.gridStep, y: L.firstRowY + CARD_H / 2 + 4 }, 'center', 'bottom');
        show(c);
      }
    }
    for (const [key, el] of items) if (!seen.has(key)) el.style.display = 'none';
  }

  // --- Input ----------------------------------------------------------------------------------------------------
  const canvasRect = () => canvas.getBoundingClientRect();
  function screenToTable(x: number, y: number): TablePoint {
    const r = canvasRect();
    return rig.screenToTable(x - r.left, y - r.top);
  }
  function cardAt(x: number, y: number): RCard | null {
    const p = screenToTable(x, y);
    const order = [...poolOrder, ...packOrder];
    for (let i = order.length - 1; i >= 0; i--) {
      const rc = rcards.get(order[i]!);
      if (rc && pointInCard(p, rc.motion.pose)) return rc;
    }
    return null;
  }

  let press: { pointerId: number; button: number; x0: number; y0: number; last: { x: number; y: number }; panning: boolean } | null = null;
  function onPointerDown(e: PointerEvent): void {
    if (press) return;
    press = { pointerId: e.pointerId, button: e.button, x0: e.clientX, y0: e.clientY, last: { x: e.clientX, y: e.clientY }, panning: false };
    if (e.button === 1) e.preventDefault();
    canvas.setPointerCapture?.(e.pointerId);
  }
  function onPointerMove(e: PointerEvent): void {
    if (press && press.pointerId === e.pointerId) {
      if (!press.panning && Math.hypot(e.clientX - press.x0, e.clientY - press.y0) > DRAG_THRESHOLD_PX) press.panning = true;
      if (press.panning) {
        rig.panBy(e.clientX - press.last.x, e.clientY - press.last.y);
        dirty = true;
      }
      press.last = { x: e.clientX, y: e.clientY };
      return;
    }
    const hit = cardAt(e.clientX, e.clientY)?.id ?? null;
    if (hit !== hovered) {
      hovered = hit;
      canvas.style.cursor = hit && rcards.get(hit)?.area === 'pack' ? 'pointer' : '';
      dirty = true;
    }
  }
  function onPointerUp(e: PointerEvent): void {
    if (!press || press.pointerId !== e.pointerId) return;
    const p = press;
    press = null;
    if (p.panning) return;
    const rc = cardAt(e.clientX, e.clientY);
    if (!rc) return;
    if (p.button === 1) {
      opts.events.inspect?.(rc.ref);
      return;
    }
    if (p.button !== 0 || rc.area !== 'pack' || !view?.pack) return;
    // Grid cells are taken by line (the handles), not by card.
    if (view.pack.layout === 'grid') return;
    const available = view.pack.cards.filter((c) => c).length;
    const r = clickPick(view.marked, view.picks, available, rc.id);
    if (r.kind === 'confirm') opts.events.confirm?.(r.cards);
    else opts.events.mark?.(r.cards);
  }
  function onPointerCancel(e: PointerEvent): void {
    if (press?.pointerId === e.pointerId) press = null;
  }
  function onPointerLeave(): void {
    if (hovered) {
      hovered = null;
      dirty = true;
    }
  }
  function onWheel(e: WheelEvent): void {
    e.preventDefault();
    const r = canvasRect();
    const factor = Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0015));
    rig.zoomAt(e.clientX - r.left, e.clientY - r.top, factor);
    dirty = true;
  }
  const typing = (t: EventTarget | null): boolean => t instanceof HTMLElement && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName));
  function onKey(e: KeyboardEvent): void {
    // Hold Space to inspect the hovered card (DESIGN "Input and interaction design"); keys never fire in a text field.
    if (e.code !== 'Space' || e.repeat || typing(e.target) || !hovered) return;
    const rc = rcards.get(hovered);
    if (!rc) return;
    e.preventDefault();
    opts.events.inspect?.(rc.ref);
  }
  const onContextMenu = (e: Event) => e.preventDefault();
  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointercancel', onPointerCancel);
  canvas.addEventListener('pointerleave', onPointerLeave);
  canvas.addEventListener('wheel', onWheel, { passive: false });
  canvas.addEventListener('contextmenu', onContextMenu);
  addEventListener('keydown', onKey);
  const resizeObserver = new ResizeObserver(() => resize());
  resizeObserver.observe(host);
  resize();

  // --- Debug ----------------------------------------------------------------------------------------------------
  function rectOf(corners: TablePoint[]): DOMRect {
    const r = canvasRect();
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const c of corners) {
      const s = rig.tableToScreen(c);
      minX = Math.min(minX, r.left + s.x);
      maxX = Math.max(maxX, r.left + s.x);
      minY = Math.min(minY, r.top + s.y);
      maxY = Math.max(maxY, r.top + s.y);
    }
    return new DOMRect(minX, minY, maxX - minX, maxY - minY);
  }
  const debug: DraftSurfaceDebug = {
    cards() {
      const r = canvasRect();
      const marked = new Set(view?.marked ?? []);
      return [...packOrder, ...poolOrder]
        .map((id) => rcards.get(id))
        .filter((rc): rc is RCard => !!rc)
        .map((rc) => {
          const screen = rectOf(cardCorners(rc.motion.pose));
          return {
            id: rc.id,
            pose: rc.motion.pose,
            screen,
            visible: screen.right > r.left && screen.left < r.right && screen.bottom > r.top && screen.top < r.bottom,
            area: rc.area,
            ref: rc.ref,
            marked: rc.area === 'pack' && marked.has(rc.id),
            hovered: hovered === rc.id,
            foil: !!rc.ref.foil,
            column: rc.column,
            moving: rc.motion.moving,
          };
        });
    },
    queues() {
      return queues.map((q) => {
        const w = CARD_W * DRAFT_LAYOUT.queueScale;
        const h = CARD_H * DRAFT_LAYOUT.queueScale;
        return { seat: q.seat, count: q.count, drawn: Math.min(q.count, DRAFT_LAYOUT.queueMax), screen: rectOf(cardCorners(q.pose, w, h)) };
      });
    },
    idle: () => !rig.moving && ![...rcards.values()].some((rc) => rc.motion.moving),
    pendingTextures: () => faces.pending,
    pack: () => (view?.pack ? { packId: view.pack.packId, layout: view.pack.layout, shared: view.pack.shared } : null),
  };

  // --- Camera controls ------------------------------------------------------------------------------------------
  const blend = (animate = true) => (animate && !reduced() ? theme.motion.cameraBlendMs : 0);
  const controls: CameraControls = {
    fit(animate = true) {
      rig.animateTo(rig.fitView(), performance.now(), blend(animate));
      dirty = true;
    },
    zoomAt(x, y, factor) {
      const r = canvasRect();
      rig.zoomAt(x - r.left, y - r.top, factor);
      dirty = true;
    },
    panBy(dx, dy) {
      rig.panBy(dx, dy);
      dirty = true;
    },
    goToSeat() {
      controls.fit();
    },
    zoomTo(target) {
      const rc = rcards.get(target);
      if (!rc) return;
      const p = rc.motion.pose;
      rig.animateTo({ cx: p.x, cy: p.y, dist: rig.minDist(), angle: rig.view.angle }, performance.now(), blend());
      dirty = true;
    },
    setRig() {
      // The draft table is seen from above only.
    },
    rig: () => 'birdseye',
  };

  raf = requestAnimationFrame(tick);

  return {
    update(nextState, nextView) {
      const prev = view;
      state = nextState;
      view = nextView;
      relayout(prev);
    },
    setTheme(next) {
      themeInstance.dispose();
      theme = next;
      themeInstance = theme.build({ renderer, scene, camera, table: geometry.table, quality: theme.quality[0]!, reducedMotion: reduced() });
      cards.setBackground(theme.tokens.colours.surface);
      outlineMaterial.color.set(theme.tokens.colours.border);
      overlay.style.fontFamily = theme.tokens.type.family;
      for (const el of items.values()) el.remove();
      items.clear();
      rig.inertiaMs = theme.motion.panInertiaMs;
      dirty = true;
    },
    camera: controls,
    debug,
    cardAt(x, y) {
      return cardAt(x, y)?.id ?? null;
    },
    toScreen(p) {
      const r = canvasRect();
      const s = toScreen(p);
      return { x: r.left + s.x, y: r.top + s.y };
    },
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
      canvas.removeEventListener('wheel', onWheel);
      canvas.removeEventListener('contextmenu', onContextMenu);
      removeEventListener('keydown', onKey);
      themeInstance.dispose();
      faces.dispose();
      cards.dispose();
      outlineGeometry.dispose();
      outlineMaterial.dispose();
      renderer.dispose();
      // Free the WebGL context now, not at GC: browsers cap live contexts.
      renderer.forceContextLoss();
      canvas.remove();
      overlay.remove();
    },
  };
}

/** Create the draft surface (scene/types.ts DraftSurface). */
export const createDraftSurface: CreateDraftSurface = (host, opts) => createDraftSurfaceImpl(host, opts);
