/**
 * The zones a theme marks in its own style (themes/types.ts TableMarks; PLAN M7-P1 Table worlds: "pile and zone marks
 * (library, graveyard, exile, command) in the look's style … seat colours with shapes"). The same zones the scene's
 * hairlines and labels mark (scene/layout.ts `markings`): every seat in use, its squared piles, its command area and,
 * for a named chair, its avatar spot. Pure, so it is unit-testable in Node. Added by M7-P1.
 *
 * Marks only where used (docs/design/m8/m7-adjustments.md, M7-P1, change 3; m7-hud-proposal): the library and graveyard
 * slots are always marked; every other pile slot (exile), the command area and the stack lane only while they hold a
 * card or a dragged card is within MARK_NEAR_MM of them. `optionalZones` lists those zones with their rectangles,
 * `shownZones` picks the ones to show, and the scene passes only those marks on (`tableMarks`' `shown`, and a game
 * reduced by `markedGame` to the hairline `markings`).
 */
import type { TableState } from '../core/types';
import type { GameDefinition, Rect, TableLayout } from '../games/types';
import type { TableMarks } from '../themes/types';
import { pileAnchor, pileLabelPlace, type Marking } from './layout';
import { CARD_H, CARD_W, rectPoint, rot2 } from './math';
import type { TablePoint } from './types';

/** One chair as the marks need it: its index (the layout's seat), its seat colour, and whether someone sits in it. */
export interface MarkSeat {
  index: number;
  colour: number;
  named: boolean;
}

/** Pile slots marked whether or not they hold a card. */
export const ALWAYS_MARKED: ReadonlySet<string> = new Set(['library', 'graveyard']);
/** A dragged card this close to an unmarked zone (mm, card centre to the zone's edge) shows its mark. */
export const MARK_NEAR_MM = 60;

/** A zone marked only while used: its state zone id (`exile:s0`, `command:s1`, `stack`), kind, seat index and rectangle. */
export interface OptionalZone {
  key: string;
  kind: string;
  seat: number | null;
  presentation: 'squared' | 'area' | 'cascade-lane';
  rect: Rect;
}

/** Whether zone kind `id` of `game` is marked only while used. */
export function isOptionalMark(game: GameDefinition, id: string): boolean {
  const z = game.zones.find((x) => x.id === id);
  if (!z) return false;
  if (z.presentation === 'squared') return z.scope === 'seat' && !ALWAYS_MARKED.has(z.id);
  return z.presentation === 'area' || z.presentation === 'cascade-lane';
}

/** The seat id of layout seat `index` in `state` (the seat whose index it is), or the default `s<index>`. */
function seatIdAt(state: TableState | null, index: number): string {
  if (state) for (const [id, s] of Object.entries(state.seats)) if (s.index === index) return id;
  return `s${index}`;
}

/** The zones of the table marked only while used, for the seats in use (canonical table frame; `angle` turns the lane). */
export function optionalZones(layout: TableLayout, game: GameDefinition, angle: number, seatsInUse: number, state: TableState | null = null): OptionalZone[] {
  const out: OptionalZone[] = [];
  layout.seats.slice(0, Math.max(1, seatsInUse)).forEach((sl) => {
    const sid = seatIdAt(state, sl.index);
    for (const z of game.zones) {
      if (z.scope !== 'seat' || !isOptionalMark(game, z.id)) continue;
      if (z.presentation === 'squared') {
        const a = pileAnchor(sl, z.id);
        if (a) out.push({ key: `${z.id}:${sid}`, kind: z.id, seat: sl.index, presentation: 'squared', rect: { x: a.x, y: a.y, w: CARD_W, d: CARD_H, rot: a.rot } });
      } else if (z.presentation === 'area') {
        out.push({ key: `${z.id}:${sid}`, kind: z.id, seat: sl.index, presentation: 'area', rect: { ...sl.zones.command } });
      }
    }
  });
  const lane = game.zones.find((z) => z.presentation === 'cascade-lane');
  if (lane) out.push({ key: lane.id, kind: lane.id, seat: null, presentation: 'cascade-lane', rect: { ...layout.stackLane, rot: layout.stackLane.rot + angle } });
  return out;
}

/** Distance in mm from `p` to the oriented rectangle `r` (0 inside it). */
export function rectDistance(p: TablePoint, r: Rect): number {
  const [lx, ly] = rot2(p.x - r.x, p.y - r.y, -r.rot);
  const dx = Math.max(0, Math.abs(lx) - r.w / 2);
  const dy = Math.max(0, Math.abs(ly) - r.d / 2);
  return Math.hypot(dx, dy);
}

/** Whether the zone `key` holds a card in `state` (the stack lane: any stack item too). */
export function zoneHolds(state: TableState | null, key: string, presentation: OptionalZone['presentation']): boolean {
  if (!state) return false;
  if (presentation === 'cascade-lane' && state.stack.length > 0) return true;
  const z = state.zones[key];
  return !!z && z.ids.length > 0;
}

