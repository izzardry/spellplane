/**
 * Presentation: where and how each card is drawn (DESIGN "Table model", Presentation column; "Specification:
 * geometry, layout and motion", Tables and seats). Pure, so it is unit-testable without WebGL.
 *
 * - Battlefield ('free'): the card's own pose, turned a further 90° while `tapped` (the stored `pose.rot` is the
 *   untapped rotation; DESIGN "Specification: geometry, layout and motion": a card of a seat at θ rests at θ and is
 *   tapped at θ + 90). A pile opened in place fans out beside its bottom card.
 * - Library, graveyard, exile ('squared'): a squared pile at the seat's zone anchor; graveyard and exile show the
 *   top card; an opened public pile fans out as an ordered row ending at the anchor.
 * - Stack ('cascade-lane'): a cascade in the lane, rotated for this viewer so it cascades toward them.
 * - Hand ('fan'): the viewer's own hand is the HUD's screen-anchored fan (not drawn here); other seats' hands
 *   are a row of card backs at their hand row.
 * - Command ('area'): a row inside the command rectangle. 'hidden' zones are not drawn.
 * Faces: a public face-up card shows its face; a card this viewer may see privately (own face-down, peek,
 * targeted reveal) shows its face dimmed; everything else shows the neutral back.
 */
import { GEOMETRY } from '../core/geometry';
import type { CardInstance, CardRef, InstanceId, PileId, Pose, SeatId, TableState, ZoneId, ZonePresentation } from '../core/types';
import type { GameDefinition, Rect, SeatLayout, TableLayout } from '../games/types';
import { BACK_KEY, faceKey } from './faces-key';
import { CARD_H, CARD_W, normDeg, rectPoint, rot2 } from './math';
import type { ZoneTarget } from './snap';
import type { ViewState } from './types';

export type PlacementKind = 'free' | 'pile' | 'stack' | 'hand' | 'area';

export interface Placement {
  id: InstanceId;
  zone: ZoneId;
  kind: PlacementKind;
  rest: Pose;
  /** Height for pile steps (mm). */
  z: number;
  /** Draw order: compared lexicographically, later paints over earlier. */
  sort: [number, number, number];
  /** Texture key: a face key or BACK_KEY. */
  key: string;
  /** Face identity behind `key` (null for the back). */
  ref: CardRef | null;
  faceIndex: 0 | 1;
  /** Shown dimmed: the owner's view of a face-down card. */
  dimmed: boolean;
  /** Part of a pile or zone fanned open in place. */
  fanned: boolean;
}

export interface PresentationContext {
  game: GameDefinition;
  layout: TableLayout;
  viewerSeat: SeatId | null;
}

export const LAYER = { zonePile: 0, area: 1, battlefield: 2, handRow: 3, stack: 4, fanned: 5, dragged: 6 } as const;

/** Spacing of an opened zone pile fan, mm. */
export const ZONE_FAN_STEP = 30;

/** Extra rotation drawn for a tapped card on the battlefield, degrees clockwise. */
export const TAP_DEG = 90;

/** The rotation a 'free' (battlefield) card is drawn at: its stored rot plus the tap turn. */
export function displayedRot(c: Pick<CardInstance, 'pose' | 'tapped'>): number {
  return normDeg(c.pose.rot + (c.tapped ? TAP_DEG : 0));
}

/** The stored pose for a pose drawn on the battlefield (strips the tap turn back out). */
export function storedPose(c: Pick<CardInstance, 'tapped'>, displayed: Pose): Pose {
  return { x: displayed.x, y: displayed.y, rot: normDeg(displayed.rot - (c.tapped ? TAP_DEG : 0)) };
}

export function presentationOf(game: GameDefinition, state: TableState, zone: ZoneId): ZonePresentation | null {
  const kind = state.zones[zone]?.kind ?? zone.split(':')[0]!;
  return game.zones.find((z) => z.id === kind)?.presentation ?? null;
}

export function seatLayoutOf(state: TableState, layout: TableLayout, seat: SeatId | null | undefined): SeatLayout | null {
  if (!seat) return null;
  const s = state.seats[seat];
  return s ? (layout.seats[s.index] ?? null) : null;
}

/**
 * The box the fitted view frames (DESIGN "Camera and navigation": the screen-anchored layer never covers the table's
 * content): the table plus the hand rows of card backs the scene draws outside its edges for every seat but the
 * viewer's and empty chairs (PLAN M1-P5: the opponent's hand as card backs), so the fitted view shows how many cards
 * each hand holds.
 * Axis-aligned in table space; centre and size in mm.
 */
