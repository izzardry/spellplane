import { describe, expect, it, vi } from 'vitest';
import { LoopbackNetwork } from '../../src/net/loopback';
import type { Message } from '../../src/net/transport';
import { parseFlags } from '../../src/util/flags';
import { dbName } from '../../src/store/profile';

describe('flags', () => {
  it('parses the harness flags', () => {
    expect(parseFlags('?profile=a&transport=local&faces=placeholder')).toEqual({ profile: 'a', transport: 'local', faces: 'placeholder', speech: null });
    expect(parseFlags('')).toEqual({ profile: null, transport: 'trystero', faces: 'scryfall', speech: null });
    expect(parseFlags('?profile=../x').profile).toBeNull();
  });
  it('namespaces the database by profile', () => {
    expect(dbName('spellplane', null)).toBe('spellplane');
    expect(dbName('spellplane', 'b')).toBe('spellplane-b');
  });
});

describe('loopback transport', () => {
  const msg = (n: number): Message => ({ v: 1, t: 'test', n });

  it('delivers broadcast and addressed messages and reports peers', async () => {
    vi.useFakeTimers();
    const net = new LoopbackNetwork();
    const [a, b, c] = ['a', 'b', 'c'].map((id) => net.create(id)) as [ReturnType<typeof net.create>, ReturnType<typeof net.create>, ReturnType<typeof net.create>];
    const got: Record<string, unknown[]> = { a: [], b: [], c: [] };
    for (const t of [a, b, c]) t.on('act', (m, from) => got[t.selfId]!.push([from, m.n]));
    await Promise.all([a.join('r', 'k'), b.join('r', 'k'), c.join('r', 'k')]);
    await vi.runAllTimersAsync();
    expect(a.peers().sort()).toEqual(['b', 'c']);
    a.send('act', msg(1));
    a.send('act', msg(2), 'c');
    await vi.runAllTimersAsync();
    expect(got.b).toEqual([['a', 1]]);
    expect(got.c).toEqual([['a', 1], ['a', 2]]);
    expect(got.a).toEqual([]);
    vi.useRealTimers();
  });

  it('injects delay, drop and peer loss deterministically', async () => {
    vi.useFakeTimers();
    const run = async () => {
      const net = new LoopbackNetwork({ seed: 7, delay: { min: 0, max: 400 }, drop: 0.05 });
      const a = net.create('a');
      const b = net.create('b');
      const got: number[] = [];
      const left: string[] = [];
      b.on('act', (m) => got.push(m.n as number));
      b.onPeer((e, p) => e === 'leave' && left.push(p));
      await a.join('r', 'k');
      await b.join('r', 'k');
      await vi.runAllTimersAsync();
      for (let i = 0; i < 200; i++) a.send('act', msg(i));
      await vi.runAllTimersAsync();
      net.kill('a');
      a.send('act', msg(999));
      await vi.runAllTimersAsync();
      return { got, left };
    };
    const first = await run();
    const second = await run();
    expect(first).toEqual(second);
    expect(first.got.length).toBeLessThan(200); // some dropped
    expect(first.got.length).toBeGreaterThan(170);
    expect(first.got).not.toEqual([...first.got].sort((x, y) => x - y)); // some reordered
    expect(first.got).not.toContain(999);
    expect(first.left).toEqual(['a']);
    vi.useRealTimers();
  });
});
