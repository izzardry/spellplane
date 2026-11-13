/**
 * PLAN M1-P6 acceptance: the timeline merge and filter (DESIGN "Chat and voice", Text chat: chat lines and action-log
 * lines share one timeline, filterable to chat only or actions only; core/log.ts). Also the pending own chat lines the
 * HUD merges in until the session log has them (ui/chat/watch.ts).
 */
import { describe, expect, it } from 'vitest';
import type { Action } from '../../../src/core/actions';
import { chatTabOf, filterTimeline, isPending, mergeTimeline, timelineKind, type TimelineFilter } from '../../../src/core/log';
import type { LogEntry } from '../../../src/core/types';
import { logLines } from '../../../src/ui/describe';
import { tableWith } from '../../../src/ui/fakes';
import { addPending, prunePending } from '../../../src/ui/chat/watch';

type Draft = Partial<Action> & { type: Action['type'] };
const act = (seq: number | undefined, a: Draft, cid = `c${seq}`): Action => ({ by: 's0', cid, ...(seq === undefined ? {} : { seq }), ...a }) as Action;
const entry = (seq: number, a: Draft, at = seq * 1000, cid = `c${seq}`): LogEntry => ({ kind: 'action', seq, at, action: act(seq, a, cid) });
const sys = (seq: number, text: string, at = seq * 1000 + 1): LogEntry => ({ kind: 'system', seq, at, level: 'warn', text });
const pending = (cid: string, text: string, at: number): LogEntry => ({ kind: 'action', seq: -1, at, action: act(undefined, { type: 'chat', text, channel: 'table' }, cid) });
const chat = (seq: number, text: string, channel: 'table' | 'team' = 'table', by = 's0') => entry(seq, { type: 'chat', text, channel, by });
const tap = (seq: number) => entry(seq, { type: 'tap', card: 'x', tapped: true });
const label = (e: LogEntry) => (e.kind === 'system' ? `sys:${e.text}` : e.action.type === 'chat' ? `chat:${e.action.text}` : `${e.action.type}:${e.action.cid}`);

describe('timeline kinds', () => {
  it('chat and captions are chat lines, everything else an action line, local warnings system lines', () => {
    expect(timelineKind(chat(1, 'hi'))).toBe('chat');
    expect(timelineKind(entry(2, { type: 'caption', text: 'hm' }))).toBe('chat');
    expect(timelineKind(tap(3))).toBe('action');
    expect(timelineKind(sys(3, 'hash mismatch'))).toBe('system');
    expect(chatTabOf(chat(1, 'x', 'team'))).toBe('team');
    expect(chatTabOf(entry(2, { type: 'caption', text: 'hm' }))).toBe('table');
    expect(chatTabOf(tap(3))).toBeNull();
  });
});

describe('mergeTimeline (DESIGN "Chat and voice": one timeline)', () => {
  it('interleaves chat and action entries from separate sources by sequence number', () => {
    const actions = [tap(1), tap(3), tap(6)];
    const talk = [chat(2, 'hello'), chat(4, 'nice'), chat(5, 'ok')];
    expect(mergeTimeline(actions, talk).map(label)).toEqual(['tap:c1', 'chat:hello', 'tap:c3', 'chat:nice', 'chat:ok', 'tap:c6']);
    // The order of the sources does not matter for sequenced entries.
    expect(mergeTimeline(talk, actions).map(label)).toEqual(mergeTimeline(actions, talk).map(label));
  });

  it('a system line follows the action of its seq, before the next action', () => {
    const merged = mergeTimeline([tap(1), tap(2), tap(3)], [sys(2, 'refused: x'), sys(0, 'restored')]);
    expect(merged.map(label)).toEqual(['sys:restored', 'tap:c1', 'tap:c2', 'sys:refused: x', 'tap:c3']);
  });

  it('keeps an action that two sources share once, preferring the sequenced copy over the pending one', () => {
    const sent = pending('mine', 'gl hf', 500);
    const sequenced = entry(2, { type: 'chat', text: 'gl hf', channel: 'table' }, 900, 'mine');
    const merged = mergeTimeline([tap(1), sequenced, tap(3)], [sent]);
    expect(merged.map(label)).toEqual(['tap:c1', 'chat:gl hf', 'tap:c3']);
    expect(merged[1]).toBe(sequenced);
    // Same when the pending copy comes first.
    expect(mergeTimeline([sent], [tap(1), sequenced, tap(3)])[1]).toBe(sequenced);
    // And a duplicate within one source.
    expect(mergeTimeline([tap(1), tap(1)]).map(label)).toEqual(['tap:c1']);
  });

  it('pending lines follow every sequenced entry, in the order they were sent', () => {
    const merged = mergeTimeline([pending('p2', 'second', 2000), pending('p1', 'first', 1000)], [tap(5), chat(6, 'theirs')]);
    expect(merged.map(label)).toEqual(['tap:c5', 'chat:theirs', 'chat:first', 'chat:second']);
    expect(merged.filter(isPending)).toHaveLength(2);
  });

  it('is stable for entries with the same place: earlier source first, then source order', () => {
    const a = sys(4, 'a1');
    const b = sys(4, 'a2', a.at);
    const c = sys(4, 'b1', a.at);
    expect(mergeTimeline([a, b], [c]).map(label)).toEqual(['sys:a1', 'sys:a2', 'sys:b1']);
  });

  it('does not change its inputs; no sources or empty sources give an empty timeline', () => {
    const src = [tap(2), tap(1)];
    const copy = structuredClone(src);
    expect(mergeTimeline(src).map(label)).toEqual(['tap:c1', 'tap:c2']);
    expect(src).toEqual(copy);
    expect(mergeTimeline()).toEqual([]);
    expect(mergeTimeline([], [])).toEqual([]);
  });
});

