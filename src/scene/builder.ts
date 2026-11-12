/**
 * The builder table: the pool on a private table with play gestures, solitaire columns by colour, mana value or type,
 * deck and sideboard areas, basic-land dispenser (DESIGN "Pre-game: draft, sealed and deck building", Deck building).
 * Contracts: M2-C; implementer: M2-P5.
 *
 * A view of the shared DeckBuild the HUD hands it (BuilderSurfaceView): it never touches the network or the secret
 * store and reports every change as a whole new DeckBuild through `events.change`. The table is split in two marked
 * areas: the deck above, the sideboard below. Where a card lies decides where it belongs: dropping it in the deck area
 * puts it in the deck (`main`), in the sideboard area takes it out; a dispensed basic dropped in the sideboard goes back
 * to the dispenser. Gestures are the play table's (DESIGN "Card manipulation"): free drag with magnetic snapping
 * (squared piles, cascades, edge alignment; Ctrl disables it), piles move as one when dragged by their base card,
 * Shift+click and Shift+drag on empty table select, a drag on empty table pans, the wheel zooms, hold Space or
 * middle-click to inspect. A double-click sends a card (or the selection) to the other area.
 *
 * Layout (table mm, viewer at the bottom; BUILDER_LAYOUT): deck area at the top, sideboard area below, columns 69 apart
 * (card plus the standard gap) from the left edge, cascade offset 14, compressed when a column runs long.
 *
 * Pure layout functions come first (unit-tested in tests/unit/builder/), the Three.js surface after them.
 */
import * as THREE from 'three';
import { CAMERA, GEOMETRY } from '../core/geometry';
import type { CardRef, DeckBuild, PileRef, PoolCard, Pose } from '../core/types';
import type { CardData } from '../data/types';
import { mtg } from '../games/index';
import type { Theme, ThemeInstance } from '../themes/types';
import { BirdseyeRig, NO_INSETS, type Insets } from './camera';
import { CardLayer, type CardDraw } from './cards';
import { FaceTextures, faceKey } from './faces';
import { CARD_H, CARD_W, cardCorners, forward, pointInCard, rot2 } from './math';
import { CardMotion } from './motion';
import { resolveDrop, type SnapCard } from './snap';
import { tierForScreenHeight } from './textures';
import type { BuilderSort, BuilderSurface, BuilderSurfaceEvents, BuilderSurfaceOptions, BuilderSurfaceView, CameraControls, CreateBuilderSurface, DebugCard, ScreenPoint, TablePoint } from './types';

// ---------------------------------------------------------------------------------------------------------------------
// Layout constants
// ---------------------------------------------------------------------------------------------------------------------

/** A rectangle by its lower left corner, table mm. */
export interface AreaRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Builder table layout, mm (DESIGN "Specification: geometry, layout and motion": card 63 × 88, gap 6, cascade 14). */
export const BUILDER_LAYOUT = {
  table: { w: 760, d: 800 },
  /** The deck area (upper half) and the sideboard area (lower half); y = 0 divides them. */
  deck: { x: -370, y: 20, w: 740, h: 360 } as AreaRect,
  side: { x: -370, y: -380, w: 740, h: 360 } as AreaRect,
  /** Space between an area's left or bottom edge and its cards. */
  margin: 10,
  /** Space above the first card of a column for the area and column labels. */
  labelBand: 24,
  /** Column step: card width plus the standard gap. */
  colStep: GEOMETRY.card.w + GEOMETRY.gap,
  cascade: GEOMETRY.cascadeOffset,
} as const;

/** The two marked areas of the builder table (DESIGN "Pre-game", Deck building: "A deck area and a sideboard area"). */
export type BuilderArea = 'deck' | 'side';

/** The area a table point lies in: the upper half is the deck, the lower half the sideboard. */
export function areaOf(p: { y: number }): BuilderArea {
  return p.y >= 0 ? 'deck' : 'side';
}

export function areaRect(area: BuilderArea): AreaRect {
  return area === 'deck' ? BUILDER_LAYOUT.deck : BUILDER_LAYOUT.side;
}

// ---------------------------------------------------------------------------------------------------------------------
// Card facts and sort columns (the same groups as the list view, ui/builder/list/model.ts groupOf)
// ---------------------------------------------------------------------------------------------------------------------

const WUBRG = ['W', 'U', 'B', 'R', 'G'] as const;

function colours(card: CardData): string[] {
  const raw = card.colors ?? (card.card_faces ?? []).flatMap((f) => f.colors ?? []);
  return WUBRG.filter((c) => raw.includes(c));
}
function frontType(card: CardData): string {
  return (card.card_faces?.[0]?.type_line ?? card.type_line ?? '').split(' // ')[0]!;
}
function isLand(card: CardData): boolean {
  return /\bLand\b/.test(frontType(card));
}

/** One solitaire column of a sort: its key, label and place from the left. */
export interface BuilderColumn {
  key: string;
  label: string;
  index: number;
}

const COLOUR_COLUMNS: readonly [string, string][] = [
  ['W', 'White'],
  ['U', 'Blue'],
  ['B', 'Black'],
  ['R', 'Red'],
  ['G', 'Green'],
  ['M', 'Multicoloured'],
  ['C', 'Colourless'],
  ['L', 'Lands'],
];
/** Highest mana value with its own column; the next column holds this and above. */
export const MV_COLUMN_MAX = 7;
const MV_COLUMNS: readonly [string, string][] = [...Array.from({ length: MV_COLUMN_MAX + 1 }, (_, i): [string, string] => [`mv${i}`, i === MV_COLUMN_MAX ? `${i}+` : `${i}`]), ['land', 'Lands']];
const TYPE_ORDER: readonly [string, string, RegExp | null][] = [
  ['creature', 'Creatures', /\bCreature\b/],
  ['planeswalker', 'Planeswalkers', /\bPlaneswalker\b/],
  ['battle', 'Battles', /\bBattle\b/],
  ['instant', 'Instants', /\bInstant\b/],
  ['sorcery', 'Sorceries', /\bSorcery\b/],
  ['artifact', 'Artifacts', /\bArtifact\b/],
  ['enchantment', 'Enchantments', /\bEnchantment\b/],
  ['land', 'Lands', /\bLand\b/],
  ['other', 'Other', null],
];
/** Which type a card of several types counts as (creature first, then land, then the rest in column order), as the list view does. */
const TYPE_PRECEDENCE = ['creature', 'land', 'planeswalker', 'battle', 'instant', 'sorcery', 'artifact', 'enchantment'];

/** The columns of a sort, left to right, without the loading column. */
export function columnsFor(key: BuilderSort): BuilderColumn[] {
  const list = key === 'colour' ? COLOUR_COLUMNS : key === 'manaValue' ? MV_COLUMNS : TYPE_ORDER.map(([k, l]): [string, string] => [k, l]);
  return list.map(([k, label], index) => ({ key: k, label, index }));
}

/** The column of cards whose data is still loading: right of the sort's last column. */
export function loadingColumn(key: BuilderSort): BuilderColumn {
  return { key: 'loading', label: 'Loading', index: columnsFor(key).length };
}

