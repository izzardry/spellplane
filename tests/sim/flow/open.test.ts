/**
 * The open formats through the networked session (PLAN M2-P7 wiring of M2-P3: docs/gates/M2-parked-m2-p3.md, "What a
 * retry should do first" step 2): Rochester on the shared table, Winston with its private pile looks over the session's
 * `draftCards` seam (DraftHost.sendCards/onCards on net/draftcards.ts, `confirmedState` on the engine's, `drive()` when
 * a peer comes back) and Grid, each from the lobby to the builder on its own, with a reload during the draft. The
 * pools end where the table counts them, and the Winston non-dealer's pool covers every card it took.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LobbySettings } from '../../../src/core/types';
import { mulberry32 } from '../../../src/util/prng';
import { closeAll, FAKE_TIMERS, net, until, waitConverged, type Browser } from '../session/harness';
import { both, openFormatBot, reload, seatedPair, stageIs, startDraft } from './evening';

vi.mock('../../../src/net/identity', async () => (await import('../net/fake-identity')).fakeIdentityModule);

let browsers: Browser[] = [];
beforeEach(() => {
  vi.useFakeTimers(FAKE_TIMERS);
});
afterEach(() => {
  closeAll(browsers);
  browsers = [];
  vi.useRealTimers();
});

const CASES: [string, LobbySettings][] = [
  ['Rochester, one pack each', { draft: { format: 'rochester', packs: 1, burn: 0 }, sets: ['M19'], pickTimer: false }],
  ['Winston, two packs', { draft: { format: 'winston', packs: 2 }, sets: ['M19'], pickTimer: false }],
  ['Grid, three grids', { draft: { format: 'grid', grids: 3 }, sets: ['M19'], pickTimer: false }],
];

describe('the open formats run from the lobby to the builder through the session', () => {
  it.each(CASES)('%s, with Ben reloading half way', async (_name, lobby) => {
    const network = net({ seed: 5 });
    const e = await seatedPair(network, browsers);
    await startDraft(e, lobby);
    const rand = mulberry32(9);
    let reloaded = false;
    for (let t = 0; t < 600_000 && !both(e).every((s) => s.engine.confirmedState().stage === 'build'); t += 20) {
      openFormatBot(both(e), rand);
      if (!reloaded && (e.B.session!.engine.confirmedState().draft?.pools.s1 ?? 0) >= 3) {
        reloaded = true;
        await reload(network, e.B);
      }
      await vi.advanceTimersByTimeAsync(20);
    }
    expect(reloaded).toBe(true);
    await stageIs(e, 'build');
    await waitConverged(both(e), 'the end of the draft');
    const st = e.A.session!.engine.confirmedState();
    const d = st.draft!;
    expect(d.done).toBe(true);
    for (const [s, seat] of [
      [e.A.session!, 's0'],
      [e.B.session!, 's1'],
    ] as const) {
      // The pool catches up with what the table counts (a Winston card shown after the last look included).
      await until(() => (s.secrets().pool?.length ?? 0) === d.pools[seat], 30_000, `${seat}'s pool`);
      expect(d.pools[seat]).toBeGreaterThan(0);
      if (d.taken) expect(d.taken[seat]).toHaveLength(d.pools[seat]!);
      expect(s.draft!.build()!.cards).toHaveLength(d.pools[seat]!);
    }
  }, 240_000);
});
