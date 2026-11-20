/** M8-P6: LocalNetwork (computer.md section 3): JSON copies, one delivery per task, the tap, leave and dispose, lifecycle. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LocalNetwork, timeoutScheduler } from '../../../src/net/local';
import type { Message } from '../../../src/net/transport';
import { live, resetLifecycleForTests } from '../../../src/util/lifecycle';
import { combatCue, damageCounted } from '../../../src/bot/cues';
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

  /** A minimal table: cards by controller and combat mark, the active seat, the open round and block lines. */
  const table = (o: { active: string; cards: [string, string, 'attack' | 'block' | undefined][]; confirm?: unknown; lines?: unknown }) =>
    ({
      stage: 'match',
      turn: { number: 3, active: o.active, phase: 'main1' },
      seats: { s0: { id: 's0', name: 'Ann' }, s1: { id: 's1', name: 'Sparring' } },
      cards: Object.fromEntries(o.cards.map(([id, controller, combat]) => [id, { id, controller, zone: `battlefield:${controller}`, ...(combat ? { combat } : {}) }])),
      confirm: o.confirm ?? null,
      lines: o.lines ?? {},
    }) as never;
  const act = (seq: number, action: Record<string, unknown>) => ({ kind: 'action', action: { seq, ...action } }) as never;

  it('offers Attack for a marked attacker in any phase, Damage once Sparring answered, nothing after', () => {
    const marked = table({ active: 's0', cards: [['a', 's0', 'attack']] });
    const declared = [act(1, { type: 'turnPass', by: 's1', to: 's0' }), act(2, { type: 'moveTemp', by: 's0', card: 'a', combat: 'attack' })];
    expect(combatCue(marked, declared, 's0', 's1')).toEqual({ kind: 'attack', label: 'Attack' });
    const asked = [...declared, act(3, { type: 'ask', by: 's0', round: 'r1', label: ' attack ' })];
    expect(combatCue(table({ active: 's0', cards: [['a', 's0', 'attack']], confirm: { id: 'r1', responses: {} } }), asked, 's0', 's1')).toBeNull();
    const answered = table({ active: 's0', cards: [['a', 's0', 'attack']], confirm: { id: 'r1', responses: { s1: 'ok' } } });
    expect(combatCue(answered, asked, 's0', 's1')).toEqual({ kind: 'damage', label: 'Damage' });
    const damage = [...asked, act(4, { type: 'ask', by: 's0', round: 'r2', label: 'Damage' })];
    expect(combatCue(table({ active: 's0', cards: [['a', 's0', 'attack']], confirm: { id: 'r2', responses: {} } }), damage, 's0', 's1')).toBeNull();
    expect(damageCounted(table({ active: 's0', cards: [['a', 's0', 'attack']], confirm: { id: 'r2', responses: {} } }), damage, 's0', 's1')).toBe(false);
    expect(damageCounted(table({ active: 's0', cards: [['a', 's0', 'attack']], confirm: { id: 'r2', responses: { s1: 'ok' } } }), damage, 's0', 's1')).toBe(true);
    // A Damage cue without an Attack cue counts the combat with no blocks.
    const direct = [...declared, act(3, { type: 'ask', by: 's0', round: 'r3', label: 'Damage' })];
    expect(damageCounted(table({ active: 's0', cards: [['a', 's0', 'attack']], confirm: { id: 'r3', responses: { s1: 'ok' } } }), direct, 's0', 's1')).toBe(true);
  });

  it("on Sparring's turn its attack comes first: No blocks, Done blocking with a block line, nothing after Blocks done", () => {
    const log = [act(1, { type: 'turnPass', by: 's0', to: 's1' }), act(2, { type: 'moveTemp', by: 's1', card: 'b', combat: 'attack' })];
    // The human's card is still marked from its own last combat: no Attack cue on Sparring's turn.
    const stale = table({ active: 's1', cards: [['a', 's0', 'attack'], ['b', 's1', 'attack']] });
    expect(combatCue(stale, log, 's0', 's1')).toEqual({ kind: 'blocksDone', label: 'No blocks' });
    expect(damageCounted(stale, log, 's0', 's1')).toBe(false);
    const blocking = table({ active: 's1', cards: [['c', 's0', 'block'], ['b', 's1', 'attack']], lines: { l1: { id: 'l1', kind: 'block', from: { kind: 'card', id: 'c' }, to: { kind: 'card', id: 'b' } } } });
    expect(combatCue(blocking, log, 's0', 's1')).toEqual({ kind: 'blocksDone', label: 'Done blocking' });
    const done = [...log, act(3, { type: 'ask', by: 's0', round: 'r9', label: 'Blocks done' })];
    expect(combatCue(blocking, done, 's0', 's1')).toBeNull();
  });
});
