/**
 * Renderer switches for measuring (M7-A0): each turns one of the frame-rate remedies off, or forces a setting, so
 * scripts/perf/measure.mjs can put a number on each (`--query render=noadapt`). URL flag `?render=a,b` (util/flags.ts),
 * every build, so the owner can try one in Safari on the live preview too. Unknown names are ignored.
 *
 *   noadapt    no adaptive resolution (scene/resolution.ts): always the quality level's pixel ratio
 *   nostill    a still lit theme (Dusk) draws every frame again, as before M7-A0
 *   shadowall  shadow maps are drawn on every frame, ambient-only ones included
 *   sync       wait for the GPU after each frame, so the meter's draw time includes the GPU's work (headless browsers
 *              do not hold animation frames back for the GPU; this costs frame rate and is for measuring only)
 *   aa / noaa  force the canvas's antialiasing on or off (default: on)
 *   pr=<n>     cap the pixel ratio at n (0.5 to 3), for every theme and level
 */
import { flags } from '../util/flags';

export interface RenderSwitches {
  adapt: boolean;
  still: boolean;
  shadowSkip: boolean;
  sync: boolean;
  antialias: boolean | null;
  pixelRatioCap: number | null;
}

export function parseRenderSwitches(names: readonly string[]): RenderSwitches {
  const on = new Set(names);
  const pr = names.find((n) => n.startsWith('pr='));
  const cap = pr ? Number(pr.slice(3)) : NaN;
  return {
    adapt: !on.has('noadapt'),
    still: !on.has('nostill'),
    shadowSkip: !on.has('shadowall'),
    sync: on.has('sync'),
    antialias: on.has('noaa') ? false : on.has('aa') ? true : null,
    pixelRatioCap: Number.isFinite(cap) && cap >= 0.5 && cap <= 3 ? cap : null,
  };
}

/** The switches of this page. */
export function renderSwitches(): RenderSwitches {
  return parseRenderSwitches(flags().render);
}
