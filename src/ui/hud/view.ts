/** The View control's model (docs/design/m8/m7-adjustments.md, M7-P2 "HUD layout": the View control). Pure. */
import type { Tilt, TiltPreset } from '../../scene/types';

/** Pixels of vertical drag for the whole tilt range. */
export const SCRUB_RANGE_PX = 200;

/**
 * The preset after the one nearest to `tilt`, in order first person → middle → bird's-eye → first person. A tilt
 * between two presets counts as the nearer one.
 */
export function nextPreset(presets: readonly TiltPreset[], tilt: Tilt): TiltPreset {
  if (presets.length === 0) throw new Error('no tilt presets');
  let near = 0;
  presets.forEach((p, i) => {
    if (Math.abs(p.tilt - tilt) < Math.abs(presets[near]!.tilt - tilt)) near = i;
  });
  return presets[(near + 1) % presets.length]!;
}
