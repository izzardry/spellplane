/**
 * The toast store (docs/design/m8/visual.md V21, DS-3; PLAN M8-P1): an undo toast lives 5 s; a second one restarts
 * the shared timer and shows UNDO ALL; a request stays until answered; a second status message replaces the first.
 * Fake timers, never slept.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createToasts, TOAST_MS } from '../../../src/ui/design/toasts';

describe('toasts', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('an undo toast lives 5 s, then commits', () => {
    const t = createToasts();
    const log: string[] = [];
    t.undo('Deck removed', () => log.push('undo'), { commit: () => log.push('commit') });
    expect(t.list()).toHaveLength(1);
    expect(t.list()[0]!.actions.map((a) => a.label)).toEqual(['Undo']);
    vi.advanceTimersByTime(TOAST_MS - 1);
    expect(t.list()).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(t.list()).toHaveLength(0);
    expect(log).toEqual(['commit']);
    expect(TOAST_MS).toBe(5000);
  });

  it('a second undo toast restarts the shared timer and the newest offers UNDO ALL (newest first)', () => {
    const t = createToasts();
    const log: string[] = [];
    t.undo('A', () => log.push('undo A'), { commit: () => log.push('commit A') });
    vi.advanceTimersByTime(4000);
    t.undo('B', () => log.push('undo B'), { commit: () => log.push('commit B') });
    vi.advanceTimersByTime(4000);
    expect(t.list().map((e) => e.text)).toEqual(['A', 'B']);
    const newest = t.list()[1]!;
    expect(newest.actions.map((a) => a.label)).toEqual(['Undo', 'Undo all']);
    expect(newest.actions.find((a) => a.label === 'Undo all')!.primary).toBe(true);
    expect(t.list()[0]!.actions.map((a) => a.label)).toEqual(['Undo']);
    newest.actions.find((a) => a.label === 'Undo all')!.run();
    expect(log).toEqual(['undo B', 'undo A']);
    expect(t.list()).toHaveLength(0);
    vi.advanceTimersByTime(10_000);
    expect(log).toEqual(['undo B', 'undo A']);
  });

  it('two unanswered undo toasts both commit when the shared timer runs out', () => {
    const t = createToasts();
    const log: string[] = [];
    t.undo('A', () => log.push('undo A'), { commit: () => log.push('commit A') });
    vi.advanceTimersByTime(3000);
    t.undo('B', () => log.push('undo B'), { commit: () => log.push('commit B') });
    vi.advanceTimersByTime(TOAST_MS);
    expect(log).toEqual(['commit A', 'commit B']);
  });

  it('undoing one leaves the other with its own UNDO; closing one commits it', () => {
    const t = createToasts();
    const log: string[] = [];
    const a = t.undo('A', () => log.push('undo A'), { commit: () => log.push('commit A') });
    t.undo('B', () => log.push('undo B'), { commit: () => log.push('commit B') });
    t.list()[1]!.actions[0]!.run();
    expect(log).toEqual(['undo B']);
    expect(t.list().map((e) => e.actions.map((x) => x.label))).toEqual([['Undo']]);
    t.dismiss(a);
    expect(log).toEqual(['undo B', 'commit A']);
  });

  it('a request stays until answered or withdrawn, and answers once', () => {
    const t = createToasts();
    const log: string[] = [];
    t.request('Ben asks to undo', { allow: () => log.push('allow'), decline: () => log.push('decline') });
    vi.advanceTimersByTime(600_000);
    const r = t.list().find((e) => e.kind === 'request')!;
    expect(r.actions.map((a) => [a.label, !!a.primary])).toEqual([
      ['Decline', false],
      ['Allow', true],
    ]);
    r.actions[1]!.run();
    r.actions[0]!.run();
    expect(log).toEqual(['allow']);
    expect(t.list()).toHaveLength(0);
    const h = t.request('again', { allow: () => log.push('x'), decline: () => log.push('y') });
    h.withdraw();
    expect(t.list()).toHaveLength(0);
  });

  it('one status slot: a new message replaces the old one, null clears it', () => {
    const t = createToasts();
    t.status('Ben is away');
    t.status('Ben is back');
    expect(t.list().filter((e) => e.kind === 'status').map((e) => e.text)).toEqual(['Ben is back']);
    vi.advanceTimersByTime(60_000);
    expect(t.list()).toHaveLength(1);
    t.status(null);
    expect(t.list()).toHaveLength(0);
  });

  it('an info toast leaves after 5 s; clear() closes everything without callbacks', () => {
    const t = createToasts();
    const log: string[] = [];
    t.info('Game saved. Continue any time.', { label: 'Continue', run: () => log.push('continue') });
    vi.advanceTimersByTime(TOAST_MS);
    expect(t.list()).toHaveLength(0);
    t.undo('A', () => log.push('undo'), { commit: () => log.push('commit') });
    t.request('r', { allow: () => log.push('allow'), decline: () => log.push('decline') });
    t.status('s');
    t.clear();
    vi.advanceTimersByTime(TOAST_MS * 2);
    expect(t.list()).toHaveLength(0);
    expect(log).toEqual([]);
  });

  it('subscribers see every change and can unsubscribe', () => {
    const t = createToasts();
    const seen: number[] = [];
    const off = t.subscribe((l) => seen.push(l.length));
    t.status('a');
    off();
    t.status('b');
    expect(seen).toEqual([0, 1]);
  });
});
