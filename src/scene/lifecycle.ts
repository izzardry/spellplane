/**
 * The scene side of the lifecycle counters (contracts.md Part C; m7-adjustments.md section 2): a renderer's WebGL
 * context is counted while it lives, and what its `info` still held after dispose is reported. Re-exports the context
 * functions of src/util/lifecycle.ts. Contracts.md Part C (M8-C's shape); owned by M7-P1.
 */
import { live, reportResidue, residue, track, untrack } from '../util/lifecycle';
import { registerDebug } from '../util/debug';
import type { RenderDebug, RenderMemory, RenderStats } from './types';

/** The part of a THREE.WebGLRenderer the counters read. */
export interface CountedRenderer {
  info: { memory: { geometries: number; textures: number }; programs: readonly unknown[] | null };
}

/** Count a renderer's WebGL context as live. */
export function trackContext(renderer: object): void {
  track('contexts', renderer);
}

/** Count it released, and report what its `info` still held (call right after renderer.dispose()). */
export function untrackContext(renderer: CountedRenderer): void {
  const info = renderer.info;
  reportResidue({ geometries: info.memory.geometries, textures: info.memory.textures, programs: info.programs?.length ?? 0 });
  untrack('contexts', renderer);
}

/** WebGL contexts alive now (RenderDebug.liveContexts). */
export function liveContexts(): number {
  return live().contexts;
}

/** `{ ...residue(), ...live() }` (contracts.md Part C). */
export function renderMemory(): RenderMemory {
  return { ...residue(), ...live() };
}

/** The lifecycle members of the render debug part (RenderDebug.liveContexts, memory). */
export function lifecycleRender(): Pick<Required<RenderDebug>, 'liveContexts' | 'memory'> {
  return { liveContexts, memory: renderMemory };
}

/**
 * The render part while no table scene is mounted (Home, Decks, History): the lifecycle members, and empty stats. A
 * table scene replaces it while mounted and puts it back on dispose (contracts.md Part C: on Home every count is 0).
 */
export function registerBaseRender(): void {
  const empty = { triangles: 0, textures: 0, geometries: 0, programs: 0, passes: [], shadows: false, quality: 'high', theme: 'plain' } as unknown as RenderStats;
  const base: RenderDebug = { stats: () => empty, quality: () => 'high', setQuality: () => undefined, framesDrawn: () => 0, ...lifecycleRender() };
  if (typeof window === 'undefined') return;
  const hook = window.__spellplane as { render?: RenderDebug } | undefined;
  if (!hook?.render) registerDebug({ render: base });
}
