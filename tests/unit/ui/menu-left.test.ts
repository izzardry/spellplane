// Gate M8 finding N2: a keyboard-opened menu stands beside its card, at the card's right, or at its left where the right
// has no room, rather than clamped back over the card.
import { describe, expect, it } from 'vitest';
import { menuLeft } from '../../../src/ui/menu';

describe('keyboard menu placement', () => {
  it('opens right of the card when it fits', () => {
    expect(menuLeft(1000, 220, 1440, 870)).toBe(1000);
  });
  it('opens left of the card when the right has no room', () => {
    // Card from 1080 to 1230 in a 1440 window; a 250 px menu would end at 1480.
    expect(menuLeft(1230, 250, 1440, 1080)).toBe(1080 - 250);
  });
  it('keeps the point when neither side has room, or without a card (the clamp then fits it)', () => {
    expect(menuLeft(300, 400, 600, 200)).toBe(300);
    expect(menuLeft(1300, 220, 1440, null)).toBe(1300);
  });
  it('counts the safe-area insets', () => {
    expect(menuLeft(950, 220, 1194, 800, 0, 40)).toBe(800 - 220);
    expect(menuLeft(950, 220, 1194, 800, 0, 0)).toBe(950);
  });
});