/** The column a card sorts into (DESIGN "Pre-game", Deck building: "solitaire columns by colour, mana value or type"). */
export function columnOf(card: CardData | null, key: BuilderSort): BuilderColumn {
  if (!card) return loadingColumn(key);
  const cols = columnsFor(key);
  const by = (k: string) => cols.find((c) => c.key === k)!;
  if (key === 'type') {
    const t = frontType(card);
    const kind = TYPE_PRECEDENCE.find((k) => TYPE_ORDER.find(([n]) => n === k)![2]!.test(t)) ?? 'other';
    return by(kind);
  }
  if (isLand(card)) return by(key === 'colour' ? 'L' : 'land');
  if (key === 'colour') {
    const cs = colours(card);
    return by(cs.length > 1 ? 'M' : cs.length === 0 ? 'C' : cs[0]!);
  }
  const mv = Math.max(0, Math.min(MV_COLUMN_MAX, Math.floor(card.cmc)));
  return by(`mv${mv}`);
}

/** Order inside a column: mana value (lands first), then name, then printing, non-foil first, then pool order. */
function compareInColumn(a: { data: CardData | null; pc: PoolCard; index: number }, b: { data: CardData | null; pc: PoolCard; index: number }): number {
  const mv = (x: { data: CardData | null }) => (x.data ? (isLand(x.data) ? -1 : x.data.cmc) : 0);
  const name = (x: { data: CardData | null }) => x.data?.name ?? '';
  return (
    mv(a) - mv(b) ||
    name(a).localeCompare(name(b), 'en') ||
    (a.pc.ref.sid < b.pc.ref.sid ? -1 : a.pc.ref.sid > b.pc.ref.sid ? 1 : 0) ||
    Number(!!a.pc.ref.foil) - Number(!!b.pc.ref.foil) ||
    a.index - b.index
  );
}

// ---------------------------------------------------------------------------------------------------------------------
// Column geometry
// ---------------------------------------------------------------------------------------------------------------------

/** Centre x of column `i`. */
export function columnX(i: number): number {
  const L = BUILDER_LAYOUT;
  return L.deck.x + L.margin + CARD_W / 2 + i * L.colStep;
}
/** Centre y of a column's first card in an area. */
export function columnTopY(area: BuilderArea): number {
  const r = areaRect(area);
  return r.y + r.h - BUILDER_LAYOUT.labelBand - CARD_H / 2;
}
/** Lowest centre y a column's card may take in an area. */
export function columnBottomY(area: BuilderArea): number {
  return areaRect(area).y + BUILDER_LAYOUT.margin + CARD_H / 2;
}
/** Cascade step for a column of `n` cards: 14, compressed so the column stays inside its area. */
export function cascadeStep(n: number, area: BuilderArea): number {
  if (n <= 1) return BUILDER_LAYOUT.cascade;
  return Math.min(BUILDER_LAYOUT.cascade, (columnTopY(area) - columnBottomY(area)) / (n - 1));
}

export type CardLookup = (ref: CardRef) => CardData | null;
export type Poses = Record<string, Pose>;

const validPose = (p: Pose | undefined): p is Pose => !!p && Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.rot);

/** Pool cards in the deck and in the sideboard (deck ids the pool lacks are ignored). */
export function membership(build: DeckBuild): { deck: PoolCard[]; side: PoolCard[] } {
  const byId = new Map(build.cards.map((c) => [c.id, c] as const));
  const inMain = new Set<string>();
  const deck: PoolCard[] = [];
  for (const id of build.main) {
    const c = byId.get(id);
    if (!c || inMain.has(id)) continue;
    inMain.add(id);
    deck.push(c);
  }
  return { deck, side: build.cards.filter((c) => !inMain.has(c.id)) };
}

/**
 * Sort the whole pool into cascade columns by `key` (DESIGN "Pre-game", Deck building: "One key sorts into solitaire
 * columns by colour, mana value or type"): deck cards in the deck area, the rest in the sideboard area, each column in
 * a fixed place. The result depends only on the build's cards, deck membership and card data, never on where the cards
 * lay before; cards that compare equal keep pool order (stable).
 */
export function sortLayout(build: DeckBuild, card: CardLookup, key: BuilderSort): Poses {
  const out: Poses = {};
  const index = new Map(build.cards.map((c, i) => [c.id, i] as const));
  const m = membership(build);
  for (const area of ['deck', 'side'] as const) {
    const cols = new Map<number, { data: CardData | null; pc: PoolCard; index: number }[]>();
    for (const pc of m[area]) {
      const data = card(pc.ref);
      const col = columnOf(data, key).index;
      const list = cols.get(col) ?? [];
      list.push({ data, pc, index: index.get(pc.id)! });
      cols.set(col, list);
    }
    for (const [col, list] of cols) {
      list.sort(compareInColumn);
      const step = cascadeStep(list.length, area);
      const top = columnTopY(area);
      list.forEach((e, row) => (out[e.pc.id] = { x: columnX(col), y: top - row * step, rot: 0 }));
    }
  }
  return out;
}

/** Where a card joins the bottom of its column in an area, given the poses already taken. */
export function columnSlot(poses: Poses, area: BuilderArea, column: number): Pose {
  const x = columnX(column);
  let lowest: number | null = null;
  for (const p of Object.values(poses)) {
    if (areaOf(p) !== area || Math.abs(p.x - x) >= CARD_W / 2) continue;
    if (lowest === null || p.y < lowest) lowest = p.y;
  }
  const y = lowest === null ? columnTopY(area) : Math.max(columnBottomY(area), lowest - BUILDER_LAYOUT.cascade);
  return { x, y, rot: 0 };
}

/**
 * The poses the table shows for a build: stored poses where they lie in the card's area (deck or sideboard), and for
 * every other card (new, or moved between deck and sideboard in the list view) a place at the bottom of its column
 * under `key` in the right area, deck cards in deck order first. A build without any stored pose is laid out sorted.
 */
export function reconcile(build: DeckBuild, card: CardLookup, key: BuilderSort): Poses {
  const stored = build.poses ?? {};
  if (!build.cards.some((c) => validPose(stored[c.id]))) return sortLayout(build, card, key);
  const m = membership(build);
  const out: Poses = {};
  const missing: { pc: PoolCard; area: BuilderArea }[] = [];
  for (const area of ['deck', 'side'] as const) {
    for (const pc of m[area]) {
      const p = stored[pc.id];
      if (validPose(p) && areaOf(p) === area) out[pc.id] = { x: p.x, y: p.y, rot: p.rot };
      else missing.push({ pc, area });
    }
  }
  for (const { pc, area } of missing) out[pc.id] = columnSlot(out, area, columnOf(card(pc.ref), key).index);
  return out;
}

function copyBuild(build: DeckBuild): DeckBuild {
  const out: DeckBuild = { cards: build.cards.map((c) => ({ ...c, ref: { ...c.ref } })), main: [...build.main] };
  if (build.poses) out.poses = Object.fromEntries(Object.entries(build.poses).map(([k, p]) => [k, { ...p }]));
  return out;
}

/** Poses limited to the build's cards, copied. */
function posesFor(build: DeckBuild, poses: Poses): Poses {
  const out: Poses = {};
  for (const c of build.cards) {
    const p = poses[c.id];
    if (validPose(p)) out[c.id] = { x: p.x, y: p.y, rot: p.rot };
  }
  return out;
}

