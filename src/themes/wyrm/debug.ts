/**
 * The Wyrm part of the debug hook (`window.__spellplane.wyrm`, dev and test builds; CLAUDE.md: engine behaviour is
 * asserted on the debug hook, never on pixels): what each live Wyrm build draws now: embers, the heat shimmer and its
 * screen region, and the quality level it runs at. Registered by the theme's build; a production build registers
 * nothing (util/debug.ts).
 */
import type { QualityId } from '../types';
import { registerDebug } from '../../util/debug';

/** One live Wyrm build as the debug hook reports it. */
export interface WyrmDebugInstance {
  /** The quality level the build runs at (themes/types.ts QualityLevel.id). */
  quality: QualityId;
  reducedMotion: boolean;
  /** Whether this build has a post-processing pipeline (the table does, the draft and builder surfaces do not). */
  post: boolean;
  embers: { count: number; visible: boolean; time: number };
  shimmer: {
    /** Quality and reduced motion allow it. */
    allowed: boolean;
    /** 0..1, fading toward `target`. */
    strength: number;
    target: number;
    /** The stack lane's centre in table mm while the stack holds items. */
    focus: { x: number; y: number } | null;
    /** The pass is in the post chain now. */
    inChain: boolean;
    /** The wavering ellipse in CSS px of the page (centre and half axes), null while there is none. */
    region: { x: number; y: number; rx: number; ry: number } | null;
    /** The shimmer's own clock, s. */
    time: number;
  } | null;
  /** The slab's tile size, its map count and their anisotropic filtering in effect (the quality level's, clamped to the GPU's maximum). */
  slab: { tileMm: number; textures: number; anisotropy: number };
}

export interface WyrmDebug {
  instances(): WyrmDebugInstance[];
}

declare module '../../util/debug' {
  interface DebugParts {
    /** Added by M4-P4 (themes/wyrm/debug.ts). */
    wyrm: WyrmDebug;
  }
}

const live = new Set<() => WyrmDebugInstance>();

/** Report a live build until the returned function is called (on dispose). */
export function trackWyrm(report: () => WyrmDebugInstance): () => void {
  live.add(report);
  registerDebug({ wyrm: { instances: () => [...live].map((r) => r()) } });
  return () => {
    live.delete(report);
  };
}

/** Live builds (tests in Node, where there is no window). */
export function wyrmInstances(): WyrmDebugInstance[] {
  return [...live].map((r) => r());
}