export function fitFrame(state: TableState | null, layout: TableLayout, viewerSeat: SeatId | null): { x: number; y: number; w: number; d: number } {
  let x0 = -layout.table.w / 2;
  let x1 = layout.table.w / 2;
  let y0 = -layout.table.d / 2;
  let y1 = layout.table.d / 2;
  if (state) {
    const own = seatLayoutOf(state, layout, viewerSeat);
    for (const seat of Object.values(state.seats)) {
      const sl = layout.seats[seat.index];
      // Empty chairs (the solo table's second seat) hold no hand to show.
      if (!sl || sl === own || (seat.name === '' && seat.peer === undefined)) continue;
      const r = sl.zones.handRow;
      const a = (r.rot * Math.PI) / 180;
      const c = Math.abs(Math.cos(a));
      const sn = Math.abs(Math.sin(a));
      const hw = (c * r.w + sn * r.d) / 2;
      const hd = (sn * r.w + c * r.d) / 2;
      x0 = Math.min(x0, r.x - hw);
      x1 = Math.max(x1, r.x + hw);
      y0 = Math.min(y0, r.y - hd);
      y1 = Math.max(y1, r.y + hd);
    }
  }
  return { x: (x0 + x1) / 2, y: (y0 + y1) / 2, w: x1 - x0, d: y1 - y0 };
}

/** The viewer's seat angle (spectators see seat 0's view). */
export function viewerAngle(state: TableState | null, layout: TableLayout, viewerSeat: SeatId | null): number {
  if (state && viewerSeat) {
    const sl = seatLayoutOf(state, layout, viewerSeat);
    if (sl) return sl.angle;
  }
  return layout.seats[0]?.angle ?? 0;
}

function isPose(v: unknown): v is Pose {
  return typeof v === 'object' && v !== null && 'rot' in v && !('w' in v);
}

/** Anchor pose of a seat's squared zone pile (library, graveyard, exile), or null. */
export function pileAnchor(sl: SeatLayout, kind: string): Pose | null {
  const v = (sl.zones as unknown as Record<string, unknown>)[kind];
  return isPose(v) ? v : null;
}

/** The pose of a card at index i in the stack lane, cascading toward the viewer. */
export function stackPose(lane: Rect, i: number, angle: number): Pose {
  const ly = lane.d / 2 - CARD_H / 2 - i * GEOMETRY.stackLane.cascadeOffset;
  const [x, y] = rot2(0, ly, angle);
  return { x: lane.x + x, y: lane.y + y, rot: angle };
}

