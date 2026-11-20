// PLAN Milestone 7, M7-P4 Card feel: "hand cards fan and make room as a card passes over the hand". The fan opens a gap
// where the dragged card is: the cards whose centre is left of the pointer slide left, the others right; the gap
// follows the pointer card by card and closes when the card leaves (util/feel.ts handRoom null).
import { describe, expect, it } from 'vitest';
import { fanLayout } from '../../../src/ui/hand';
import { ROOM_FRACTION, roomIndex, roomShift } from '../../../src/ui/hand-room';
import { handRoom } from '../../../src/util/feel';

describe('the hand fan making room', () => {
  const boxes = fanLayout(5, 1440, 900);
  const w = boxes[0]!.width;
  const centre = (i: number) => boxes[i]!.left + boxes[i]!.width / 2;

  it('opens the gap before the first card right of the pointer: at the ends and between any two cards', () => {
    expect(roomIndex(boxes, 0)).toBe(0);
    expect(roomIndex(boxes, 1440)).toBe(5);
    for (let i = 0; i < 4; i++) expect(roomIndex(boxes, (centre(i) + centre(i + 1)) / 2)).toBe(i + 1);
    expect(roomIndex([], 500)).toBe(0);
  });

  it('cards left of the gap slide left and the others right, by half the gap each; no gap, no shift', () => {
    const half = (w * ROOM_FRACTION) / 2;
    expect([0, 1, 2, 3, 4].map((i) => roomShift(i, 2, w))).toEqual([-half, -half, half, half, half]);
    expect(roomShift(3, null, w)).toBe(0);
    expect(roomShift(0, 0, w)).toBe(half);
    expect(roomShift(1, 1, 0)).toBe(0);
  });

  it('the channel reports a change once and the scene clears it when the card leaves', () => {
    const seen: (number | null)[] = [];
    const off = handRoom.subscribe((x) => seen.push(x));
    handRoom.set(400);
    handRoom.set(400);
    handRoom.set(410);
    handRoom.set(null);
    off();
    handRoom.set(500);
    handRoom.set(null);
    expect(seen).toEqual([400, 410, null]);
  });
});
