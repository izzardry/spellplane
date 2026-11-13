/**
 * The stack lane (DESIGN "The effect stack": a shared lane in the centre of the table where spells and abilities pile
 * up as a cascade, newest on top; "Specification: geometry, layout and motion": lane 200 wide × 320 deep at the table
 * centre, cascade offset 22, rotated for each viewer so it cascades toward them). Pure, so it is unit-testable without
 * WebGL; table-scene.ts draws what it describes.
 *
 * - Every item takes a slot of the cascade in stack order, numbered from the bottom: a spell shows its own card; an
 *   ability, trigger or copy marker shows the face of the card it comes from (the source permanent, or what a copy
 *   copies), so its name, art and artist credit are the printed card's own, unaltered (CLAUDE.md: faces are never
 *   recoloured, cropped or distorted). A marker is drawn smaller (MARKER_SCALE, uniform, so the face is whole and
 *   undistorted), its top edge level with its slot's, so it reads as a marker and not as a cast card ("a small ability
 *   marker"). A marker is joined to its source by a line.
 * - Items overlap downward so every title strip (the top `cascadeOffset` of a card) stays visible; the item's number,
 *   kind and note sit beside its strip, outside the card, in its controller's seat colour.
 * - An item whose confirmation round still waits pulses (DESIGN "The effect stack", Stack and confirmation).
 * - Hovering an item highlights its source and its targets (DESIGN "The effect stack", Reading it).
 * - Dropping an item's card back into the lane reorders it to the slot under the pointer (Resolving 4). A marker is not
 *   a card: it is hit-tested on its own (`entryAt`), the HUD's keys reach it through `hoveredStackItem`, and dragging it
 *   reorders it in the lane or, dropped outside, removes it (table-scene.ts).
 * - Far zoom (DESIGN "The effect stack", Reading it: "at far zoom it collapses to a count badge that expands on hover";
 *   PLAN Milestone 5, owner decisions, Far-zoom stack: on tap on touch; M5-P7): while a card in the lane would be drawn
 *   shorter than STACK_COLLAPSE_CARD_PX the lane is not drawn and a badge with the item count stands at its centre;
 *   hovering it (tapping it on touch) shows the items readably beside it (scene/stack-badge.ts).
 */
import { GEOMETRY } from '../core/geometry';
import { pendingAbout } from '../core/reducer/confirm';
import type { CardRef, InstanceId, Pose, StackItem, StackItemId, TableState } from '../core/types';
import type { Rect } from '../games/types';
import type { CardDressing } from '../themes/types';
import type { DebugParts } from '../util/debug';
import { CARD_H, CARD_W, pointInCard, rot2 } from './math';
import { STACK_COLLAPSE_CARD_PX, type TablePoint } from './types';

/** Outline width of a stack entry whose round is not waiting, mm. */
export const ENTRY_OUTLINE_MM = 0.8;

/**
 * Outline of a stack entry: its controller's seat colour; while its confirmation round waits, the theme's pending
 * treatment (`cardDressing.pending`, themes/signals.ts styles pendingConfirmation by it) pulsing in width, `pulse` 0..1
 * (1 = steady under reduced motion). The colour change makes the signal readable on any table surface, also where a
 * thin seat-coloured ring sits close to the table's own tone (Stonetable).
 */
export function entryOutline(pending: boolean, seatColour: string, dressing: Pick<CardDressing, 'pending'>, pulse: number): { colour: string; width: number } {
  if (!pending) return { colour: seatColour, width: ENTRY_OUTLINE_MM };
  return { colour: dressing.pending.colour, width: ENTRY_OUTLINE_MM + 1.4 * pulse };
}

/** Distance between consecutive items of the cascade, mm. */
export const STACK_STEP = GEOMETRY.stackLane.cascadeOffset;
/** Uniform scale of an ability, trigger or copy marker against a card (DESIGN "The effect stack", Ability: "a small ability marker"). */
export const MARKER_SCALE = 0.6;

/** One item of the stack as the lane draws it. */
export interface StackEntry {
  item: StackItem;
  /** 0 = bottom. */
  index: number;
  /** Shown number, counted from the bottom (1 = bottom). */
  number: number;
  /** Where the item's card or marker rests, in the canonical frame. */
  pose: Pose;
  /** The card whose face the entry shows: the spell itself, or a marker's source; null when there is none. */
  face: InstanceId | null;
  /** An ability, trigger or copy marker (not a spell card). */
  marker: boolean;
  /** "Spell", "Ability", "Trigger" or "Copy". */
  kindLabel: string;
  /** Its confirmation round still waits for someone: the entry pulses. */
  pending: boolean;
  /** The permanent a marker belongs to, if it is still on the table. */
  source: InstanceId | null;
}