/** Place every drawn card. Cards not in the result are not drawn (own hand, hidden zones). */
export function placeCards(state: TableState, view: ViewState, ctx: PresentationContext): Map<InstanceId, Placement> {
  const out = new Map<InstanceId, Placement>();
  const angle = viewerAngle(state, ctx.layout, ctx.viewerSeat);
  const seatIndex = (seat: SeatId | null) => (seat ? (state.seats[seat]?.index ?? 9) : 9);

  for (const zone of Object.values(state.zones)) {
    const pres = presentationOf(ctx.game, state, zone.id);
    if (pres === 'hidden') continue;
    const sl = seatLayoutOf(state, ctx.layout, zone.owner);
    const zoneOrder = seatIndex(zone.owner) * 100 + ctx.game.zones.findIndex((z) => z.id === zone.kind);
    const ids = zone.ids.filter((id) => state.cards[id]);
    const n = ids.length;

    if (pres === 'fan') {
      if (zone.owner === ctx.viewerSeat && ctx.viewerSeat !== null) continue;
      const row = sl?.zones.handRow;
      if (!row) continue;
      const step = n > 1 ? Math.min(CARD_W + 4, (row.w - CARD_W) / (n - 1)) : 0;
      ids.forEach((id, i) => {
        const p = rectPoint(row, -((n - 1) * step) / 2 + i * step, 0);
        out.set(id, make(state, view, ctx, id, zone.id, 'hand', { x: p.x, y: p.y, rot: row.rot }, 0, [LAYER.handRow, zoneOrder, i]));
      });
      continue;
    }

    if (pres === 'squared' && sl) {
      const anchor = pileAnchor(sl, zone.kind);
      if (anchor) {
        const open = view.openPile === zone.id && zone.visibility === 'public';
        ids.forEach((id, i) => {
          let pose: Pose = { x: anchor.x, y: anchor.y, rot: anchor.rot };
          if (open) {
            const [ox, oy] = rot2(-(n - 1 - i) * ZONE_FAN_STEP, 0, sl.angle);
            pose = { x: anchor.x + ox, y: anchor.y + oy, rot: anchor.rot };
          }
          const z = Math.min(i * GEOMETRY.squaredStep, GEOMETRY.squaredStepCap);
          const p = make(state, view, ctx, id, zone.id, 'pile', pose, z, [open ? LAYER.fanned : LAYER.zonePile, zoneOrder, i]);
          p.fanned = open;
          out.set(id, p);
        });
        continue;
      }
    }

    if (pres === 'cascade-lane') {
      // A spell takes its item's slot, so ability and trigger markers between spells keep theirs (scene/stack.ts).
      ids.forEach((id, i) => {
        const slot = state.stack.findIndex((it) => it.card === id);
        const at = slot < 0 ? i : slot;
        out.set(id, make(state, view, ctx, id, zone.id, 'stack', stackPose(ctx.layout.stackLane, at, angle), 0, [LAYER.stack, 0, at]));
      });
      continue;
    }

    if (pres === 'area' && sl) {
      const r = sl.zones.command;
      ids.forEach((id, i) => {
        const p = rectPoint(r, -r.w / 2 + CARD_W / 2 + 6 + i * (CARD_W + GEOMETRY.gap) * 0.5, 0);
        out.set(id, make(state, view, ctx, id, zone.id, 'area', { x: p.x, y: p.y, rot: r.rot }, 0, [LAYER.area, zoneOrder, i]));
      });
      continue;
    }

    // Battlefield and anything else: the card's own pose, in draw order; pile members together.
    const pos = new Map(ids.map((id, i) => [id, i]));
    const pileBase = new Map<PileId, number>();
    for (const id of ids) {
      const c = state.cards[id]!;
      if (c.pile) pileBase.set(c.pile.id, Math.min(pileBase.get(c.pile.id) ?? Infinity, pos.get(id)!));
    }
    const fanBottom = new Map<PileId, Pose>();
    for (const id of ids) {
      const c = state.cards[id]!;
      if (c.pile && c.pile.index === 0) fanBottom.set(c.pile.id, c.pose);
    }
    for (const id of ids) {
      const c = state.cards[id]!;
      let pose: Pose = { ...c.pose, rot: displayedRot(c) };
      let fanned = false;
      if (c.pile && view.openPile === c.pile.id) {
        const b = fanBottom.get(c.pile.id) ?? c.pose;
        const sa = seatLayoutOf(state, ctx.layout, c.controller)?.angle ?? 0;
        const [ox, oy] = rot2(c.pile.index * (CARD_W + GEOMETRY.gap), 0, sa);
        pose = { x: b.x + ox, y: b.y + oy, rot: displayedRot(c) };
        fanned = true;
      }
      const base = c.pile ? pileBase.get(c.pile.id)! : pos.get(id)!;
      const sub = c.pile ? c.pile.index : 0;
      const z = c.pile?.kind === 'squared' && !fanned ? Math.min(c.pile.index * GEOMETRY.squaredStep, GEOMETRY.squaredStepCap) : 0;
      const p = make(state, view, ctx, id, zone.id, 'free', pose, z, [fanned ? LAYER.fanned : LAYER.battlefield, zoneOrder * 10000 + base, sub]);
      p.fanned = fanned;
      out.set(id, p);
    }
  }
  return out;
}

function make(
  state: TableState,
  view: ViewState,
  _ctx: PresentationContext,
  id: InstanceId,
  zone: ZoneId,
  kind: PlacementKind,
  rest: Pose,
  z: number,
  sort: [number, number, number],
): Placement {
  const c = state.cards[id]!;
  const face = faceOf(c, view);
  return { id, zone, kind, rest: { x: rest.x, y: rest.y, rot: normDeg(rest.rot) }, z, sort, ...face, fanned: false };
}

/** Which texture a card shows to this viewer. */
export function faceOf(c: CardInstance, view: ViewState): { key: string; ref: CardRef | null; faceIndex: 0 | 1; dimmed: boolean } {
  if (c.face === 'up' && c.identity) return { key: faceKey(c.identity, c.faceIndex), ref: c.identity, faceIndex: c.faceIndex, dimmed: false };
  const priv = view.privateFaces[c.id];
  if (priv) return { key: faceKey(priv, c.faceIndex), ref: priv, faceIndex: c.faceIndex, dimmed: true };
  return { key: BACK_KEY, ref: null, faceIndex: 0, dimmed: false };
}

