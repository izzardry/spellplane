/** The plain notices of leaving and of a repaired fork (persistence.md sections 5 and 6; contracts.md Part G item 2). */
import { describe, expect, it } from 'vitest';
import { ADOPT_LOG_LINE, ADOPT_NOTICE, adoptNotice, leftNotice, playersLine } from '../../../src/session/divergence';

describe('divergence notices', () => {
  it('a copy that replayed own moves on top gets the one plain line; one that lost only sequencer records gets none', () => {
    expect(adoptNotice({ forkSeq: 40, abandonedOwn: 3, from: 'peer-b' })).toBe(ADOPT_NOTICE);
    expect(ADOPT_NOTICE).toBe("The table with more moves is kept; the other side's moves are played again on top where they still fit.");
    expect(adoptNotice({ forkSeq: 40, abandonedOwn: 0, from: 'peer-b' })).toBeNull();
  });
  it('a player who left on purpose', () => {
    expect(leftNotice('Ben')).toBe('Ben left. The game goes on; Ben can come back.');
    expect(leftNotice(' ')).toBe('A player left. The game goes on; A player can come back.');
  });
  it("the engine's fork repair reaches the players' log in their words, as information (gate M8 N12)", () => {
    expect(playersLine('warn', "history diverged at seq 65: taking over the sequencer's history from there.")).toEqual({ level: 'info', text: ADOPT_LOG_LINE });
    expect(playersLine('warn', "history diverged at or before seq 12: taking over the sequencer's history from there.")).toEqual({ level: 'info', text: ADOPT_LOG_LINE });
    expect(ADOPT_LOG_LINE).not.toMatch(/seq|sequencer|diverged/);
    expect(playersLine('warn', 'Integrity warning: Ben showed this browser card x')).toEqual({ level: 'warn', text: 'Integrity warning: Ben showed this browser card x' });
  });
});