const KIND_LABEL: Record<StackItem['kind'], string> = { spell: 'Spell', ability: 'Ability', trigger: 'Trigger', copy: 'Copy' };

/** The pose of slot `i` of the lane (0 = bottom), cascading toward the viewer at `angle`. */
export function stackSlotPose(lane: Rect, i: number, angle: number): Pose {
  const ly = lane.d / 2 - CARD_H / 2 - i * STACK_STEP;
  const [x, y] = rot2(0, ly, angle);
  return { x: lane.x + x, y: lane.y + y, rot: angle };
}

/** The stack slot of a spell card on the stack, or -1. */
export function slotOfCard(state: TableState, card: InstanceId): number {
  return state.stack.findIndex((i) => i.card === card);
}

/** The card a marker shows: its source, or for a copy what the copied item shows. */
function faceOf(state: TableState, item: StackItem, depth = 0): InstanceId | null {
  if (item.card !== undefined) return item.card;
  if (item.source !== undefined && state.cards[item.source]) return item.source;
  if (item.copyOf !== undefined && depth < 8) {
    const of = state.stack.find((i) => i.id === item.copyOf);
    if (of) return faceOf(state, of, depth + 1);
  }
  return null;
}

/** The scale an entry is drawn at: 1 for a spell's card, MARKER_SCALE for a marker. */
export function entryScale(e: Pick<StackEntry, 'marker'>): number {
  return e.marker ? MARKER_SCALE : 1;
}

/**
 * Where an entry is drawn, given the pose of its slot (or of the drag that holds it): a spell at the slot itself, a
 * marker shrunk toward its slot's top edge, so its name and art stay in the visible title strip.
 */
export function drawnPose(slot: Pose, scale: number): Pose {
  if (scale === 1) return slot;
  const p = entryPoint(slot, 0, ((1 - scale) * CARD_H) / 2);
  return { x: p.x, y: p.y, rot: slot.rot };
}

/** Every item of the stack, bottom first, as the lane draws it for a viewer at `angle`. */
export function stackEntries(state: TableState, lane: Rect, angle: number): StackEntry[] {
  return state.stack.map((item, index) => {
    const face = faceOf(state, item);
    return {
      item,
      index,
      number: index + 1,
      pose: stackSlotPose(lane, index, angle),
      face,
      marker: item.kind !== 'spell',
      kindLabel: KIND_LABEL[item.kind],
      pending: pendingAbout(state, item.id),
      source: item.source !== undefined && state.cards[item.source] ? item.source : null,
    };
  });
}

/** A point in the entry's frame (x right, y toward the top of the card as its viewer sees it). */
export function entryPoint(pose: Pose, lx: number, ly: number): TablePoint {
  const [x, y] = rot2(lx, ly, pose.rot);
  return { x: pose.x + x, y: pose.y + y };
}

/**
 * Where lines meet an item: the middle of its visible title strip, so a target line drawn from a covered item still
 * starts at the part of it that shows (DESIGN "The effect stack", Targets).
 */
export function itemAnchor(pose: Pose): TablePoint {
  return entryPoint(pose, 0, CARD_H / 2 - STACK_STEP / 2);
}

/** Where the number and kind label sit: left of the card (or marker, at `scale`), level with the title strip. */
export function labelPoint(pose: Pose, scale = 1): TablePoint {
  return entryPoint(pose, (-CARD_W * scale) / 2 - 4, CARD_H / 2 - STACK_STEP / 2);
}

/** Where the note sits: right of the card (or marker, at `scale`), level with the title strip. */
export function notePoint(pose: Pose, scale = 1): TablePoint {
  return entryPoint(pose, (CARD_W * scale) / 2 + 4, CARD_H / 2 - STACK_STEP / 2);
}

/**
 * The topmost entry under a table point: a later item covers the earlier ones it overlaps (DESIGN "The effect
 * stack": the newest on top). Null when the point is over none.
 */
export function entryAt(entries: readonly StackEntry[], p: TablePoint): StackEntry | null {
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i]!;
    const k = entryScale(e);
    if (pointInCard(p, drawnPose(e.pose, k), CARD_W * k, CARD_H * k)) return e;
  }
  return null;
}

/**
 * The slot a dropped item takes: the slot whose title strip is nearest the drop point along the cascade, clamped to
 * the stack (DESIGN "The effect stack", Resolving 4: items can be reordered by hand). `count` is the number of items.
 */
