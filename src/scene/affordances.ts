/**
 * On-card and on-pile affordances, the table side (PLAN Milestone 7, Owner decisions after the first design round, Play
 * without memorising keys: "Every everyday action is reachable by direct manipulation with visible affordances: drag,
 * drop, double-click or tap, on-card and on-pile actions"; PLAN M7-P5; docs/design/m7-hud-proposal.md, Card action strip
 * and Pile actions). Pure helpers the table scene uses to report where the selection strip and the pile actions sit,
 * and to read what a drop means beyond the snap rules: a card dragged into the hand at the bottom of the screen, onto
 * the command area, onto the bottom of the library, or a creature pushed toward an opponent (an attack, as the Attack
 * shortcut does it; DESIGN "Combat and annotation", Combat shortcuts 1). Added by M7-P5.
 *
 * Nothing here touches the DOM or the clock; the scene reports these on change and when the camera settles, never once
 * per frame (Safari: no per-frame DOM writes or Svelte state).
 */
import { GEOMETRY, SCREEN_LAYER } from '../core/geometry';
import type { CardInstance, InstanceId, Pose, SeatId, TableState, ZoneId } from '../core/types';
import type { Rect, SeatLayout } from '../games/types';
import { pointInRect, rot2 } from './math';
import type { PileHover, ScreenRect, SelectionAnchor, TablePoint } from './types';

/** Room the selection strip needs above a card, CSS px: below this the strip goes under the selection instead. */
export const STRIP_ROOM_PX = 72;

/** The union of screen rectangles, or null for none. */
export function unionRect(rects: readonly ScreenRect[]): ScreenRect | null {
  if (rects.length === 0) return null;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const r of rects) {
    x0 = Math.min(x0, r.x);
    y0 = Math.min(y0, r.y);
    x1 = Math.max(x1, r.x + r.width);
    y1 = Math.max(y1, r.y + r.height);
  }
  if (![x0, y0, x1, y1].every(Number.isFinite)) return null;
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

/** A screen rectangle rounded to whole CSS px (the anchors are compared and handed to the DOM as they are). */
export function roundRect(r: ScreenRect): ScreenRect {
  const x = Math.round(r.x);
  const y = Math.round(r.y);
  return { x, y, width: Math.round(r.x + r.width) - x, height: Math.round(r.y + r.height) - y };
}

/** Whether two rectangles overlap (touching edges do not). */
export function rectsOverlap(a: ScreenRect, b: ScreenRect): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

/**
 * The selection strip's anchor: the selected cards' screen box, the one zone they share (null when they span zones),
 * and whether the strip fits above the box inside the viewport `view` (else it goes below). Null when no selected card
 * is on screen.
 */
export function selectionAnchorOf(cards: readonly InstanceId[], rects: readonly ScreenRect[], zones: readonly ZoneId[], view: ScreenRect): SelectionAnchor | null {
  const box = unionRect(rects);
  if (!box || cards.length === 0) return null;
  const onScreen = box.x + box.width > view.x && box.x < view.x + view.width && box.y + box.height > view.y && box.y < view.y + view.height;
  if (!onScreen) return null;
  const zone = zones.length > 0 && zones.every((z) => z === zones[0]) ? zones[0]! : null;
  return { cards: [...cards], rect: roundRect(box), zone, above: box.y - view.y >= STRIP_ROOM_PX };
}

/** Whether two selection anchors would place the strip the same (same cards, zone, side and box). */
export function sameSelectionAnchor(a: SelectionAnchor | null, b: SelectionAnchor | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.zone === b.zone && a.above === b.above && sameRect(a.rect, b.rect) && a.cards.length === b.cards.length && a.cards.every((c, i) => b.cards[i] === c);
}

/** Whether two pile hovers name the same pile the same way at the same place. */
export function samePileHover(a: PileHover | null, b: PileHover | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.zone === b.zone && a.pile === b.pile && a.via === b.via && a.count === b.count && a.owner === b.owner && sameRect(a.rect, b.rect);
}

const sameRect = (a: ScreenRect, b: ScreenRect): boolean => a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;

/**
 * Whether a viewport point lies in the band of the own hand (the hand fan at the bottom of the screen, SCREEN_LAYER:
 * cards at 22% of the viewport height; DESIGN "Specification: geometry, layout and motion", Screen layer): a card
 * dropped there goes to the hand, as one dropped onto the own avatar spot does. `bottom` is the viewport's bottom edge
 * above any safe-area inset, `vh` its height.
 */
export function inHandBand(y: number, bottom: number, vh: number): boolean {
  return Number.isFinite(y) && y >= bottom - vh * SCREEN_LAYER.handCardViewportFraction && y <= bottom + 1;
}

