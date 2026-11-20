/**
 * The zones a theme marks in its own style (themes/types.ts TableMarks; PLAN M7-P1 Table worlds: "pile and zone marks
 * (library, graveyard, exile, command) in the look's style … seat colours with shapes"). The same zones the scene's
 * hairlines and labels mark (scene/layout.ts `markings`): every seat in use, its squared piles, its command area and,
 * for a named chair, its avatar spot. Pure, so it is unit-testable in Node. Added by M7-P1.
 */
import type { GameDefinition, TableLayout } from '../games/types';
import type { TableMarks } from '../themes/types';
import { pileAnchor } from './layout';

/** One chair as the marks need it: its index (the layout's seat), its seat colour, and whether someone sits in it. */
export interface MarkSeat {
  index: number;
  colour: number;
  named: boolean;
}

/** The marks of `layout` for the seats in use, as the viewer at `viewerAngle` sees them (canonical table frame). */
export function tableMarks(layout: TableLayout, game: GameDefinition, viewerAngle: number, seats: readonly MarkSeat[]): TableMarks {
  const marks: TableMarks = { seats: [], piles: [], areas: [], viewerAngle };
  const inUse = Math.max(1, seats.length);
  const squared = game.zones.filter((z) => z.scope === 'seat' && z.presentation === 'squared');
  const area = game.zones.find((z) => z.presentation === 'area');
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
      const a = pileAnchor(sl, z.id);
      if (a) marks.piles.push({ seat: sl.index, zone: z.id, x: a.x, y: a.y, rot: a.rot });
    }
    if (area) {
      const c = sl.zones.command;
      marks.areas.push({ seat: sl.index, zone: area.id, rect: { x: c.x, y: c.y, w: c.w, d: c.d, rot: c.rot } });
    }
  });
  return marks;
}
