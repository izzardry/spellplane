/**
 * Tidy (Y) re-flows the player's own battlefield into neat rows, preserving piles and relative order; never automatic
 * (DESIGN "Card manipulation", Placement and piles; "Specification: geometry, layout and motion" for card size, gap,
 * cascade offset and the pile column at the right edge of a territory). The client computes the poses and dispatches
 * one `tidy` action (core/actions.ts TidyAction).
 */
import { GEOMETRY } from '../core/geometry';
import type { CardInstance, InstanceId, Pose, SeatId, TableState } from '../core/types';
import type { TableLayout } from '../games/types';
import { rotateCw, round, seatAngle, seatLayout } from './geometry';

const { card: CARD, gap: GAP, cascadeOffset: CASCADE, pileColumnGap: COLUMN_GAP } = GEOMETRY;

/** Default territory when the layout is unavailable: a 1v1 half (DESIGN "Specification: geometry, layout and motion", Tables and seats). */
const FALLBACK_TERRITORY = { w: 1400, d: 440, centreDistance: 330 };

interface Unit {
  root: CardInstance;
  members: CardInstance[];
  local: { x: number; y: number };
  w: number;
  depth: number;
}

function isSideways(card: CardInstance, angle: number): boolean {
  const r = (((card.pose.rot - angle) % 180) + 180) % 180;
  return Math.abs(r - 90) < 45;
}

/**
 * Poses for every card of `seat`'s battlefield after a tidy. Units (a single card, a pile with its members, a host
 * with its attachments) keep their relative order: front row first, then left to right as they lay before.
 * Displaced cards (temporary moves) are left alone; Settle brings them home.
 */
export function tidyPoses(state: TableState, seat: SeatId, layout: TableLayout | null): Record<InstanceId, Pose> {
  const zone = state.zones[`battlefield:${seat}`];
  if (!zone) return {};
  const angle = seatAngle(layout, state, seat);
  const sl = seatLayout(layout, state, seat);
  const terr = sl
    ? { x: sl.territory.x, y: sl.territory.y, w: sl.territory.w, d: sl.territory.d }
    : { ...rotateCw(0, -FALLBACK_TERRITORY.centreDistance, angle), w: FALLBACK_TERRITORY.w, d: FALLBACK_TERRITORY.d };
  const cards = zone.ids.map((id) => state.cards[id]).filter((c): c is CardInstance => !!c);
  const byId = new Map(cards.map((c) => [c.id, c]));
  const toLocal = (p: { x: number; y: number }) => rotateCw(p.x - terr.x, p.y - terr.y, -angle);

  // A unit is rooted at a card that is neither attached nor a non-bottom pile member.
  const rootOf = (c: CardInstance): CardInstance => {
    let cur = c;
    for (let i = 0; i < 64; i++) {
      if (cur.attachedTo && byId.has(cur.attachedTo)) {
        cur = byId.get(cur.attachedTo)!;
        continue;
      }
      if (cur.pile && cur.pile.index > 0) {
        const bottom = cards.find((x) => x.pile?.id === cur.pile!.id && x.pile.index === 0);
        if (bottom && bottom !== cur) {
          cur = bottom;
          continue;
        }
      }
      break;
    }
    return cur;
  };
  const units = new Map<InstanceId, Unit>();
  for (const c of cards) {
    const root = rootOf(c);
    let u = units.get(root.id);
    if (!u) {
      u = { root, members: [], local: toLocal(root.home ?? root.pose), w: isSideways(root, angle) ? CARD.h : CARD.w, depth: CARD.h };
      units.set(root.id, u);
    }
    if (c !== root) u.members.push(c);
  }
  const movable = [...units.values()].filter((u) => !u.root.home && !u.members.some((m) => m.home));
  for (const u of movable) {
    const cascade = u.members.filter((m) => m.pile?.kind === 'cascade').length;
    u.depth = CARD.h + cascade * CASCADE;
  }
  // Rows: front (toward the centre, larger local y) first; within a band of one card height, left to right.
  const band = CARD.h + GAP;
  movable.sort((a, b) => Math.round(b.local.y / band) - Math.round(a.local.y / band) || a.local.x - b.local.x || (a.root.id < b.root.id ? -1 : 1));

  // Usable width: leave the library/graveyard/exile column at the right edge free.
  const left = -terr.w / 2 + COLUMN_GAP;
  const right = terr.w / 2 - (CARD.w + 2 * COLUMN_GAP);
  let x = left;
  let rowTop = terr.d / 2 - GAP;
  let rowDepth = 0;
  let rowBand: number | null = null;
  const poses: Record<InstanceId, Pose> = {};
  for (const u of movable) {
    // A new row when the unit lay in another row before (lands behind creatures stay behind), or when it is full.
    const b = Math.round(u.local.y / band);
    const newBand = rowBand !== null && b !== rowBand;
    rowBand = b;
    if (x > left && (newBand || x + u.w > right)) {
      x = left;
      rowTop -= rowDepth + GAP;
      rowDepth = 0;
    }
    const lx = x + u.w / 2;
    const ly = rowTop - CARD.h / 2;
    x += u.w + GAP;
    rowDepth = Math.max(rowDepth, u.depth);
    const target = rotateCw(lx, ly, angle);
    const nx = round(terr.x + target.x);
    const ny = round(terr.y + target.y);
    const dx = nx - u.root.pose.x;
    const dy = ny - u.root.pose.y;
    poses[u.root.id] = { x: nx, y: ny, rot: u.root.pose.rot };
    for (const m of u.members) poses[m.id] = { x: round(m.pose.x + dx), y: round(m.pose.y + dy), rot: m.pose.rot };
  }
  return poses;
}
