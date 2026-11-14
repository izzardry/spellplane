/**
 * Seat shapes and patterns beside seat colours (DESIGN "Input and interaction design", Accessibility: "Seat colours
 * are paired with a shape or pattern (line dash, avatar glyph), so nothing depends on hue alone"). The glyph and
 * pattern of a seat colour index are the same in every theme (themes/types.ts SeatColour: only the colours are tuned
 * per theme), so HUD parts that know only a seat's colour index draw its glyph from here (ui/a11y/SeatGlyph.svelte).
 */
import type { SeatGlyph, SeatPattern } from '../../themes/types';

/** The avatar glyph of each seat colour index, as every theme's `tokens.colours.seats[i].glyph`. */
export const SEAT_GLYPHS: readonly SeatGlyph[] = ['circle', 'square', 'triangle', 'diamond', 'star', 'hexagon', 'cross', 'ring'];

/** The line pattern of each seat colour index, as every theme's `tokens.colours.seats[i].pattern`. */
export const SEAT_PATTERNS: readonly SeatPattern[] = ['solid', 'dash', 'dot', 'dash-dot', 'long-dash', 'dash-dot-dot', 'double', 'zigzag'];

/** The glyph of a seat colour index (wrapping past eight, like the colours). */
export function seatGlyph(colour: number): SeatGlyph {
  const n = SEAT_GLYPHS.length;
  return SEAT_GLYPHS[((Math.floor(colour) % n) + n) % n]!;
}
