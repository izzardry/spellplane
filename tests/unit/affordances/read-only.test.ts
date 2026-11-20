/**
 * PLAN Milestone 8, M7-P5 "Read-only" (m7-adjustments.md D14): a read-only table "shows no coach mark", and what changes
 * on it meanwhile (other players' moves while the game waits, a catch-up) teaches nothing: after it the marks carry on
 * from the table as it is then. The scene's side (no drag, tap, pile action, line, strip anchor) is tests/e2e/nokeys/
 * read-only.spec.ts.
 */
import { describe, expect, it } from 'vitest';
import { CoachController, NO_FACTS, type CoachFacts } from '../../../src/ui/hints/coach';
import { MemorySettings } from '../../../src/ui/fakes';

const f = (over: Partial<CoachFacts>): CoachFacts => ({ ...NO_FACTS, playing: true, myTurn: true, ...over });

describe('coach marks on a read-only table', () => {
  it('no mark shows while read-only; it returns when the table is open again', async () => {
    const c = new CoachController(new MemorySettings({}));
    await c.load();
    c.update(f({ library: 60 }));
    expect(c.current()).toBe('coachDraw');
    c.pause(true);
    expect(c.current()).toBeNull();
    c.update(f({ library: 60 }));
    expect(c.current()).toBeNull();
    c.pause(false, f({ library: 60 }));
    expect(c.current()).toBe('coachDraw');
  });

  it('changes while read-only mark nothing done, and resuming on a changed table marks nothing done either', async () => {
    const c = new CoachController(new MemorySettings({}));
    await c.load();
    c.update(f({ library: 60 }));
    c.pause(true);
    // Seven cards arrive in hand while the table waits (a catch-up): that is not the player's first draw.
    c.update(f({ library: 53, hand: 7 }));
    c.pause(false, f({ library: 53, hand: 7 }));
    expect(c.done()).toEqual([]);
    // The player's own draw afterwards is.
    c.update(f({ library: 52, hand: 8 }));
    expect(c.done()).toContain('coachDraw');
  });
});
