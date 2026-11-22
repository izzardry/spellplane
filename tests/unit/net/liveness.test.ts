// The liveness clock (net/liveness.ts): a page's own on-time running, on which the engine judges peers away and the
// BroadcastChannel transport judges them gone (gate M8 round 3, C1: a theme switch stalled the page in chunks, each
// shorter than the stall guard, and it claimed the sequencer and marked the other seat away).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BroadcastTransport, GONE_MS } from '../../../src/net/broadcast';
import { AWAY_AFTER_MS } from '../../../src/net/types';
import { OwnClock } from '../../../src/net/liveness';

describe('OwnClock', () => {
  it('counts on-time runs in full and a late run at most `cap`', () => {
    const c = new OwnClock({ cap: 500, hiddenCap: 2000, hidden: () => false });
    expect(c.step(10_000)).toBe(0);
    expect(c.at(10_000)).toBe(0);
    c.step(10_250);
    c.step(10_600);
    expect(c.at(10_600)).toBe(600);
    // A run 1.9 s late (a stall of the page) counts 500.
    expect(c.step(12_500)).toBe(1900);
    expect(c.at(12_500)).toBe(1100);
    // Between runs the time since the last counts, capped the same way.
    expect(c.at(12_700)).toBe(1300);
    expect(c.at(20_000)).toBe(1600);
  });

  it('a clock that goes back counts nothing and goes on from there', () => {
    const c = new OwnClock({ cap: 500, hiddenCap: 2000, hidden: () => false });
    c.step(5000);
    c.step(5250);
    expect(c.step(1000)).toBe(0);
    expect(c.at(1000)).toBe(250);
    expect(c.at(900)).toBe(250);
    c.step(1250);
    expect(c.at(1250)).toBe(500);
  });

  it('a hidden page (timers throttled by the browser to about one run a second) counts each run up to `hiddenCap`', () => {
    let hidden = true;
    const c = new OwnClock({ cap: 500, hiddenCap: 2000, hidden: () => hidden });
    c.step(0);
    c.step(1000);
    c.step(2000);
    expect(c.at(2000)).toBe(2000);
    c.step(5000);
    expect(c.at(5000)).toBe(4000);
    hidden = false;
    c.step(6000);
    expect(c.at(6000)).toBe(4500);
  });
});

describe('BroadcastTransport liveness', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  /** Let BroadcastChannel deliver (it does not run on the faked timers). */
  const delivered = () => new Promise<void>((resolve) => setTimeout(resolve, 30));

  it('never forgets a silent peer before the engine’s away rule would mark it away', () => {
    expect(GONE_MS).toBeGreaterThan(AWAY_AFTER_MS);
  });

  it('a page stalled in chunks, each under the stall bound, keeps a silent peer; on time it drops it after GONE_MS', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
    const room = `liveness-${Math.random().toString(36).slice(2)}`;
    const a = new BroadcastTransport('A');
    const left: string[] = [];
    a.onPeer((ev, p) => {
      if (ev === 'leave') left.push(p);
    });
    await a.join(room, 'k');
    const other = new BroadcastChannel(`spellplane-room-${room}`);
    try {
      other.postMessage({ k: 'hello', from: 'B' });
      await delivered();
      expect(a.peers()).toEqual(['B']);
      // B says nothing more. A is blocked for 1.7 s at a time with 0.3 s of running between: 20 s of wall clock.
      for (let i = 0; i < 10; i++) {
        vi.setSystemTime(Date.now() + 1700);
        vi.advanceTimersByTime(300);
        expect(a.peers()).toEqual(['B']);
      }
      // Running on time, A drops B once it has gone unheard for GONE_MS of A's own running (less what the chunks counted).
      vi.advanceTimersByTime(GONE_MS);
      expect(a.peers()).toEqual([]);
      expect(left).toEqual(['B']);
    } finally {
      other.close();
      a.leave();
    }
  });
});