/**
 * Cards dropped at new poses (DESIGN "Pre-game", Deck building: deck and sideboard areas). `shown` is every card's
 * current pose, `moved` the dropped cards' new poses in drop order. A card dropped in the deck area joins the deck (at
 * its end), one dropped in the sideboard area leaves it; a dispensed basic (`basic: true`) dropped in the sideboard area
 * goes back to the unlimited dispenser and leaves the build. The result carries every card's pose.
 */
export function applyDrop(build: DeckBuild, shown: Poses, moved: Poses): DeckBuild {
  const out = copyBuild(build);
  const poses: Poses = { ...shown, ...moved };
  const inMain = new Set(out.main);
  const returned = new Set<string>();
  const basic = new Set(out.cards.filter((c) => c.basic).map((c) => c.id));
  for (const [id, p] of Object.entries(moved)) {
    if (!out.cards.some((c) => c.id === id)) continue;
    if (areaOf(p) === 'deck') {
      if (!inMain.has(id)) {
        out.main.push(id);
        inMain.add(id);
      }
    } else {
      if (inMain.has(id)) {
        out.main = out.main.filter((m) => m !== id);
        inMain.delete(id);
      }
      if (basic.has(id)) returned.add(id);
    }
  }
  if (returned.size) out.cards = out.cards.filter((c) => !returned.has(c.id));
  out.poses = posesFor(out, poses);
  return out;
}

/** Id of a basic from the table's dispenser: `table-basic-<n>` with the smallest unused n. */
export function dispensedId(build: DeckBuild): string {
  const used = new Set(build.cards.map((c) => c.id));
  let n = 1;
  while (used.has(`table-basic-${n}`)) n++;
  return `table-basic-${n}`;
}

/**
 * The basic-land dispenser (DESIGN "Pre-game", Deck building: "hands out unlimited basics of any chosen printing"): one
 * more basic of `ref` in the deck, at the bottom of its column (lands) in the deck area under `key`.
 */
export function dispense(build: DeckBuild, shown: Poses, ref: CardRef, card: CardLookup, key: BuilderSort): DeckBuild {
  const out = copyBuild(build);
  const id = dispensedId(out);
  out.cards.push({ id, ref: ref.foil ? { sid: ref.sid, foil: true } : { sid: ref.sid }, basic: true });
  out.main.push(id);
  const poses = posesFor(build, shown);
  poses[id] = columnSlot(poses, 'deck', columnOf(card(ref), key).index);
  out.poses = posesFor(out, poses);
  return out;
}

/**
 * Send cards to the other area (double-click): each card goes to the bottom of its column under `key` in the area it
 * is not in, in the given order. Returns the drop as `applyDrop` takes it.
 */
export function crossOver(build: DeckBuild, shown: Poses, ids: readonly string[], card: CardLookup, key: BuilderSort): Poses {
  const poses: Poses = { ...shown };
  const moved: Poses = {};
  const byId = new Map(build.cards.map((c) => [c.id, c] as const));
  const inMain = new Set(build.main);
  for (const id of ids) {
    const pc = byId.get(id);
    if (!pc) continue;
    const to: BuilderArea = inMain.has(id) ? 'side' : 'deck';
    delete poses[id];
    const p = columnSlot(poses, to, columnOf(card(pc.ref), key).index);
    poses[id] = p;
    moved[id] = p;
  }
  return moved;
}

/** What `sortToggle` remembers between sorts: the layout before the last sort and the layout it made. */
export interface SortMemo {
  key: BuilderSort;
  before: Poses;
  after: Poses;
}

function samePoses(a: Poses, b: Poses): boolean {
  const ka = Object.keys(a);
  if (ka.length !== Object.keys(b).length) return false;
  return ka.every((k) => {
    const p = a[k]!;
    const q = b[k];
    return !!q && Math.abs(p.x - q.x) < 1e-6 && Math.abs(p.y - q.y) < 1e-6 && Math.abs(p.rot - q.rot) < 1e-6;
  });
}

/**
 * A sort key pressed (PLAN M2-P5: "sorting is stable and reversible"). Pressing the key of the last sort again, while
 * nothing moved since, restores the layout from before that sort exactly; any other press sorts and remembers the
 * layout it replaced. `shown` is the current layout.
 */
export function sortToggle(build: DeckBuild, shown: Poses, card: CardLookup, key: BuilderSort, memo: SortMemo | null): { poses: Poses; memo: SortMemo | null; restored: boolean } {
  const current = posesFor(build, shown);
  if (memo && memo.key === key && samePoses(current, memo.after)) {
    const before = posesFor(build, memo.before);
    return { poses: { ...current, ...before }, memo: null, restored: true };
  }
  const after = sortLayout(build, card, key);
  return { poses: after, memo: { key, before: current, after }, restored: false };
}

/**
 * Piles as the play table knows them, read from positions (the DeckBuild stores poses only): cards on one spot form a
 * squared pile (index by draw order), cards straight below each other at most one cascade offset apart form a cascade
 * (index 0 the base at the top). `order` is the draw order, bottom first.
 */
export function derivePiles(poses: Poses, order: readonly string[]): Map<string, PileRef> {
  const out = new Map<string, PileRef>();
  const ids = order.filter((id) => poses[id]);
  const squaredOf = new Map<string, string[]>();
  const spot = (p: Pose) => `${Math.round(p.x * 2)}:${Math.round(p.y * 2)}`;
  for (const id of ids) {
    const k = spot(poses[id]!);
    squaredOf.set(k, [...(squaredOf.get(k) ?? []), id]);
  }
  const inSquared = new Set<string>();
  for (const list of squaredOf.values()) {
    if (list.length < 2) continue;
    list.forEach((id, index) => {
      out.set(id, { id: `sq:${list[0]}`, index, kind: 'squared' });
      inSquared.add(id);
    });
  }
  const loose = ids.filter((id) => !inSquared.has(id)).sort((a, b) => poses[a]!.x - poses[b]!.x || poses[b]!.y - poses[a]!.y);
  let chain: string[] = [];
  const flush = () => {
    if (chain.length >= 2) chain.forEach((id, index) => out.set(id, { id: `cas:${chain[0]}`, index, kind: 'cascade' }));
    chain = [];
  };
  for (const id of loose) {
    const prev = chain[chain.length - 1];
    if (prev !== undefined) {
      const a = poses[prev]!;
      const b = poses[id]!;
      const dy = a.y - b.y;
      if (Math.abs(a.x - b.x) < 0.5 && dy > 0.5 && dy <= BUILDER_LAYOUT.cascade + 0.5 && Math.abs(a.rot - b.rot) < 1e-6) {
        chain.push(id);
        continue;
      }
      flush();
    }
    chain.push(id);
  }
  flush();
  return out;
}

/** The cards a press on `id` picks up: a cascade's base takes the whole cascade, a selected card the selection, else the card. */
export function grabbed(id: string, piles: Map<string, PileRef>, selection: ReadonlySet<string>, single: boolean): string[] {
  if (single) return [id];
  if (selection.has(id) && selection.size > 1) return [...selection];
  const pile = piles.get(id);
  if (pile?.kind === 'cascade' && pile.index === 0) {
    return [...piles.entries()]
      .filter(([, p]) => p.id === pile.id)
      .sort((a, b) => a[1].index - b[1].index)
      .map(([cid]) => cid);
  }
  return [id];
}