export function slotAt(lane: Rect, angle: number, p: TablePoint, count: number): number {
  if (count <= 1) return 0;
  // Lane-local y of the point (rotate back into the viewer's lane frame).
  const [, ly] = rot2(p.x - lane.x, p.y - lane.y, -angle);
  // Slot i's title strip centre sits at lane.d/2 - i*STEP - STEP/2.
  const i = Math.round((lane.d / 2 - STACK_STEP / 2 - ly) / STACK_STEP);
  return Math.max(0, Math.min(count - 1, i));
}

/** What hovering an item highlights: its source permanent and the cards its target lines point at. */
export function hoverHighlights(state: TableState, item: StackItemId): InstanceId[] {
  const it = state.stack.find((i) => i.id === item);
  if (!it) return [];
  const out = new Set<InstanceId>();
  if (it.source !== undefined && state.cards[it.source]) out.add(it.source);
  for (const l of Object.values(state.lines)) {
    if (l.kind !== 'target') continue;
    const fromItem = (l.from.kind === 'stackItem' && l.from.id === it.id) || (it.card !== undefined && l.from.kind === 'card' && l.from.id === it.card);
    if (fromItem && l.to.kind === 'card' && state.cards[l.to.id]) out.add(l.to.id);
  }
  return [...out].sort();
}

/**
 * Whether the lane collapses to its count badge (far zoom): there are items, and a card in the lane would be drawn
 * shorter than `threshold` CSS px (0 or less: behind the camera, not drawn at all). M5-P7.
 */
export function stackCollapsed(count: number, laneCardPx: number, threshold: number = STACK_COLLAPSE_CARD_PX): boolean {
  return count > 0 && Number.isFinite(laneCardPx) && laneCardPx < threshold;
}

/** The badge's accessible name: the number of items on the stack (DESIGN "The effect stack": "a count badge"). */
export function stackBadgeText(count: number): string {
  return count === 1 ? '1 item on the stack' : `${count} items on the stack`;
}

/** One item as the expanded badge lists it, newest first (M5-P7). */
export interface BadgeItem {
  item: StackItemId;
  /** Counted from the bottom, as in the lane. */
  number: number;
  kindLabel: string;
  /** The controller's seat colour (CSS). */
  colour: string;
  note: string | null;
  pending: boolean;
  /** The face it shows (the spell, or a marker's source), null for a face this viewer cannot see. */
  ref: CardRef | null;
  faceIndex: 0 | 1;
  marker: boolean;
}

/** The expanded badge's items: the lane's entries, newest (top of the stack) first, as this viewer may see them. */
export function badgeItems(entries: readonly StackEntry[], face: (id: InstanceId) => { ref: CardRef | null; faceIndex: 0 | 1 }, colour: (seat: string) => string): BadgeItem[] {
  return [...entries].reverse().map((e) => {
    const f = e.face ? face(e.face) : { ref: null, faceIndex: 0 as const };
    return { item: e.item.id, number: e.number, kindLabel: e.kindLabel, colour: colour(e.item.controller), note: e.item.note ?? null, pending: e.pending, ref: f.ref, faceIndex: f.faceIndex, marker: e.marker };
  });
}

/** One entry of the lane as the debug hook reports it (PLAN M1-P3 browser tests). */
export interface DebugStackEntry {
  item: StackItemId;
  kind: StackItem['kind'];
  index: number;
  number: number;
  controller: string;
  face: InstanceId | null;
  marker: boolean;
  pending: boolean;
  pose: Pose;
  note: string | null;
  /** 1 for a spell's card, MARKER_SCALE for a marker. */
  scale: number;
  /** Screen rectangle of the entry's card or marker as drawn. */
  screen: DOMRect;
}

/** What the scenes report as hovered in the lane (WeakMap: the TableScene contract stays as it is). */
const hovers = new WeakMap<object, () => StackItemId | null>();

/** Called by a scene: how to read the stack item under its pointer. */
export function registerStackHover(scene: object, read: () => StackItemId | null): void {
  hovers.set(scene, read);
}

/**
 * The stack item under the pointer of `scene` (a marker, or a spell's card in the lane), or null (DESIGN "The effect
 * stack": N notes, X copies and I pings a hovered item, marker or spell alike).
 */
export function hoveredStackItem(scene: object | null): StackItemId | null {
  return scene ? (hovers.get(scene)?.() ?? null) : null;
}

declare module '../util/debug' {
  interface DebugParts {
    /** The stack lane as drawn (scene/stack.ts; M1-P3). */
    stack(): DebugStackEntry[];
  }
}

/** Satisfies the module augmentation's import (types only). */
export type StackDebugPart = Pick<DebugParts, 'stack'>;
