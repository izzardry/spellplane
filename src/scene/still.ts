/**
 * The soft arena still behind Home (journey.md J1; contracts.md Part G "Visual" item 1): one frame of the empty arena in
 * the viewer's look, halved down on 2D canvases and box-blurred by pixel loops, never a CSS or canvas filter. Stub by
 * M8-C: resolves null, so the shell shows the look's gradient. M7-P1 owns the file.
 */
import type { Theme } from '../themes/types';

/** Render the empty arena of `theme` as a soft still `width` px wide; null when WebGL is unavailable (stub: always null). */
export function renderArenaStill(_theme: Theme, _opts: { width: number }): Promise<Blob | null> {
  return Promise.resolve(null);
}