/** Draw order for a layout: top of the table first, so lower cards of a cascade lie over the ones above (titles stay readable). */
export function drawOrder(poses: Poses, ids: readonly string[]): string[] {
  const index = new Map(ids.map((id, i) => [id, i] as const));
  return ids.filter((id) => poses[id]).sort((a, b) => poses[b]!.y - poses[a]!.y || index.get(a)! - index.get(b)!);
}

// ---------------------------------------------------------------------------------------------------------------------
// The surface
// ---------------------------------------------------------------------------------------------------------------------

/** BuilderSurfaceView plus the Ready lock (DESIGN "Pre-game", Deck building: "Ready locks the deck"). */
export interface BuilderSurfaceViewExt extends BuilderSurfaceView {
  /** The deck is committed: gestures that change the build are off (camera and inspect stay). */
  locked?: boolean;
}

/** Events beyond the M2-C contract the builder HUD listens to. */
export interface BuilderSurfaceEventsExt extends BuilderSurfaceEvents {
  /** The sort state changed: the key of the sort now showing, or null after a restore or a move. */
  sorted(key: BuilderSort | null): void;
  /** The selection changed (number of selected cards). */
  selection(count: number): void;
}

export interface BuilderSurfaceOptionsExt extends BuilderSurfaceOptions {
  events: Partial<BuilderSurfaceEventsExt>;
  /** Reduced motion before the first view arrives. */
  reducedMotion?: boolean;
}

/** A builder card as the surface's debug reports it. */
export interface BuilderDebugCard extends DebugCard {
  ref: CardRef;
  area: BuilderArea;
  inMain: boolean;
  basic: boolean;
  selected: boolean;
  hovered: boolean;
  moving: boolean;
  /** Draw order, 0 at the bottom. */
  order: number;
}

export interface BuilderSurfaceDebug {
  cards(): BuilderDebugCard[];
  idle(): boolean;
  pendingTextures(): number;
  /** The sort showing (null when none or after a restore or a move) and the column key used for placing new cards. */
  sort(): { showing: BuilderSort | null; key: BuilderSort };
  selection(): string[];
  view(): { cx: number; cy: number; dist: number };
  locked(): boolean;
}

/** A BuilderSurface with debug extras (assignable to BuilderSurface). */
export type BuilderSurfaceHandle = Omit<BuilderSurface, 'debug' | 'update'> & {
  readonly debug: BuilderSurfaceDebug;
  update(view: BuilderSurfaceViewExt): void;
  /** Viewport point of a table point. */
  toScreen(p: TablePoint): ScreenPoint;
  /** Table point under a viewport point. */
  screenToTable(x: number, y: number): TablePoint;
  /** Send cards to the other area (double-click's action, also for the HUD's keys). */
  crossOver(ids: readonly string[]): void;
  /** Clear the selection. */
  clearSelection(): void;
};

interface RCard {
  id: string;
  pc: PoolCard;
  key: string;
  motion: CardMotion;
}

const DRAG_THRESHOLD_PX = 4;
const LONG_PRESS_MS = 500;
/** Longest gap between the clicks of a double-click the surface allows for (browsers use about 500 ms). */
const DOUBLE_CLICK_MS = 600;
const SMALL_CAPS = 'font-variant: all-small-caps; letter-spacing: 0.08em;';