/** A point in a seat's own frame: u to the owner's right, v away from the owner (toward the table centre). */
export function seatLocal(p: TablePoint, sl: SeatLayout): { u: number; v: number } {
  const [u, v] = rot2(p.x - sl.territory.x, p.y - sl.territory.y, -sl.territory.rot);
  return { u, v };
}

/** Whether a table point lies past a seat's front line (the territory edge facing the table centre). */
export function pastFrontLine(p: TablePoint, sl: SeatLayout): boolean {
  return seatLocal(p, sl).v > sl.territory.d / 2;
}

/**
 * Where an attacker goes (DESIGN "Combat and annotation", Combat shortcuts 1: "slide forward across their controller's
 * front line and tap"): its home slot (or its pose) moved forward by GEOMETRY.attackDisplacement in its controller's
 * frame, as the Attack shortcut puts it (ui/commands.ts 'attack').
 */
export function attackPose(card: CardInstance, angle: number): Pose {
  const base = card.home ?? card.pose;
  const r = (angle * Math.PI) / 180;
  const d = GEOMETRY.attackDisplacement;
  const round = (v: number) => Math.round(v * 1000) / 1000;
  // ui/geometry.ts rotateCw: a seat's local frame to the canonical frame.
  return { x: round(base.x + d * Math.sin(r)), y: round(base.y + d * Math.cos(r)), rot: base.rot };
}

/** What a drop toward an opponent means: an attack on that seat (null: the only or implied opponent). */
export interface AttackDrop {
  target: SeatId | null;
}

/**
 * Whether dropping `cards` with the pointer at table point `p` is an attack (PLAN M7-P5: "attack by dragging a creature
 * toward an opponent (existing combat model)"): every card is an untapped, non-attacking card on its controller's
 * battlefield that `viewer` controls, and the pointer is on another seat's avatar spot (`avatarSeat`, or a HUD element
 * naming that seat), or past the controller's front line outside every territory (the centre of the table; the empty
 * half of a goldfish table). `lane` is the stack lane: with items on the stack a drop there stays a cast (rule 1), on
 * an empty stack the attack wins. A drop inside another seat's territory stays a permanent move (a change of control).
 */
export function attackDrop(
  state: TableState,
  cards: readonly CardInstance[],
  p: TablePoint,
  ctx: { viewer: SeatId | null; seatLayout: (seat: SeatId) => SeatLayout | null; territories: readonly Rect[]; lane: Rect | null; avatarSeat: SeatId | null; battlefield: (zone: ZoneId) => boolean },
): AttackDrop | null {
  const viewer = ctx.viewer;
  if (!viewer || cards.length === 0) return null;
  for (const c of cards) {
    if (c.controller !== viewer || c.tapped || c.combat === 'attack' || !ctx.battlefield(c.zone)) return null;
    if (state.zones[c.zone]?.owner !== c.controller) return null;
  }
  if (ctx.avatarSeat !== null) return ctx.avatarSeat !== viewer && state.seats[ctx.avatarSeat] ? { target: ctx.avatarSeat } : null;
  const sl = ctx.seatLayout(viewer);
  if (!sl || !pastFrontLine(p, sl)) return null;
  if (ctx.territories.some((t) => pointInRect(p, t))) return null;
  if (ctx.lane && state.stack.length > 0 && pointInRect(p, ctx.lane)) return null;
  return { target: null };
}

/**
 * The seats other than `viewer` that are taken (a name or a peer): an attack line goes to the chosen seat only when
 * there is more than one (DESIGN "Combat and annotation", Attack target: "In two-player games the target is implicit").
 */
export function opponents(state: TableState, viewer: SeatId): SeatId[] {
  return Object.values(state.seats)
    .filter((s) => s.id !== viewer && (s.name !== '' || s.peer !== undefined))
    .sort((a, b) => a.index - b.index)
    .map((s) => s.id);
}

/**
 * The "Bottom" slot beside a library pile while a card is dragged over it (PLAN M7-P5: drag to "library top/bottom"):
 * a card-sized rectangle one gap past the pile's far side in its owner's frame. A drop on the pile puts the card on
 * top, a drop on this slot at the bottom.
 */
export function libraryBottomSlot(library: Pose): Rect {
  const off = GEOMETRY.card.w + GEOMETRY.gap;
  const [dx, dy] = rot2(-off, 0, library.rot);
  return { x: library.x + dx, y: library.y + dy, w: GEOMETRY.card.w, d: GEOMETRY.card.h, rot: library.rot };
}
