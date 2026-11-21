/**
 * The shell's arena stills, one per theme in use, kept for the page as object URLs (journey.md J1: "One still is kept
 * in memory per look in use"): a return from a table shows the cached still instead of drawing it again with a
 * temporary renderer. M8-P2.
 */
import { renderArenaStill } from '../../scene/still';
import type { Theme } from '../../themes/types';

const stills = new Map<string, Promise<string | null>>();

/** Whether the still of `theme` was drawn (or is being drawn) on this page. */
export function hasStill(theme: Theme): boolean {
  return stills.has(theme.id);
}

/** The object URL of `theme`'s still, drawn at `width` the first time it is asked for; null when none can be drawn. */
export function stillUrlOf(theme: Theme, width: number): Promise<string | null> {
  let drawn = stills.get(theme.id);
  if (!drawn) {
    drawn = renderArenaStill(theme, { width }).then(
      (b) => (b ? URL.createObjectURL(b) : null),
      () => null,
    );
    stills.set(theme.id, drawn);
  }
  return drawn;
}
