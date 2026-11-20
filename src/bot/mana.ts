/**
 * Paying a cost with untapped own lands, one mana each (computer.md 5.4, "Paying"): coloured symbols first, each from
 * the land with the fewest colours that can pay it; then generic from the lands whose colours the rest of the hand
 * needs least. No mana abilities other than lands. Pure and deterministic (ties by card id).
 */
import type { InstanceId } from '../core/types';
import type { Colour, ManaCost } from './types';
import { COLOURS } from './types';

export interface ManaSource {
  id: InstanceId;
  produces: readonly Colour[];
}

const byId = (a: ManaSource, b: ManaSource): number => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/**
 * The lands to tap for `cost`, or null when the lands cannot pay it. `need` weighs how much the rest of the hand wants
 * each colour (higher: keep that land untapped).
 */
export function pay(cost: ManaCost, lands: readonly ManaSource[], need: Partial<Record<Colour, number>> = {}): InstanceId[] | null {
  const free = [...lands].sort(byId);
  const used = new Set<InstanceId>();
  for (const c of COLOURS) {
    for (let i = 0; i < (cost.colours[c] ?? 0); i++) {
      const can = free.filter((l) => !used.has(l.id) && l.produces.includes(c));
      if (can.length === 0) return null;
      can.sort((a, b) => a.produces.length - b.produces.length || byId(a, b));
      used.add(can[0]!.id);
    }
  }
  const weight = (l: ManaSource): number => l.produces.reduce((n, c) => n + (need[c] ?? 0), 0);
  const rest = free.filter((l) => !used.has(l.id)).sort((a, b) => weight(a) - weight(b) || a.produces.length - b.produces.length || byId(a, b));
  if (rest.length < cost.generic) return null;
  for (const l of rest.slice(0, cost.generic)) used.add(l.id);
  return free.filter((l) => used.has(l.id)).map((l) => l.id);
}

/** Whether `cost` can be paid at all. */
export function canPay(cost: ManaCost, lands: readonly ManaSource[]): boolean {
  return pay(cost, lands) !== null;
}
