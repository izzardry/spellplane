/**
 * The pass-draft and sealed scenarios of the shared leak test (PLAN M2-P2: "no peer's messages contain a pack it did
 * not hold at that pick (leak test)"; DESIGN "Pre-game", Hidden information: "A pack is visible only to its current
 * holder"; sealed: "Own pool only"; "Specification: network protocol and secrecy", Draft packs).
 *
 * What a seat may know is derived from the owners' side only (tests/sim/draft/pass/net.ts `visits`: generated records,
 * the public log, the pools): its own packs, and each pack's remaining cards at each of its turns at that pack.
 * Everything else of the other seats' packs (salts, Scryfall ids, the instance-to-card mapping) and every other seat's
 * pack-seed owner nonce must be absent from every message the seat received, its shared state and log, its secret
 * store and its view (tests/leak/draft.ts). The scenarios run under delay, drop and reordering, with a reload and an
 * outage, so the re-sends and requests are scanned too.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RevealedCard } from '../../../../src/core/commit';
import { packLeakScan } from '../../../leak/draft';
import { close, passNet, randomBot, runDraft, visits, type PassNet, type PassSeat } from './net';

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
});
afterEach(() => {
  vi.useRealTimers();
});

const FAULTY = { seed: 31, delay: { min: 0, max: 40 }, drop: 0.05 };

function generatedBy(s: PassSeat): RevealedCard[] {
  return (s.secrets().draft?.generated ?? []).flatMap((g) => g.cards);
}

/** Every seat's scan comes back empty, and each seat received only the packs it held, as they were at its turn. */
function expectNoLeak(t: PassNet): void {
  const all = visits(t);
  for (const b of t.seats) {
    const others = t.seats.filter((x) => x !== b);
    const mine = all.filter((v) => v.holder === b.seat);
    const allowed = new Set([...generatedBy(b).map((c) => c.instanceId), ...mine.flatMap((v) => v.before)]);
    const everything = new Map(t.seats.flatMap((x) => generatedBy(x)).map((c) => [c.instanceId, c]));
    const known = [...allowed].map((id) => everything.get(id)!).filter((c) => c !== undefined);
    const report = packLeakScan({
      observed: [b.peer.received, b.peer.state, b.peer.log(), b.secrets(), b.driver.view()],
      others: others.flatMap(generatedBy),
      nonces: others.flatMap((x) => (x.secrets().draft?.generated ?? []).map((g) => g.ownerNonce)),
      allowed,
      known,
    });
    expect(report.forbidden).toBeGreaterThan(0);
    expect(report.tokens).toEqual([]);
    expect(report.pairs).toEqual([]);
    // Every pack hand-over b received is one of its turns at that pack, exactly as the pack was then.
    const packs = b.peer.received.filter((m) => m.channel === 'prv' && (m.msg as { t?: string }).t === 'pack');
    for (const m of packs) {
      const msg = m.msg as { packId: string; cards: { instanceId: string }[] };
      if (msg.cards.length === 0) continue;
      const ids = msg.cards.map((c) => c.instanceId).sort();
      expect(mine.some((v) => v.packId === msg.packId && [...v.before].sort().join() === ids.join())).toBe(true);
    }
  }
}

describe('hidden packs leak scenario', () => {
  it('a four-seat pass draft shows each seat only the packs it held, at its turn', async () => {
    const t = await passNet(4, { format: 'pass', packs: 3, picks: 1 }, { net: FAULTY, sets: ['M19', 'M20', 'M21'] });
    const c = t.seats[2]!;
    let reloaded = false;
    let deadSince = -1;
    let outage = false;
    await runDraft(t, randomBot(41), 900_000, (ms) => {
      if (!reloaded && c.driver.view().pack !== null && ms > 2_000) {
        reloaded = true;
        c.reload();
      }
      if (!outage && ms > 6_000) {
        outage = true;
        deadSince = ms;
        t.net.kill(c.peer.peerId);
      }
      if (deadSince >= 0 && ms - deadSince > 5_000) {
        t.net.revive(c.peer.peerId);
        deadSince = -1;
      }
    });
    expect(reloaded && outage).toBe(true);
    expectNoLeak(t);

    // Negative control: one card of a pack s1 never held, sent to it on the pair channel, is caught by the same scan.
    const a = t.seats[0]!;
    const b = t.seats[1]!;
    const seen = new Set(visits(t).filter((v) => v.holder === 's1').flatMap((v) => v.before));
    const leaked = generatedBy(a).find((x) => !seen.has(x.instanceId))!;
    expect(leaked).toBeDefined();
    a.peer.sendPrivate('s1', { v: 1, t: 'pack', packId: 'control', cards: [leaked] });
    await vi.advanceTimersByTimeAsync(500);
    const report = packLeakScan({ observed: [b.peer.received], others: [leaked], nonces: [], allowed: new Set(), known: [] });
    expect(report.tokens.length).toBeGreaterThan(0);
    expect(report.pairs.length).toBeGreaterThan(0);
    close(t);
  }, 240_000);

  it('Pick-Two with two seats: the packs come back, never with the cards taken in between', async () => {
    const t = await passNet(2, { format: 'pass', packs: 2, picks: 2 }, { net: FAULTY, sets: ['M10'] });
    await runDraft(t, randomBot(43));
    expectNoLeak(t);
    close(t);
  }, 240_000);

  it('sealed pools never leave their owner', async () => {
    const t = await passNet(3, { format: 'sealed', packs: 6 }, { net: FAULTY, sets: ['M19', 'M20'] });
    await runDraft(t, () => undefined);
    expectNoLeak(t);
    for (const s of t.seats) {
      expect(s.peer.received.filter((m) => m.channel === 'prv')).toEqual([]);
    }
    close(t);
  }, 240_000);
});
