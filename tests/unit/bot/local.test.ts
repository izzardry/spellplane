/** M8-P6: LocalNetwork (computer.md section 3): JSON copies, one delivery per task, the tap, leave and dispose, lifecycle. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LocalNetwork, timeoutScheduler } from '../../../src/net/local';
import type { Message } from '../../../src/net/transport';
import { live, resetLifecycleForTests } from '../../../src/util/lifecycle';
import { combatCue } from '../../../src/bot/cues';
import { BOT_TABLE_PREFIX, isBotTable, prefixedTableStore } from '../../../src/store/computer';
import { openStores } from '../../../src/store/stores';

beforeEach(() => {
  vi.useFakeTimers();
  resetLifecycleForTests();
});
afterEach(() => vi.useRealTimers());

describe('LocalNetwork', () => {
  it('delivers copies, one per task, with joins and leaves, to a tap', async () => {
    const taps: string[] = [];
    const net = new LocalNetwork({ scheduler: timeoutScheduler(), tap: (d) => void taps.push(`${d.from}>${d.to}:${d.msg.t}`) });
    const a = net.create('a');
    const b = net.create('b');
    const got: Message[] = [];
    const peers: string[] = [];
    b.on('act', (m) => void got.push(m));
    b.onPeer((e, p) => void peers.push(`${e}:${p}`));
    await a.join('r', 'k');
    await b.join('r', 'k');
    expect(live().transports).toBe(2);
    await vi.advanceTimersByTimeAsync(0);
    expect(peers).toEqual(['join:a']);
    const msg = { v: 4, t: 'x', nested: { n: 1 } };
    a.send('act', msg);
    a.send('act', { v: 4, t: 'y' });
    expect(got).toEqual([]);
    // One task per delivery.
    expect(vi.getTimerCount()).toBe(2);
    await vi.advanceTimersByTimeAsync(0);
    expect(got.map((m) => m.t)).toEqual(['x', 'y']);
    expect(got[0]).toEqual(msg);
    expect(got[0]).not.toBe(msg);
    expect(taps).toEqual(['a>b:x', 'a>b:y']);
    a.leave();
    await vi.advanceTimersByTimeAsync(0);
    expect(peers).toEqual(['join:a', 'leave:a']);
    net.dispose();
    expect(net.memberIds()).toEqual([]);
    expect(live().transports).toBe(0);
    a.send('act', msg);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("the bot's table store", () => {
  it('keeps the bot copy under bot~<room> and hides the human rows from its listing', async () => {
    vi.useRealTimers();
    const stores = await openStores(`bot-store-${Math.random()}`);
    try {
      const bot = prefixedTableStore(stores.tables, BOT_TABLE_PREFIX);
      const table = { roomId: 'c-x', roomKey: 'computer', lastSeq: 1, snapshot: null, snapshotSeq: 0, seat: 's1', stage: 'match' as const, updatedAt: 1 };
      await bot.saveAction('c-x', { roomId: 'c-x', seq: 1, action: { type: 'chat', text: 'hi', channel: 'table', by: 's1', cid: 'c' }, at: 1 }, table, null);
      await stores.tables.saveSnapshot({ ...table, seat: 's0' }, null);
      expect((await stores.tables.listTables()).map((t) => t.roomId).sort()).toEqual(['bot~c-x', 'c-x']);
      expect((await bot.listTables()).map((t) => [t.roomId, t.seat])).toEqual([['c-x', 's1']]);
      expect((await bot.loadLog('c-x')).map((l) => l.roomId)).toEqual(['c-x']);
      expect((await bot.loadTable('c-x'))?.table.seat).toBe('s1');
      expect(isBotTable('bot~c-x')).toBe(true);
      expect(isBotTable('c-x')).toBe(false);
      await bot.deleteTable('c-x');
      expect((await stores.tables.listTables()).map((t) => t.roomId)).toEqual(['c-x']);
    } finally {
      stores.close();
    }
  });
});

describe('combatCue', () => {
  it('is null outside a match', () => {
    expect(combatCue({ stage: 'lobby' } as never, [], 's0', 's1')).toBeNull();
  });
});
