/**
 * The outline of a stack entry (scene/stack.ts entryOutline): the controller's seat colour at rest, the theme's
 * pending treatment while a confirmation round waits (themes/signals.ts pendingConfirmation is styled by
 * `cardDressing.pending`). Integration of M4-P5: Stonetable's thin seat-coloured ring alone did not tell a waiting item
 * from a finished one on the stone.
 */
import { describe, expect, it } from 'vitest';
import { ENTRY_OUTLINE_MM, entryOutline } from '../../../src/scene/stack';
import { THEME_IDS, loadTheme } from '../../../src/themes/index';

describe('stack entry outline', () => {
  it('is the seat colour at the base width while nothing waits', () => {
    expect(entryOutline(false, '#123456', { pending: { colour: '#ffbe55', width: 1.6, lift: 0 } }, 1)).toEqual({ colour: '#123456', width: ENTRY_OUTLINE_MM });
  });

  it('takes the theme’s pending colour and pulses wider while the round waits', () => {
    const dressing = { pending: { colour: '#ffbe55', width: 1.6, lift: 0 } };
    expect(entryOutline(true, '#123456', dressing, 1)).toEqual({ colour: '#ffbe55', width: ENTRY_OUTLINE_MM + 1.4 });
    expect(entryOutline(true, '#123456', dressing, 0).width).toBe(ENTRY_OUTLINE_MM);
  });

  it('every registered theme states a pending colour apart from its seat colour 0', async () => {
    for (const id of THEME_IDS) {
      const theme = await loadTheme(id);
      const seat = theme.tokens.colours.seats[0]!.colour;
      expect(entryOutline(true, seat, theme.cardDressing, 1).colour.toLowerCase(), theme.id).not.toBe(seat.toLowerCase());
    }
  });
});
