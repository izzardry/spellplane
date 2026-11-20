/**
 * Leak tests of rejoin (contracts.md Part A and Part G "Rejoin" item 8; persistence.md section 9). Owner: M8-P5
 * replaces each todo with a scenario that is shown to fail when its leak is injected.
 */
import { describe, it } from 'vitest';

describe('rejoin leaks (M8-P5)', () => {
  it.todo('PL-1');
  it.todo('PL-2');
  it.todo('PL-3');
  it.todo('PL-4');
  it.todo('PL-6');
  it.todo('PL-7: a split, both sides advance, the copy with more moves wins, own actions replayed');
  it.todo("PL-9: 2HG with team B away: an opponent's seatInvite is refused; a claimed seat gets no teamHand until the teammate confirms");
});
