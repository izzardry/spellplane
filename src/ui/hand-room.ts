/**
 * The hand fan making room (PLAN Milestone 7, Owner decisions after the first design round, Almost haptic card handling;
 * M7-P4: "hand cards fan and make room as a card passes over the hand"). While a card is dragged over the fan
 * (util/feel.ts handRoom, the pointer's x), the cards left of the pointer slide left and the others right, opening a
 * gap where the card is; a drop there puts it into the hand. Pure, in CSS pixels.
 */
import type { FanBox } from './hand';

/** Width of the gap the fan opens, as a fraction of a hand card's width. */
export const ROOM_FRACTION = 0.6;

/** The index the gap opens before: the number of cards whose centre is left of `x`. */
export function roomIndex(boxes: readonly FanBox[], x: number): number {
  let n = 0;
  for (const b of boxes) if (b.left + b.width / 2 < x) n++;
  return n;
}

/** How far card `i` slides sideways for a gap before `room` (null: none), CSS px. */
export function roomShift(i: number, room: number | null, cardWidth: number): number {
  if (room === null || !(cardWidth > 0)) return 0;
  const half = (cardWidth * ROOM_FRACTION) / 2;
  return i < room ? -half : half;
}
