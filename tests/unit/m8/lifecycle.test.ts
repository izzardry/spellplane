/** M8-C: the lifecycle counters (contracts.md Part C; src/util/lifecycle.ts). */
import { afterEach, describe, expect, it } from 'vitest';
import { live, reportResidue, residue, resetLifecycleForTests, track, untrack } from '../../../src/util/lifecycle';

afterEach(() => resetLifecycleForTests());

describe('lifecycle counters', () => {
  it('track is idempotent per object; untrack releases; residue sums disposals', () => {
    const a = {};
    const b = {};
    track('engines', a);
    track('engines', a);
    track('engines', b);
    expect(live().engines).toBe(2);
    untrack('engines', a);
    untrack('engines', a);
    expect(live().engines).toBe(1);
    expect(live().contexts).toBe(0);
    reportResidue({ geometries: 0, textures: 1, programs: 0 });
    reportResidue({ geometries: 0, textures: 0, programs: 0 });
    expect(residue()).toEqual({ geometries: 0, textures: 1, programs: 0, disposals: 2 });
  });
});
