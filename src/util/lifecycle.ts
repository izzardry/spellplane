/**
 * Lifecycle counters (contracts.md Part C; PLAN M8-C "Lifecycle counters"): what this page holds alive, by kind, so
 * tests can assert that tables mounted and disposed many times per page load leave nothing behind. On Home every count
 * is 0 and `residue()` is all zeros. Implemented by M8-C; owners keep the `track` / `untrack` calls in their files true.
 * Pure bookkeeping: no DOM, no timers.
 */

/** The kinds of long-lived things counted (contracts.md Part C). `timers` is for long-lived intervals a module owns. */
export type LifeKind = 'contexts' | 'sessions' | 'engines' | 'transports' | 'audioContexts' | 'workers' | 'rafLoops' | 'botRunners' | 'timers';

/** Every kind, in a fixed order. */
export const LIFE_KINDS: readonly LifeKind[] = ['contexts', 'sessions', 'engines', 'transports', 'audioContexts', 'workers', 'rafLoops', 'botRunners', 'timers'];

const alive: Record<LifeKind, Set<object>> = Object.fromEntries(LIFE_KINDS.map((k) => [k, new Set<object>()])) as Record<LifeKind, Set<object>>;
const left = { geometries: 0, textures: 0, programs: 0, disposals: 0 };

/** Count `what` as alive under `kind`; idempotent per object. */
export function track(kind: LifeKind, what: object): void {
  alive[kind].add(what);
}

/** Count `what` as released; releasing an object that is not counted does nothing. */
export function untrack(kind: LifeKind, what: object): void {
  alive[kind].delete(what);
}

/** The current count per kind. */
export function live(): Readonly<Record<LifeKind, number>> {
  return Object.fromEntries(LIFE_KINDS.map((k) => [k, alive[k].size])) as Record<LifeKind, number>;
}

/** Called by a renderer's owner right after renderer.dispose(): what info.memory and info.programs still held. */
export function reportResidue(r: { geometries: number; textures: number; programs: number }): void {
  left.geometries += r.geometries;
  left.textures += r.textures;
  left.programs += r.programs;
  left.disposals += 1;
}

/** Sums since load (contracts.md Part C): what disposed renderers still held, and how many were disposed. */
export function residue(): { geometries: number; textures: number; programs: number; disposals: number } {
  return { ...left };
}

/** Forget everything (unit tests only). */
export function resetLifecycleForTests(): void {
  for (const k of LIFE_KINDS) alive[k].clear();
  left.geometries = left.textures = left.programs = left.disposals = 0;
}
