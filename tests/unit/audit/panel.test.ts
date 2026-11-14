/** The audit panel opens by itself for a game it has not seen (ui/audit/panel.ts; M5-P2, audit round 1). */
import { describe, expect, it } from 'vitest';
import { gamesSeen } from '../../../src/ui/audit/panel';

describe('the audit panel', () => {
  it('opens for a newly finished game, not for a game it already knew', () => {
    expect(gamesSeen(0, 1)).toEqual({ seen: 1, opens: true });
    expect(gamesSeen(1, 1)).toEqual({ seen: 1, opens: false });
    expect(gamesSeen(1, 2)).toEqual({ seen: 2, opens: true });
  });

  it('still opens for the next game after the list of games shrank (another table, another history)', () => {
    let s = gamesSeen(3, 0);
    expect(s).toEqual({ seen: 0, opens: false });
    s = gamesSeen(s.seen, 1);
    expect(s).toEqual({ seen: 1, opens: true });
  });
});
