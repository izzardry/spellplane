/**
 * The pick timer and peer loss in a pass draft on a simulated network (DESIGN "Specification: card data, packs and
 * draft formats": "Pick timer, when enabled: 45 s for the first pick of a pack, reduced by 3 s per pick to a floor of
 * 10 s; on expiry the marked card, or else the first card, is taken"; "Specification: network protocol and secrecy",
 * Timers: only the sequencer's clock decides; PLAN "Quality gates": delay, drop, reordering and peer loss).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { pickTimerMs } from '../../../../src/core/drafting';
import { reduce } from '../../../../src/core/reducer';
import type { TableState } from '../../../../src/core/types';
import { close, passNet, poolOf, randomBot, runDraft, visits, type PassSeat } from './net';

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
});
afterEach(() => {
  vi.useRealTimers();
});

describe('pick timer', () => {
  it('takes the marked card, or else the first card, on the sequencer clock, also while the holder is away', async () => {
    const t = await passNet(4, { format: 'pass', packs: 1, picks: 1 }, { net: { seed: 3, delay: { min: 0, max: 30 } }, sets: ['M19'], pickTimer: true });
    // s0 sequences; record when it applied each seq (its clock decides).
    const at = new Map<number, number>();
    t.seats[0]!.peer.onSequenced((a) => at.set(a.seq, Date.now()));
    const [, , c, d] = t.seats as [PassSeat, PassSeat, PassSeat, PassSeat];
    // s2 never picks; s3 marks the last card of every pack it holds and never confirms.
    c.idle = true;
    d.idle = true;
    const bot = randomBot(8);
    let killedAt = -1;
    let revived = false;
    await runDraft(
      t,
      (s) => {
        if (s === d) {
          const v = d.driver.view();
          if (v.pack !== null) d.driver.mark([v.pack.cards[v.pack.cards.length - 1]!.id]);
          return;
        }
        bot(s);
      },
      4_000_000,
      (ms) => {
        // s2 is away for two minutes once it holds a pack: the timer still takes its picks.
        if (killedAt < 0 && ms > 5_000 && (c.peer.state.draft!.queues.s2 ?? []).length > 0) {
          killedAt = ms;
          t.net.kill(c.peer.peerId);
        }
        if (killedAt >= 0 && !revived && ms - killedAt > 120_000) {
          revived = true;
          t.net.revive(c.peer.peerId);
        }
      },
      100,
    );
    expect(revived).toBe(true);
    const all = visits(t);
    const timeouts = all.filter((v) => v.kind === 'timeout');
    expect(timeouts.length).toBeGreaterThan(10);
    // Only the idle seats' picks time out; s2's while away too.
    expect(new Set(timeouts.map((v) => v.holder))).toEqual(new Set(['s2', 's3']));
    for (const v of all.filter((x) => x.holder === 's2' || x.holder === 's3')) expect(v.kind).toBe('timeout');
    for (const v of timeouts) {
      if (v.holder === 's2') expect(v.taken).toEqual(v.before.slice(0, 1));
      else expect(v.taken).toEqual(v.before.slice(-1));
    }
    // Each timeout came pickTimerMs(picks) after the pack reached the front of its holder's queue, by s0's clock.
    let s: TableState = t.start;
    for (const a of t.seats[0]!.peer.log()) {
      const before = s;
      s = reduce(s, a);
      if (a.type !== 'draftTimeout') continue;
      const pack = before.draft!.packs[a.packId]!;
      const waited = at.get(a.seq)! - at.get(pack.sinceSeq)!;
      expect(waited).toBeGreaterThanOrEqual(pickTimerMs(pack.picks));
      expect(waited).toBeLessThan(pickTimerMs(pack.picks) + 1_000);
    }
    // And the pools are whole.
    expect(t.seats.reduce((n, x) => n + poolOf(x).length, 0)).toBe(60);
    for (const x of t.seats) expect(poolOf(x).length).toBe(s.draft!.pools[x.seat]);
    close(t);
  }, 300_000);

  it('a pick that races its timer takes the cards the drafter chose', async () => {
    const t = await passNet(2, { format: 'pass', packs: 1, picks: 2 }, { net: { seed: 9, delay: { min: 200, max: 400 } }, pickTimer: true });
    const b = t.seats[1]!;
    b.idle = true;
    // s1's countdown runs from when s1 applied the pack's sinceSeq.
    const appliedAt = new Map<number, number>();
    b.peer.onSequenced((a) => appliedAt.set(a.seq, Date.now()));
    const chosen = new Map<string, string[]>();
    const bot = randomBot(4);
    await runDraft(
      t,
      (s) => {
        if (s !== b) return bot(s);
        const v = b.driver.view();
        if (v.pack === null || v.timer === null) return;
        const pack = b.peer.state.draft!.packs[v.pack.packId]!;
        const key = `${v.pack.packId}#${pack.picks}`;
        if (chosen.has(key)) return;
        // Confirm 1500 ms or 350 ms before the own countdown ends, in turn. The countdown starts 200-400 ms after the
        // sequencer's, the pick takes 200-400 ms to reach it and the timeout as long to come back: the pick wins the
        // first race; in the second it is proposed before the timeout arrives here but reaches the sequencer after
        // the timer ran out.
        const early = chosen.size % 2 === 0 ? 1500 : 350;
        if (Date.now() < (appliedAt.get(v.timer.fromSeq) ?? Infinity) + v.timer.ms - early) return;
        const ids = v.pack.cards.slice(-v.picks).map((c) => c.id);
        chosen.set(key, ids);
        expect(b.driver.pick(ids)).toBe(true);
      },
      4_000_000,
      undefined,
      50,
    );
    const mine = visits(t).filter((v) => v.holder === "s1");
    expect(mine.some((v) => v.kind === 'timeout')).toBe(true);
    expect(mine.some((v) => v.kind === 'pick')).toBe(true);
    // Whoever won the race, the cards taken are the ones s1 chose.
    for (const v of mine) expect(v.taken).toEqual(chosen.get(`${v.packId}#${v.picks}`));
    close(t);
  }, 300_000);
});

describe('peer loss', () => {
  it('a drafter lost while packs are passed to it gets them once it is back', async () => {
    const t = await passNet(4, { format: 'pass', packs: 2, picks: 1 }, { net: { seed: 13, delay: { min: 0, max: 40 }, drop: 0.03 } });
    const b = t.seats[1]!;
    let killed = 0;
    let deadSince = -1;
    await runDraft(t, randomBot(21), 900_000, (ms) => {
      if (deadSince < 0 && killed < 2 && ms > 3_000 + killed * 6_000 && !t.seats[0]!.peer.state.draft!.done) {
        t.net.kill(b.peer.peerId);
        deadSince = ms;
        killed += 1;
      } else if (deadSince >= 0 && ms - deadSince > 4_000) {
        t.net.revive(b.peer.peerId);
        deadSince = -1;
      }
    });
    expect(killed).toBe(2);
    expect(t.seats.reduce((n, x) => n + poolOf(x).length, 0)).toBe(120);
    // s1 asked for at least one pack it held without its cards, and got it.
    const asks = t.net.delivered.filter((m) => m.channel === 'prv' && m.from === 'p1' && (m.msg as { t?: string; cards?: unknown[] }).t === 'pack' && (m.msg as { cards: unknown[] }).cards.length === 0);
    expect(asks.length).toBeGreaterThan(0);
    close(t);
  }, 300_000);
});