describe('filterTimeline (DESIGN "Chat and voice": filterable to chat only or actions only)', () => {
  const items = [
    { id: 1, kind: 'action' as const },
    { id: 2, kind: 'chat' as const, channel: 'table' as const },
    { id: 3, kind: 'system' as const },
    { id: 4, kind: 'chat' as const },
    { id: 5, kind: 'chat' as const, channel: 'team' as const },
    { id: 6, kind: 'action' as const },
  ];
  const ids = (f: TimelineFilter, tab?: 'table' | 'team') => filterTimeline(items, f, tab).map((i) => i.id);

  it('all shows everything of the tab; chat hides action and system lines; actions hides chat lines', () => {
    expect(ids('all')).toEqual([1, 2, 3, 4, 6]);
    expect(ids('chat')).toEqual([2, 4]);
    expect(ids('actions')).toEqual([1, 3, 6]);
  });

  it('chat lines show on their own tab only (no channel means the table); actions show on every tab', () => {
    expect(ids('all', 'team')).toEqual([1, 3, 5, 6]);
    expect(ids('chat', 'team')).toEqual([5]);
    expect(ids('actions', 'team')).toEqual([1, 3, 6]);
  });

  it('works on described log lines: grouped action lines are hidden or kept as a whole', () => {
    const { state } = tableWith(['Anna', 'Ben'], [
      { id: 'a', zone: 'battlefield:s0', sid: 'sid-bear' },
      { id: 'b', zone: 'battlefield:s0', sid: 'sid-land' },
    ]);
    const es = [
      entry(1, { type: 'tap', card: 'a', tapped: true, group: 'g' }),
      entry(2, { type: 'tap', card: 'b', tapped: true, group: 'g' }),
      chat(3, 'attack?', 'table', 's1'),
      entry(4, { type: 'life', seat: 's1', delta: -2 }),
      sys(4, 'State hash mismatch'),
    ];
    state.seats.s1!.life = 18;
    const lines = logLines(mergeTimeline(es), { state, cardName: () => 'X', phaseLabel: (p) => p });
    expect(lines.map((l) => l.kind)).toEqual(['action', 'chat', 'action', 'system']);
    expect(filterTimeline(lines, 'chat').map((l) => l.kind)).toEqual(['chat']);
    expect(filterTimeline(lines, 'actions').map((l) => l.segs.map((s) => ('card' in s ? s.name : s.text)).join(''))).toEqual(['taps X and X', 'changes life of Ben: 20 → 18', 'State hash mismatch']);
  });
});

describe('captions in the log (DESIGN "Chat and voice", Record)', () => {
  // As ui/chat/ChatLines.svelte joins them.
  const text = (l: { kind: string; actor: string; segs: ({ text: string } | { name: string })[]; told?: true }) => `${l.actor}${l.kind === 'chat' && !l.told ? ': ' : ' '}${l.segs.map((s) => ('name' in s ? s.name : s.text)).join('')}`;
  const { state } = tableWith(['Anna', 'Ben'], [{ id: 'shock', zone: 'stack', sid: 'sid-bolt' }]);
  const ctx = { state, cardName: (id: string) => (id === 'shock' ? 'Shock' : null), phaseLabel: (p: string) => p };
  const cast = entry(1, { type: 'stackPush', item: 'i1', kind: 'spell', card: 'shock' });

  it('a caption is told with the action it is attached to, still a chat line', () => {
    const lines = logLines([cast, entry(2, { type: 'caption', text: 'two damage to your Elf', about: 'c1' })], ctx);
    expect(lines.map(text)).toEqual(['Anna casts Shock', "Anna casts Shock: 'two damage to your Elf'"]);
    expect(lines[1]!.kind).toBe('chat');
  });

  it('without an action of the speaker\'s own to attach to, it reads as the speaker\'s words', () => {
    expect(logLines([entry(2, { type: 'caption', text: 'hm' })], ctx).map(text)).toEqual(['Anna: hm']);
    expect(logLines([entry(2, { type: 'caption', text: 'hm', about: 'gone' })], ctx).map(text)).toEqual(['Anna: hm']);
    expect(logLines([cast, entry(2, { type: 'caption', text: 'hm', about: 'c1', by: 's1' })], ctx).map(text)).toEqual(['Anna casts Shock', 'Ben: hm']);
  });
});

describe('pending own chat lines (ui/chat/watch.ts)', () => {
  it('a sent line stays pending until the log holds its cid, then the log copy is the only one', () => {
    const sent = act(undefined, { type: 'chat', text: 'hi', channel: 'table' }, 'mine');
    let p = addPending([], sent, [tap(1)], 100);
    expect(p).toHaveLength(1);
    expect(addPending(p, sent, [tap(1)], 200)).toHaveLength(1);
    const log = [tap(1), entry(2, { type: 'chat', text: 'hi', channel: 'table' }, 300, 'mine')];
    p = [...prunePending(p, log)];
    expect(p).toEqual([]);
    const unchanged: LogEntry[] = [];
    expect(prunePending(unchanged, log)).toBe(unchanged);
  });

  it('a line the session already logged (solo: applied at once) is not added as pending', () => {
    const sent = act(7, { type: 'chat', text: 'hi', channel: 'table' }, 'mine');
    expect(addPending([], sent, [entry(7, { type: 'chat', text: 'hi', channel: 'table' }, 0, 'mine')], 100)).toEqual([]);
  });
});