export const compareSort = (a: readonly number[], b: readonly number[]): number => a[0]! - b[0]! || a[1]! - b[1]! || a[2]! - b[2]!;

/** Rule-1 drop targets: zone piles, the stack lane (rotated for the viewer) and avatars (DESIGN drop resolution 1). */
export function dropTargets(state: TableState, layout: TableLayout, angle: number, game: GameDefinition): ZoneTarget[] {
  const out: ZoneTarget[] = [];
  for (const seat of Object.values(state.seats)) {
    const sl = layout.seats[seat.index];
    if (!sl) continue;
    for (const z of game.zones) {
      if (z.scope !== 'seat' || z.presentation !== 'squared') continue;
      const a = pileAnchor(sl, z.id);
      const id = `${z.id}:${seat.id}`;
      if (a && state.zones[id]) out.push({ zone: id, rect: { x: a.x, y: a.y, w: CARD_W, d: CARD_H, rot: a.rot } });
    }
    const hand = game.zones.find((z) => z.presentation === 'fan');
    if (hand && state.zones[`${hand.id}:${seat.id}`]) out.push({ zone: `${hand.id}:${seat.id}`, circle: { x: sl.zones.avatar.x, y: sl.zones.avatar.y, r: 30 } });
  }
  const stack = game.zones.find((z) => z.presentation === 'cascade-lane');
  if (stack && state.zones[stack.id]) out.push({ zone: stack.id, rect: { ...layout.stackLane, rot: layout.stackLane.rot + angle } });
  return out;
}

export interface Marking {
  /** Line segments as [x1, y1, x2, y2] in table mm. */
  segments: number[];
  labels: { key: string; text: string; x: number; y: number; rot: number; anchorY: 'top' | 'middle' | 'bottom' }[];
}

const rectSegments = (r: Rect, out: number[], margin = 0) => {
  const w = r.w / 2 + margin;
  const d = r.d / 2 + margin;
  const c = [rectPoint(r, -w, -d), rectPoint(r, w, -d), rectPoint(r, w, d), rectPoint(r, -w, d)];
  for (let i = 0; i < 4; i++) {
    const a = c[i]!;
    const b = c[(i + 1) % 4]!;
    out.push(a.x, a.y, b.x, b.y);
  }
};

/** Hairline zone outlines and their labels (Paper: "zones are hairline outlines with small caps labels"). */
export function markings(layout: TableLayout, game: GameDefinition, angle: number, seatsInUse: number): Marking {
  const segments: number[] = [];
  const labels: Marking['labels'] = [];
  rectSegments({ x: 0, y: 0, w: layout.table.w, d: layout.table.d, rot: 0 }, segments);
  const label = (s: string) => s.toUpperCase();
  layout.seats.slice(0, Math.max(1, seatsInUse)).forEach((sl, i) => {
    rectSegments(sl.territory, segments);
    for (const z of game.zones) {
      if (z.scope !== 'seat' || z.presentation !== 'squared') continue;
      const a = pileAnchor(sl, z.id);
      if (!a) continue;
      rectSegments({ x: a.x, y: a.y, w: CARD_W, d: CARD_H, rot: a.rot }, segments, 2);
      const [lx, ly] = rot2(0, CARD_H / 2 + 6, sl.angle);
      labels.push({ key: `zl:${i}:${z.id}`, text: label(z.label), x: a.x + lx, y: a.y + ly, rot: angle, anchorY: 'middle' });
    }
    const cmd = game.zones.find((z) => z.presentation === 'area');
    if (cmd) {
      rectSegments(sl.zones.command, segments);
      const p = rectPoint(sl.zones.command, 0, sl.zones.command.d / 2 - 8);
      labels.push({ key: `zl:${i}:${cmd.id}`, text: label(cmd.label), x: p.x, y: p.y, rot: angle, anchorY: 'middle' });
    }
  });
  const stack = game.zones.find((z) => z.presentation === 'cascade-lane');
  if (stack) {
    const lane = { ...layout.stackLane, rot: layout.stackLane.rot + angle };
    rectSegments(lane, segments);
    const p = rectPoint(lane, 0, lane.d / 2 + 8);
    labels.push({ key: `zl:stack`, text: label(stack.label), x: p.x, y: p.y, rot: angle, anchorY: 'middle' });
  }
  return { segments, labels };
}
