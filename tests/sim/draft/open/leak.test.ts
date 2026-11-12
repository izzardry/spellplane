/**
 * The Winston scenario of the shared leak test (CLAUDE.md: any code touching hidden information adds its scenario to
 * the shared leak test; DESIGN "Pre-game", Hidden information: Winston "pile contents visible to whoever looks";
 * "Specification: card data, packs and draft formats", Winston: "6 packs shuffled into one face-down stack"). Like
 * the earlier scenarios (tests/sim/secrecy, tests/sim/resume, tests/sim/session) it runs the shared scanner
 * (tests/leak/scan.ts, tests/leak/leak.ts `scanPairs`) over everything the observing browser holds or received.
 *
 * s0 deals (it holds the stack's identities); s1 is shown a pile only while it looks at it, and the cards it takes.
 * What s1 may know is derived here from the public log alone, independently of the driver's disclosure code: every
 * pile s1 looked at, at the moment it looked, and every card s1 took. Everything else of the dealer's packs (Scryfall
 * ids, salts, the instance-to-card mapping) and every pack-seed owner nonce must be absent from every message s1
 * received, from s1's shared state and from s1's secret store; and no state s1 ever held may tie a face-down card to
 * its pack (and so to the pack's set, or to what else the pack held). s0 receives no `draftCards` with cards at all.
 * The scenario runs once plainly and once with s1 lost twice while the dealer must show it a pile (the re-sends and
 * s1's requests must not show more).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { winstonDealt } from '../../../../src/core/open';
import { reduce } from '../../../../src/core/reducer';
import type { TableState } from '../../../../src/core/types';
import { scanPairs } from '../../../leak/leak';
import { scan } from '../../../leak/scan';
import { close, type DraftSeat } from './net';
import { allowedFor, winstonDraft, type WinstonRun } from './winston-run';

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
});
afterEach(() => {
  vi.useRealTimers();
});

/** No state s1 held lists a stack, pile or taken id next to a pack (its id, number or set). */
function expectNoPackMembership(b: DraftSeat, start: TableState): void {
  let s = start;
  let dealt = 0;
  for (const a of b.peer.log()) {
    s = reduce(s, a);
    const d = s.draft!;
    for (const p of Object.values(d.packs)) expect(p.commitment.instanceIds).toEqual([]);
    if (!winstonDealt(d.winston)) continue;
    dealt += 1;
    const packs = JSON.stringify(d.packs);
    for (const id of [...d.winston.stackIds, ...d.winston.pileIds.flat()]) expect(packs).not.toContain(id);
  }
  expect(dealt).toBeGreaterThan(0);
  // And no packOpen s1 received lists the ids of one pack: only the dealing one lists the whole stack.
  const opens = b.peer.log().flatMap((x) => (x.type === 'packOpen' ? [x] : []));
  expect(opens.slice(0, -1).every((x) => x.instanceIds === undefined)).toBe(true);
  expect(opens.at(-1)!.instanceIds!.length).toBe(opens.reduce((n, x) => n + x.count, 0));
}

function expectNoLeak(run: WinstonRun): void {
  const { t } = run;
  const [a, b] = t.seats as [DraftSeat, DraftSeat];
  const allowed = allowedFor(t, 's1');
  const generated = a.secrets().draft!.generated;
  const all = generated.flatMap((g) => g.cards);
  const hidden = all.filter((c) => !allowed.has(c.instanceId));
  // The scenario is meaningful: the dealer looked at piles s1 never saw, and s1 saw some piles it did not take.
  expect(hidden.length).toBeGreaterThan(10);
  expect([...allowed].filter((id) => !b.peer.state.draft!.taken!.s1!.includes(id)).length).toBeGreaterThan(0);

  const shownSids = new Set(all.filter((c) => allowed.has(c.instanceId)).map((c) => c.ref.sid));
  const tokens = [...hidden.flatMap((c) => [c.salt, ...(shownSids.has(c.ref.sid) ? [] : [c.ref.sid])]), ...generated.map((g) => g.ownerNonce)];
  const pairs = hidden.map((c) => ({ pair: [c.instanceId, c.ref.sid] as [string, string], why: 'mapping' as const }));
  const observed: unknown[] = [b.peer.received, b.peer.state, b.peer.log(), b.secrets(), b.driver.view()];
  expect(scan(observed, tokens)).toEqual([]);
  expect(scanPairs(observed, pairs)).toEqual([]);
  expectNoPackMembership(b, t.start);

  // Every draftCards message s1 received names allowed cards only; s0 receives requests only (no cards).
  const toB = b.peer.received.filter((m) => (m.msg as { t?: string }).t === 'draftCards');
  expect(toB.length).toBeGreaterThan(0);
  for (const m of toB) for (const c of (m.msg as { cards: { instanceId: string }[] }).cards) expect(allowed.has(c.instanceId)).toBe(true);
  const toA = a.peer.received.filter((m) => (m.msg as { t?: string }).t === 'draftCards');
  for (const m of toA) expect((m.msg as { cards: unknown[] }).cards).toEqual([]);
}

describe('Winston leak scenario', () => {
  it('the other player sees only the piles it looked at and the cards it took', async () => {
    const run = await winstonDraft(5, 6, { sets: ['M19', 'M20', 'M21'] });
    expectNoLeak(run);
    const [a, b] = run.t.seats as [DraftSeat, DraftSeat];
    const allowed = allowedFor(run.t, 's1');
    const hidden = a.secrets().draft!.generated.flatMap((g) => g.cards).filter((c) => !allowed.has(c.instanceId));

    // Negative control: one more card on the pair channel is caught by the same scan.
    const leaked = hidden[0]!;
    expect(a.host.sendCards!('s1', 'control', [leaked])).toBe(true);
    await vi.advanceTimersByTimeAsync(500);
    expect(scan([b.peer.received, b.secrets()], [leaked.salt]).length).toBeGreaterThan(0);
    // s1 kept it (it opens the stack's commitments), but its pool did not change: it did not take it.
    expect(b.secrets().pool).toHaveLength(b.peer.state.draft!.taken!.s1!.length);
    close(run.t);
  }, 120_000);

  it('re-sends and requests after the other player was lost show nothing more', async () => {
    const run = await winstonDraft(8, 6, { outages: true, sets: ['M19', 'M20'] });
    expect(run.outages).toMatchObject({ inFlight: true, offline: true });
    expectNoLeak(run);
    close(run.t);
  }, 120_000);
});