export function createBuilderSurfaceImpl(host: HTMLElement, opts: BuilderSurfaceOptionsExt): BuilderSurfaceHandle {
  let theme: Theme = opts.theme;
  const card: CardLookup = (ref) => opts.card(ref);
  const L = BUILDER_LAYOUT;
  let build: DeckBuild = { cards: [], main: [] };
  let locked = false;
  let reducedView: boolean | null = null;
  const reduced = () => reducedView ?? opts.reducedMotion ?? false;

  // --- Three.js -------------------------------------------------------------------------------------------------
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: false });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, theme.quality[0]?.pixelRatio ?? 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const canvas = renderer.domElement;
  canvas.style.display = 'block';
  canvas.style.width = '100%';
  canvas.style.height = '100%';
  canvas.style.touchAction = 'none';
  canvas.setAttribute('data-scene', 'builder');
  if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
  host.appendChild(canvas);

  const overlay = document.createElement('div');
  overlay.setAttribute('data-scene', 'builder-overlay');
  Object.assign(overlay.style, { position: 'absolute', inset: '0', pointerEvents: 'none', overflow: 'hidden', fontFamily: theme.tokens.type.family });
  host.appendChild(overlay);
  const marqueeEl = document.createElement('div');
  Object.assign(marqueeEl.style, { position: 'absolute', display: 'none', pointerEvents: 'none', border: `1px dashed ${theme.tokens.colours.focus}`, background: 'rgba(31,111,209,0.06)' });
  marqueeEl.dataset.testid = 'builder-marquee';
  host.appendChild(marqueeEl);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(CAMERA.birdseye.fovDeg, 1, 10, 100000);
  const viewport = () => ({ w: Math.max(1, host.clientWidth || innerWidth), h: Math.max(1, host.clientHeight || innerHeight) });
  const rig = new BirdseyeRig(L.table, viewport(), 0, theme.motion.panInertiaMs);
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

  let builtReduced = reduced();
  let themeInstance: ThemeInstance = theme.build({ renderer, scene, camera, table: L.table, quality: theme.quality[0]!, reducedMotion: builtReduced });
  const backOf = (t: Theme) => t.cardDressing.back ?? mtg.cardBack;
  let back = backOf(theme);
  let faces = new FaceTextures(renderer, opts.faces, back);
  faces.onChange = () => (dirty = true);
  const cards = new CardLayer(scene, theme.tokens.colours.surface);
  scene.add(cards.mesh);

  // Hairline outlines of the two areas.
  const outlineMaterial = new THREE.LineBasicMaterial({ color: theme.tokens.colours.border, depthTest: false, depthWrite: false, transparent: true });
  const outlineGeometry = new THREE.BufferGeometry();
  {
    const segs: number[] = [];
    for (const r of [L.deck, L.side]) {
      const [x0, y0, x1, y1] = [r.x, r.y, r.x + r.w, r.y + r.h];
      for (const [a, b, c, d] of [
        [x0, y0, x1, y0],
        [x1, y0, x1, y1],
        [x1, y1, x0, y1],
        [x0, y1, x0, y0],
      ] as const)
        segs.push(a, 0.05, -b, c, 0.05, -d);
    }
    outlineGeometry.setAttribute('position', new THREE.Float32BufferAttribute(segs, 3));
    outlineGeometry.computeBoundingSphere();
  }
  const outlines = new THREE.LineSegments(outlineGeometry, outlineMaterial);
  outlines.renderOrder = 1;
  outlines.frustumCulled = false;
  scene.add(outlines);

  // --- Surface state --------------------------------------------------------------------------------------------
  const rcards = new Map<string, RCard>();
  /** Draw order, bottom first; a moved card goes on top (DESIGN: "A newly moved card takes the highest draw order"). */
  let order: string[] = [];
  /** The poses shown (targets of the motions), by pool card id. */
  let shown: Poses = {};
  let memo: SortMemo | null = null;
  /** Column key for placing new cards: the last sort pressed, colour at first. */
  let lastKey: BuilderSort = 'colour';
  let selection = new Set<string>();
  let hovered: string | null = null;
  let dirty = true;
  let frame = 0;
  let raf = 0;
  let disposed = false;
  let lastTick = performance.now();
  let drag: { ids: string[]; anchor: string; start: Poses; grabOffset: TablePoint; cur: TablePoint; ctrl: boolean } | null = null;

  function rebuildTheme(): void {
    themeInstance.dispose();
    builtReduced = reduced();
    themeInstance = theme.build({ renderer, scene, camera, table: L.table, quality: theme.quality[0]!, reducedMotion: builtReduced });
    dirty = true;
  }

  function emitSorted(): void {
    opts.events.sorted?.(memo ? memo.key : null);
  }
  function emitSelection(): void {
    opts.events.selection?.(selection.size);
  }

  /** Show a layout: cards animate to their poses (a sort settles with a 20 ms stagger per card). */
  function show(next: Poses, kind: 'spring' | 'settle' | 'cut', reorder: boolean): void {
    const now = performance.now();
    const live = new Set(build.cards.map((c) => c.id));
    for (const id of [...rcards.keys()]) if (!live.has(id)) rcards.delete(id);
    let stagger = 0;
    const sequence = kind === 'settle' ? drawOrder(next, build.cards.map((c) => c.id)) : build.cards.map((c) => c.id);
    for (const id of sequence) {
      const pc = build.cards.find((c) => c.id === id)!;
      const pose = next[id];
      if (!pose) continue;
      const key = faceKey(pc.ref, 0);
      faces.register(pc.ref, 0);
      let rc = rcards.get(id);
      if (!rc) {
        rc = { id, pc, key, motion: new CardMotion(pose) };
        rcards.set(id, rc);
        continue;
      }
      rc.pc = pc;
      rc.key = key;
      const t = rc.motion.target;
      if (Math.abs(t.x - pose.x) > 1e-6 || Math.abs(t.y - pose.y) > 1e-6 || Math.abs(t.rot - pose.rot) > 1e-6) {
        if (kind === 'cut') rc.motion.cut(pose);
        else rc.motion.moveTo(pose, kind, now, theme.motion, reduced(), kind === 'settle' ? stagger++ * theme.motion.settleStaggerMs : 0);
      }
    }
    shown = posesFor(build, next);
    const ids = build.cards.map((c) => c.id);
    if (reorder) order = drawOrder(shown, ids);
    else {
      const kept = order.filter((id) => live.has(id) && shown[id]);
      const added = drawOrder(shown, ids).filter((id) => !kept.includes(id));
      order = [...kept, ...added];
    }
    const before = selection.size;
    selection = new Set([...selection].filter((id) => live.has(id)));
    if (hovered && !live.has(hovered)) hovered = null;
    if (selection.size !== before) emitSelection();
    dirty = true;
  }

  function change(next: DeckBuild): void {
    opts.events.change?.(next);
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

  function dragPose(id: string): Pose | null {
    if (!drag || !drag.ids.includes(id)) return null;
    const s = drag.start[id]!;
    const a = drag.start[drag.anchor]!;
    const ax = drag.cur.x - drag.grabOffset.x;
    const ay = drag.cur.y - drag.grabOffset.y;
    return { x: ax + (s.x - a.x), y: ay + (s.y - a.y), rot: s.rot };
  }

  function draw(): void {
    frame++;
    syncCamera();
    const want = tierForScreenHeight(CARD_H * rig.pxPerMm());
    const dressing = theme.cardDressing;
    const draws: CardDraw[] = [];
    const dragging = drag ? new Set(drag.ids) : new Set<string>();
    const sequence = [...order.filter((id) => !dragging.has(id)), ...order.filter((id) => dragging.has(id))];
    for (const id of sequence) {
      const rc = rcards.get(id);
      if (!rc) continue;
      const dp = dragPose(id);
      draws.push({
        pose: dp ?? rc.motion.pose,
        z: dp ? GEOMETRY.dragLift : 0,
        scaleX: 1,
        uv: faces.use(rc.key, want, frame),
        dim: 0,
        highlight: selection.has(id)
          ? { colour: dressing.selected.colour, width: dressing.selected.width }
          : hovered === id
            ? { colour: dressing.hover.colour, width: dressing.hover.width }
            : null,
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

  // --- DOM overlay: area and column labels, foil badges, selection count ------------------------------------------
  const items = new Map<string, HTMLElement>();
  function label(key: string, testid: string, css: string): HTMLElement {
    let el = items.get(key);
    if (!el) {
      el = document.createElement('div');
      el.dataset.key = key;
      el.dataset.testid = testid;
      el.style.cssText = `position:absolute;white-space:nowrap;color:${theme.tokens.colours.muted};font-size:${theme.tokens.type.small}px;${css}`;
      items.set(key, el);
      overlay.appendChild(el);
    }
    return el;
  }
  const toScreenLocal = (p: TablePoint): ScreenPoint => rig.tableToScreen(p);
  function at(el: HTMLElement, p: TablePoint, ax: 'left' | 'center' = 'center'): void {
    const s = toScreenLocal(p);
    el.style.left = `${s.x}px`;
    el.style.top = `${s.y}px`;
    el.style.transform = `translate(${ax === 'left' ? '0' : '-50%'}, -50%)`;
  }

  function syncOverlay(): void {
    const seen = new Set<string>();
    const showEl = (el: HTMLElement) => {
      seen.add(el.dataset.key!);
      el.style.display = '';
    };
    const m = membership(build);
    for (const area of ['deck', 'side'] as const) {
      const r = areaRect(area);
      const el = label(`area-${area}`, 'builder-area-label', `${SMALL_CAPS}color:${theme.tokens.colours.fg};`);
      const n = m[area].length;
      el.dataset.area = area;
      el.dataset.count = String(n);
      el.textContent = `${area === 'deck' ? 'Deck' : 'Sideboard'} · ${n}`;
      at(el, { x: r.x + 4, y: r.y + r.h - 8 }, 'left');
      showEl(el);
      // Column labels of the last sort key, with the cards lying in each column.
      const counts = new Map<number, number>();
      for (const pc of m[area]) {
        const p = shown[pc.id];
        if (!p) continue;
        const i = Math.round((p.x - columnX(0)) / L.colStep);
        if (i < 0 || Math.abs(p.x - columnX(i)) > 1) continue;
        counts.set(i, (counts.get(i) ?? 0) + 1);
      }
      const cols = [...columnsFor(lastKey), loadingColumn(lastKey)];
      for (const c of cols) {
        const count = counts.get(c.index) ?? 0;
        if (!count) continue;
        const cl = label(`col-${area}-${c.index}`, 'builder-column-label', SMALL_CAPS);
        cl.dataset.area = area;
        cl.dataset.column = c.key;
        cl.dataset.count = String(count);
        cl.textContent = `${c.label} ${count}`;
        at(cl, { x: columnX(c.index), y: r.y + r.h - 19 });
        showEl(cl);
      }
    }
    // Foil badges beside each foil card's top strip (DESIGN "Pre-game", Pack generation: foils carry a badge; faces untouched).
    const badgePx = Math.max(7, Math.min(14, (GEOMETRY.gap - 1) * rig.pxPerMm()));
    for (const rc of rcards.values()) {
      if (!rc.pc.ref.foil) continue;
      const el = label(`foil-${rc.id}`, 'builder-foil', `display:flex;align-items:center;justify-content:center;box-sizing:border-box;border-radius:50%;background:${theme.tokens.colours.bg};color:${theme.tokens.colours.fg};border:1px solid ${theme.tokens.colours.border};line-height:1;`);
      el.textContent = '✦';
      el.title = 'Foil';
      el.style.width = el.style.height = `${badgePx}px`;
      el.style.fontSize = `${Math.max(6, Math.round(badgePx * 0.7))}px`;
      const p = dragPose(rc.id) ?? rc.motion.pose;
      const [dx, dy] = rot2(-CARD_W / 2 - GEOMETRY.gap / 2, CARD_H / 2 - L.cascade / 2, p.rot);
      at(el, { x: p.x + dx, y: p.y + dy });
      showEl(el);
    }
    if (selection.size > 1) {
      const el = label('selection', 'builder-selection', `color:${theme.tokens.colours.fg};background:${theme.tokens.colours.bg};border:1px solid ${theme.tokens.colours.border};border-radius:999px;padding:1px 8px;`);
      el.textContent = `${selection.size} selected`;
      let top: Pose | null = null;
      for (const id of selection) {
        const p = rcards.get(id)?.motion.pose;
        if (p && (!top || p.y > top.y)) top = p;
      }
      if (top) {
        at(el, { x: top.x, y: top.y + CARD_H / 2 + 6 });
        showEl(el);
      }
    }
    for (const [key, el] of items) {
      if (seen.has(key)) continue;
      if (key.startsWith('foil-') || key.startsWith('col-')) {
        el.remove();
        items.delete(key);
      } else el.style.display = 'none';
    }
  }

  // --- Input ----------------------------------------------------------------------------------------------------
  const canvasRect = () => canvas.getBoundingClientRect();
  function screenToTable(x: number, y: number): TablePoint {
    const r = canvasRect();
    return rig.screenToTable(x - r.left, y - r.top);
  }
  function cardAt(x: number, y: number): RCard | null {
    const p = screenToTable(x, y);
    for (let i = order.length - 1; i >= 0; i--) {
      const rc = rcards.get(order[i]!);
      if (rc && pointInCard(p, rc.motion.pose)) return rc;
    }
    return null;
  }
  function setSelection(next: Set<string>): void {
    const same = next.size === selection.size && [...next].every((id) => selection.has(id));
    selection = next;
    dirty = true;
    if (!same) emitSelection();
  }

  type Press = {
    pointerId: number;
    button: number;
    touch: boolean;
    x0: number;
    y0: number;
    last: { x: number; y: number };
    card: string | null;
    shift: boolean;
    alt: boolean;
    mode: 'press' | 'pan' | 'marquee' | 'drag';
    samples: { x: number; y: number; t: number }[];
    timer: ReturnType<typeof setTimeout> | null;
    inspected: boolean;
    base: string[];
  };
  let press: Press | null = null;
  /** The last plain click on a card and the selection it replaced (see onDoubleClick). */
  let lastClick: { card: string; at: number; selection: string[] } | null = null;
  const touches = new Map<number, { x: number; y: number }>();
  let pinch: { d: number; cx: number; cy: number; d0: number; dist0: number } | null = null;
  let pinching = false;
  function pinchOf(): { d: number; cx: number; cy: number } | null {
    const pts = [...touches.values()];
    if (pts.length < 2) return null;
    const [a, b] = pts as [{ x: number; y: number }, { x: number; y: number }];
    return { d: Math.hypot(a.x - b.x, a.y - b.y), cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 };
  }
  function pinchStart(): void {
    const p = pinchOf();
    pinch = p ? { ...p, d0: p.d, dist0: rig.view.dist } : null;
  }
  function endPress(): void {
    if (press?.timer) clearTimeout(press.timer);
    press = null;
  }
  function capture(id: number): void {
    try {
      canvas.setPointerCapture?.(id);
    } catch {
      // Synthetic events without an active pointer cannot be captured.
    }
  }
  function cancelDrag(): void {
    drag = null;
    dirty = true;
  }

  function onPointerDown(e: PointerEvent): void {
    if (e.pointerType === 'touch') {
      touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (touches.size >= 2) {
        endPress();
        cancelDrag();
        pinching = true;
        pinchStart();
        capture(e.pointerId);
        return;
      }
    }
    if (press || pinching) return;
    const rc = cardAt(e.clientX, e.clientY);
    const touch = e.pointerType === 'touch';
    press = { pointerId: e.pointerId, button: e.button, touch, x0: e.clientX, y0: e.clientY, last: { x: e.clientX, y: e.clientY }, card: rc?.id ?? null, shift: e.shiftKey, alt: e.altKey, mode: 'press', samples: [], timer: null, inspected: false, base: [...selection] };
    if (touch && rc) {
      const p = press;
      p.timer = setTimeout(() => {
        p.timer = null;
        if (press !== p || p.mode !== 'press') return;
        p.inspected = true;
        opts.events.inspect?.(rc.pc.ref);
      }, LONG_PRESS_MS);
    }
    if (e.button === 1) e.preventDefault();
    capture(e.pointerId);
  }

  function startDrag(p: Press, ctrl: boolean): boolean {
    if (locked || p.button !== 0 || !p.card) return false;
    const piles = derivePiles(shown, order);
    const ids = grabbed(p.card, piles, selection, p.alt).filter((id) => shown[id]);
    if (!ids.length) return false;
    const start: Poses = {};
    for (const id of ids) start[id] = { ...rcards.get(id)!.motion.pose };
    const t = screenToTable(p.x0, p.y0);
    const a = start[p.card]!;
    drag = { ids, anchor: p.card, start, grabOffset: { x: t.x - a.x, y: t.y - a.y }, cur: t, ctrl };
    hovered = null;
    return true;
  }

  function onPointerMove(e: PointerEvent): void {
    if (e.pointerType === 'touch' && touches.has(e.pointerId)) touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinching) {
      const next = pinchOf();
      if (pinch && next && next.d > 0) {
        const r = canvasRect();
        rig.panBy(next.cx - pinch.cx, next.cy - pinch.cy);
        rig.zoomAt(next.cx - r.left, next.cy - r.top, rig.view.dist / ((pinch.dist0 * pinch.d0) / next.d));
        pinch = { ...pinch, ...next };
        dirty = true;
      } else pinchStart();
      return;
    }
    const p = press;
    if (p && p.pointerId === e.pointerId) {
      if (p.mode === 'press' && !p.inspected && Math.hypot(e.clientX - p.x0, e.clientY - p.y0) > DRAG_THRESHOLD_PX) {
        if (p.timer) clearTimeout(p.timer);
        p.timer = null;
        if (p.card && p.button === 0 && startDrag(p, e.ctrlKey || e.metaKey)) p.mode = 'drag';
        else if (!p.card && p.button === 0 && p.shift) p.mode = 'marquee';
        else {
          p.mode = 'pan';
          rig.stop();
        }
      }
      if (p.mode === 'drag' && drag) {
        drag.cur = screenToTable(e.clientX, e.clientY);
        drag.ctrl = e.ctrlKey || e.metaKey;
        dirty = true;
      } else if (p.mode === 'pan') {
        rig.panBy(e.clientX - p.last.x, e.clientY - p.last.y);
        const t = performance.now();
        p.samples.push({ x: e.clientX, y: e.clientY, t });
        while (p.samples.length > 2 && t - p.samples[0]!.t > 100) p.samples.shift();
        dirty = true;
      } else if (p.mode === 'marquee') {
        const r = canvasRect();
        const x = Math.min(p.x0, e.clientX) - r.left;
        const y = Math.min(p.y0, e.clientY) - r.top;
        Object.assign(marqueeEl.style, { display: 'block', left: `${x}px`, top: `${y}px`, width: `${Math.abs(e.clientX - p.x0)}px`, height: `${Math.abs(e.clientY - p.y0)}px` });
        const a = screenToTable(p.x0, p.y0);
        const b = screenToTable(e.clientX, e.clientY);
        const [x0, x1, y0, y1] = [Math.min(a.x, b.x), Math.max(a.x, b.x), Math.min(a.y, b.y), Math.max(a.y, b.y)];
        const inside = order.filter((id) => {
          const q = rcards.get(id)?.motion.pose;
          return !!q && q.x >= x0 && q.x <= x1 && q.y >= y0 && q.y <= y1;
        });
        setSelection(new Set([...p.base, ...inside]));
      }
      p.last = { x: e.clientX, y: e.clientY };
      return;
    }
    if (e.pointerType === 'touch') return;
    const hit = cardAt(e.clientX, e.clientY)?.id ?? null;
    if (hit !== hovered) {
      hovered = hit;
      canvas.style.cursor = hit && !locked ? 'grab' : '';
      dirty = true;
    }
  }

  function finishDrag(ctrl: boolean): void {
    if (!drag) return;
    const d = drag;
    drag = null;
    const moving = new Set(d.ids);
    // Where the grabbed card would land freely: under the cursor, keeping the grab offset.
    const ax = d.cur.x - d.grabOffset.x;
    const ay = d.cur.y - d.grabOffset.y;
    const others = order.filter((id) => !moving.has(id) && shown[id]);
    const pilesOthers = derivePiles(Object.fromEntries(others.map((id) => [id, shown[id]!])), others);
    const snapCards: SnapCard[] = others.map((id) => {
      const pile = pilesOthers.get(id);
      return pile ? { id, pose: shown[id]!, pile, frameDeg: 0 } : { id, pose: shown[id]!, frameDeg: 0 };
    });
    const a = d.start[d.anchor]!;
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const id of d.ids) {
      const s = d.start[id]!;
      minX = Math.min(minX, s.x - a.x - CARD_W / 2);
      maxX = Math.max(maxX, s.x - a.x + CARD_W / 2);
      minY = Math.min(minY, s.y - a.y - CARD_H / 2);
      maxY = Math.max(maxY, s.y - a.y + CARD_H / 2);
    }
    const r = resolveDrop(
      { pose: { x: ax, y: ay, rot: a.rot }, cursor: d.cur, single: d.ids.length === 1, ctrl, frameDeg: 0, extent: { minX, maxX, minY, maxY } },
      { table: L.table, cards: snapCards, targets: [] },
    );
    const target = r.kind === 'zone' ? { x: ax, y: ay, rot: a.rot } : r.pose;
    const moved: Poses = {};
    for (const id of d.ids) {
      const s = d.start[id]!;
      moved[id] = { x: target.x + (s.x - a.x), y: target.y + (s.y - a.y), rot: s.rot };
    }
    // Moved cards take the highest draw order, in their own order (base first).
    order = [...order.filter((id) => !moving.has(id)), ...d.ids];
    const now = performance.now();
    for (const id of d.ids) {
      const rc = rcards.get(id);
      if (!rc) continue;
      const from = { x: d.cur.x - d.grabOffset.x + (d.start[id]!.x - a.x), y: d.cur.y - d.grabOffset.y + (d.start[id]!.y - a.y), rot: d.start[id]!.rot };
      rc.motion.cut(from);
      rc.motion.moveTo(moved[id]!, 'spring', now, theme.motion, reduced());
    }
    commitMoves(moved);
  }

  /** Write moved poses through: membership follows the area each card now lies in. */
  function commitMoves(moved: Poses): void {
    const next = applyDrop(build, shown, moved);
    build = next;
    shown = posesFor(build, next.poses ?? {});
    if (memo) {
      memo = null;
      emitSorted();
    }
    const live = new Set(build.cards.map((c) => c.id));
    for (const id of [...rcards.keys()]) if (!live.has(id)) rcards.delete(id);
    order = order.filter((id) => live.has(id));
    const before = selection.size;
    selection = new Set([...selection].filter((id) => live.has(id)));
    if (selection.size !== before) emitSelection();
    dirty = true;
    change(next);
  }

  function onPointerUp(e: PointerEvent): void {
    if (e.pointerType === 'touch') touches.delete(e.pointerId);
    if (pinching) {
      if (touches.size === 0) {
        pinching = false;
        pinch = null;
      } else pinchStart();
      return;
    }
    const p = press;
    if (!p || p.pointerId !== e.pointerId) return;
    endPress();
    if (p.mode === 'drag') {
      if (drag) drag.cur = screenToTable(e.clientX, e.clientY);
      finishDrag(e.ctrlKey || e.metaKey);
      return;
    }
    if (p.mode === 'pan') {
      if (!reduced() && p.samples.length >= 2) {
        const first = p.samples[0]!;
        const last = p.samples[p.samples.length - 1]!;
        const dt = last.t - first.t;
        if (dt > 0 && performance.now() - last.t < 80) rig.fling((last.x - first.x) / dt, (last.y - first.y) / dt);
      }
      dirty = true;
      return;
    }
    if (p.mode === 'marquee') {
      marqueeEl.style.display = 'none';
      return;
    }
    if (p.inspected) return;
    const rc = p.card ? rcards.get(p.card) : null;
    if (p.button === 1) {
      if (rc) opts.events.inspect?.(rc.pc.ref);
      return;
    }
    if (p.button !== 0) return;
    // A click: Shift toggles the card in the selection, a plain click selects it alone, a click on empty table clears.
    if (!rc) {
      if (!p.shift && selection.size) setSelection(new Set());
      return;
    }
    if (p.shift) {
      const next = new Set(selection);
      if (next.has(rc.id)) next.delete(rc.id);
      else next.add(rc.id);
      setSelection(next);
    } else {
      // Remember the selection a plain click collapses, so that a double-click on a selected card sends the whole
      // selection across (its first click would otherwise have narrowed it to the one card).
      const now = performance.now();
      if (!lastClick || lastClick.card !== rc.id || now - lastClick.at > DOUBLE_CLICK_MS) lastClick = { card: rc.id, at: now, selection: [...selection] };
      setSelection(new Set([rc.id]));
    }
  }

  function onPointerCancel(e: PointerEvent): void {
    if (e.pointerType === 'touch') touches.delete(e.pointerId);
    if (pinching) {
      if (touches.size === 0) {
        pinching = false;
        pinch = null;
      } else pinchStart();
      return;
    }
    if (press?.pointerId === e.pointerId) {
      if (press.mode === 'drag') cancelDrag();
      marqueeEl.style.display = 'none';
      endPress();
    }
  }
  function onPointerLeave(): void {
    if (hovered && !press) {
      hovered = null;
      dirty = true;
    }
  }
  function onDoubleClick(e: MouseEvent): void {
    const rc = cardAt(e.clientX, e.clientY);
    const before = lastClick;
    lastClick = null;
    if (!rc || locked) return;
    if (before && before.card === rc.id && before.selection.length > 1 && before.selection.includes(rc.id)) setSelection(new Set(before.selection));
    crossOverIds(selection.has(rc.id) && selection.size > 1 ? order.filter((id) => selection.has(id)) : [rc.id]);
  }
  function crossOverIds(ids: readonly string[]): void {
    if (locked || !ids.length) return;
    const moved = crossOver(build, shown, ids, card, lastKey);
    const moving = new Set(Object.keys(moved));
    order = [...order.filter((id) => !moving.has(id)), ...ids.filter((id) => moving.has(id))];
    const now = performance.now();
    for (const [id, pose] of Object.entries(moved)) rcards.get(id)?.motion.moveTo(pose, 'spring', now, theme.motion, reduced());
    commitMoves(moved);
  }
  function onWheel(e: WheelEvent): void {
    e.preventDefault();
    const r = canvasRect();
    if (e.ctrlKey) rig.zoomAt(e.clientX - r.left, e.clientY - r.top, Math.exp(-e.deltaY * 0.01));
    else if (e.deltaMode !== 0 || (e.deltaX === 0 && Number.isInteger(e.deltaY) && Math.abs(e.deltaY) >= 50)) rig.zoomAt(e.clientX - r.left, e.clientY - r.top, Math.exp(-(e.deltaMode === 1 ? e.deltaY * 33 : e.deltaY) * 0.0015));
    else {
      rig.stop();
      rig.panBy(-e.deltaX, -e.deltaY);
    }
    dirty = true;
  }
  const typing = (t: EventTarget | null): boolean => t instanceof HTMLElement && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName));
  function onKey(e: KeyboardEvent): void {
    if (typing(e.target) || !host.isConnected || host.offsetParent === null) return;
    if (e.code === 'Space' && !e.repeat && hovered) {
      const rc = rcards.get(hovered);
      if (!rc) return;
      e.preventDefault();
      opts.events.inspect?.(rc.pc.ref);
    } else if (e.key === 'Escape' && drag) {
      cancelDrag();
      endPress();
    }
  }
  const onContextMenu = (e: Event) => e.preventDefault();
  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointercancel', onPointerCancel);
  canvas.addEventListener('pointerleave', onPointerLeave);
  canvas.addEventListener('dblclick', onDoubleClick);
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
  const debug: BuilderSurfaceDebug = {
    cards() {
      const r = canvasRect();
      const inMain = new Set(build.main);
      return order
        .map((id, i) => ({ rc: rcards.get(id), i }))
        .filter((x): x is { rc: RCard; i: number } => !!x.rc)
        .map(({ rc, i }) => {
          const pose = rc.motion.pose;
          const screen = rectOf(cardCorners(pose));
          return {
            id: rc.id,
            pose,
            screen,
            visible: screen.right > r.left && screen.left < r.right && screen.bottom > r.top && screen.top < r.bottom,
            ref: rc.pc.ref,
            area: areaOf(shown[rc.id] ?? pose),
            inMain: inMain.has(rc.id),
            basic: !!rc.pc.basic,
            selected: selection.has(rc.id),
            hovered: hovered === rc.id,
            moving: rc.motion.moving,
            order: i,
          };
        });
    },
    idle: () => !rig.moving && !drag && ![...rcards.values()].some((rc) => rc.motion.moving),
    pendingTextures: () => faces.pending,
    sort: () => ({ showing: memo?.key ?? null, key: lastKey }),
    selection: () => order.filter((id) => selection.has(id)),
    view: () => ({ cx: rig.view.cx, cy: rig.view.cy, dist: rig.view.dist }),
    locked: () => locked,
  };

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
      // The builder table is seen from above only.
    },
    rig: () => 'birdseye',
  };

  raf = requestAnimationFrame(tick);
  let first = true;

  return {
    update(view) {
      reducedView = view.reducedMotion;
      if (reduced() !== builtReduced) rebuildTheme();
      locked = !!view.locked;
      if (locked && drag) cancelDrag();
      build = view.build;
      // A build that no longer matches the remembered sort (an edit in the list view) forgets it.
      const next = reconcile(build, card, lastKey);
      show(next, first ? 'cut' : 'spring', first);
      first = false;
      if (memo && !samePoses(shown, posesFor(build, memo.after))) {
        memo = null;
        emitSorted();
      }
    },
    sort(key) {
      if (locked) return;
      lastKey = key;
      const r = sortToggle(build, shown, card, key, memo);
      memo = r.memo;
      const next: DeckBuild = { ...build, poses: posesFor(build, r.poses) };
      build = next;
      show(r.poses, 'settle', true);
      emitSorted();
      change(next);
    },
    dispenseBasic(ref) {
      if (locked) return;
      const next = dispense(build, shown, ref, card, lastKey);
      build = next;
      if (memo) {
        memo = null;
        emitSorted();
      }
      show(next.poses ?? {}, 'spring', false);
      change(next);
    },
    setTheme(next) {
      theme = next;
      rebuildTheme();
      const nextBack = backOf(theme);
      if (nextBack !== back) {
        back = nextBack;
        faces.dispose();
        faces = new FaceTextures(renderer, opts.faces, back);
        faces.onChange = () => (dirty = true);
        for (const rc of rcards.values()) faces.register(rc.pc.ref, 0);
      }
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
    toScreen(p) {
      const r = canvasRect();
      const s = toScreenLocal(p);
      return { x: r.left + s.x, y: r.top + s.y };
    },
    screenToTable,
    crossOver: (ids) => crossOverIds(ids),
    clearSelection: () => setSelection(new Set()),
    dispose() {
      disposed = true;
      endPress();
      cancelAnimationFrame(raf);
      resizeObserver.disconnect();
      insetObserver.disconnect();
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('pointercancel', onPointerCancel);
      canvas.removeEventListener('pointerleave', onPointerLeave);
      canvas.removeEventListener('dblclick', onDoubleClick);
      canvas.removeEventListener('wheel', onWheel);
      canvas.removeEventListener('contextmenu', onContextMenu);
      removeEventListener('keydown', onKey);
      themeInstance.dispose();
      faces.dispose();
      cards.dispose();
      outlineGeometry.dispose();
      outlineMaterial.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      canvas.remove();
      overlay.remove();
      marqueeEl.remove();
    },
  };
}

/** The builder surface's extras when `surface` is this module's (a test double may lack them). */
export function builderHandleOf(surface: BuilderSurface | null): BuilderSurfaceHandle | null {
  const h = surface as Partial<BuilderSurfaceHandle> | null;
  return h && typeof h.crossOver === 'function' && typeof h.toScreen === 'function' ? (h as BuilderSurfaceHandle) : null;
}

/** Create the builder table (scene/types.ts BuilderSurface). */
export const createBuilderSurface: CreateBuilderSurface = (host, opts) => createBuilderSurfaceImpl(host, opts);