/**
 * The keys of the optional zones to mark: those that hold a card, and those a dragged card (its centre, `dragged`) is
 * within MARK_NEAR_MM of.
 */
export function shownZones(zones: readonly OptionalZone[], state: TableState | null, dragged: readonly TablePoint[]): Set<string> {
  const shown = new Set<string>();
  for (const z of zones) {
    if (zoneHolds(state, z.key, z.presentation) || dragged.some((p) => rectDistance(p, z.rect) <= MARK_NEAR_MM)) shown.add(z.key);
  }
  return shown;
}

/** `game` without the optional zones: what the scene's hairline `markings` always mark. */
export function markedGame(game: GameDefinition): GameDefinition {
  return { ...game, zones: game.zones.filter((z) => !isOptionalMark(game, z.id)) };
}

/** Hairline segments (x1, y1, x2, y2 per segment) and labels of the shown optional zones, as scene/layout.ts `markings` draws them. */
export function optionalMarkings(
  zones: readonly OptionalZone[],
  shown: ReadonlySet<string>,
  layout: TableLayout,
  game: GameDefinition,
  angle: number,
): Marking {
  const segments: number[] = [];
  const labels: Marking['labels'] = [];
  for (const z of zones) {
    if (!shown.has(z.key)) continue;
    // Pile slots stand 2 mm clear of the card, as scene/layout.ts `markings` draws them.
    const margin = z.presentation === 'squared' ? 2 : 0;
    const label = (game.zones.find((x) => x.id === z.kind)?.label ?? z.kind).toUpperCase();
    const corners = [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ].map(([u, v]) => rectPoint(z.rect, u! * (z.rect.w / 2 + margin), v! * (z.rect.d / 2 + margin)));
    for (let i = 0; i < 4; i++) {
      const a = corners[i]!;
      const b = corners[(i + 1) % 4]!;
      segments.push(a.x, a.y, b.x, b.y);
    }
    if (z.presentation === 'squared') {
      const sl = layout.seats.find((s) => s.index === z.seat);
      const a = sl ? pileAnchor(sl, z.kind) : null;
      if (sl && a) labels.push({ key: `zl:${z.seat}:${z.kind}`, text: label, ...pileLabelPlace(sl, a, angle) });
    } else if (z.presentation === 'area') {
      const p = rectPoint(z.rect, 0, z.rect.d / 2 - 8);
      labels.push({ key: `zl:${z.seat}:${z.kind}`, text: label, x: p.x, y: p.y, rot: angle, anchorY: 'middle' });
    } else {
      const p = rectPoint(z.rect, 0, z.rect.d / 2 + 8);
      labels.push({ key: 'zl:stack', text: label, x: p.x, y: p.y, rot: angle, anchorY: 'middle' });
    }
  }
  return { segments, labels };
}

/**
 * The marks of `layout` for the seats in use, as the viewer at `viewerAngle` sees them (canonical table frame).
 * `shown` (the keys of `shownZones`) limits the optional zones; without it every zone is marked.
 */
export function tableMarks(layout: TableLayout, game: GameDefinition, viewerAngle: number, seats: readonly MarkSeat[], shown?: { keys: ReadonlySet<string>; state: TableState | null }): TableMarks {
  const marks: TableMarks = { seats: [], piles: [], areas: [], viewerAngle };
  const inUse = Math.max(1, seats.length);
  const squared = game.zones.filter((z) => z.scope === 'seat' && z.presentation === 'squared');
  const area = game.zones.find((z) => z.presentation === 'area');
  const visible = (kind: string, index: number): boolean => !shown || !isOptionalMark(game, kind) || shown.keys.has(`${kind}:${seatIdAt(shown.state, index)}`);
  layout.seats.slice(0, inUse).forEach((sl) => {
    const seat = seats.find((s) => s.index === sl.index);
    const t = sl.territory;
    marks.seats.push({
      index: sl.index,
      colour: seat?.colour ?? sl.index,
      territory: { x: t.x, y: t.y, w: t.w, d: t.d, rot: t.rot },
      avatar: seat?.named ? { x: sl.zones.avatar.x, y: sl.zones.avatar.y } : null,
      angle: sl.angle,
    });
    for (const z of squared) {
      if (!visible(z.id, sl.index)) continue;
      const a = pileAnchor(sl, z.id);
      if (a) marks.piles.push({ seat: sl.index, zone: z.id, x: a.x, y: a.y, rot: a.rot });
    }
    if (area && visible(area.id, sl.index)) {
      const c = sl.zones.command;
      marks.areas.push({ seat: sl.index, zone: area.id, rect: { x: c.x, y: c.y, w: c.w, d: c.d, rot: c.rot } });
    }
  });
  return marks;
}
