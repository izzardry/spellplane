/** Tables for the accessibility tests: a real createTable with cards placed straight into shared state (plain JSON). */
import { createTable } from '../../../src/core/reducer';
import type { CardInstance, Format, Pose, TableState } from '../../../src/core/types';
import { mtg } from '../../../src/games/mtg/index';

export const game = mtg;

const NAMES = ['Anna', 'Ben', 'Cleo', 'Dan'];

export function table(format: Format = '1v1'): TableState {
  const n = format === '1v1' ? 2 : format === 'ffa3' ? 3 : 4;
  return createTable({ game: mtg, format, seats: NAMES.slice(0, n).map((name, colour) => ({ name, colour })) });
}

export interface Place {
  id: string;
  zone: string;
  owner?: string;
  pose?: Pose;
  tapped?: boolean;
  face?: 'up' | 'down';
  counters?: Record<string, number>;
  combat?: 'attack' | 'block';
  note?: string;
  attachedTo?: string;
}

/** Put cards into zones (appended in the given order; hidden zones kept sorted as shared state keeps them). */
export function withCards(state: TableState, places: Place[]): TableState {
  const s: TableState = JSON.parse(JSON.stringify(state)) as TableState;
  for (const p of places) {
    const owner = p.owner ?? p.zone.split(':')[1] ?? 's0';
    const card: CardInstance = {
      id: p.id,
      owner,
      controller: owner,
      zone: p.zone,
      face: p.face ?? (p.zone.startsWith('library') || p.zone.startsWith('hand') ? 'down' : 'up'),
      faceIndex: 0,
      tapped: p.tapped ?? false,
      pose: p.pose ?? { x: 0, y: 0, rot: 0 },
      counters: p.counters ?? {},
      ...(p.combat ? { combat: p.combat } : {}),
      ...(p.note ? { note: p.note } : {}),
      ...(p.attachedTo ? { attachedTo: p.attachedTo } : {}),
    };
    s.cards[p.id] = card;
    const z = s.zones[p.zone]!;
    z.ids.push(p.id);
    if (z.visibility !== 'public') {
      z.ids.sort();
      z.count = z.ids.length;
    }
  }
  return s;
}

/** Remove a card from the table. */
export function without(state: TableState, id: string): TableState {
  const s: TableState = JSON.parse(JSON.stringify(state)) as TableState;
  const c = s.cards[id]!;
  const z = s.zones[c.zone]!;
  z.ids = z.ids.filter((x) => x !== id);
  if (z.visibility !== 'public') z.count = z.ids.length;
  delete s.cards[id];
  return s;
}

/** Names as the HUD would give them: the test's own known names, "Hidden card" otherwise. */
export function namer(known: Record<string, string>): (id: string) => string {
  return (id) => known[id] ?? 'Hidden card';
}
