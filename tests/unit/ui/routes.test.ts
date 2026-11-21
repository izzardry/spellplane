/**
 * M8-P8 unit checks of the journey's seams: the table menu's "This game" group (journey.md 4.10: `Leave to home`
 * first, `Invite…` only at a private networked table with an action, never in a matched or computer game, `Concede`
 * only for a seated player in a running match), and that the five leak test files of contracts.md Part A hold no
 * `it.todo` any more (each owner replaced its scenarios).
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { TableState } from '../../../src/core/types';
import { tableWith } from '../../../src/ui/fakes';
import { menuTop } from '../../../src/ui/table/menu-top';
import { leavesTable } from '../../../src/ui/table/leave-guard';
import { parseRoute } from '../../../src/ui/routes';

function table(over: Partial<TableState> = {}, settings: Partial<TableState['settings']> = {}): TableState {
  const { state } = tableWith(['Ann', 'Ben'], []);
  return { ...state, stage: 'match', ...over, settings: { ...state.settings, ...settings } };
}
const noop = (): void => undefined;
const ids = (groups: ReturnType<typeof menuTop>): string[] => groups.flatMap((g) => g.items.map((i) => i.id));

describe('menuTop (the "This game" group)', () => {
  it('starts with Leave to home and is titled This game', () => {
    const groups = menuTop('practice', table(), 's0', { leave: noop });
    expect(groups).toHaveLength(1);
    expect(groups[0]!.title).toBe('This game');
    expect(groups[0]!.items[0]).toMatchObject({ id: 'leave', label: 'Leave to home' });
  });

  it('offers Invite… at a private networked table only', () => {
    const actions = { leave: noop, invite: noop, concede: noop };
    expect(ids(menuTop('room', table(), 's0', actions))).toEqual(['leave', 'invite', 'concede']);
    expect(ids(menuTop('room', table({}, { matched: true }), 's0', actions))).toEqual(['leave', 'concede']);
    expect(ids(menuTop('matched', table(), 's0', actions))).toEqual(['leave', 'concede']);
    expect(ids(menuTop('computer', table(), 's0', actions))).toEqual(['leave', 'concede']);
    expect(ids(menuTop('practice', table(), 's0', actions))).toEqual(['leave', 'concede']);
    // Without an invite action (every seat taken) there is no entry.
    expect(ids(menuTop('room', table(), 's0', { leave: noop, concede: noop }))).toEqual(['leave', 'concede']);
  });

  it('offers Concede to a seated player in a running match only', () => {
    const actions = { leave: noop, concede: noop };
    expect(ids(menuTop('room', table({ stage: 'lobby' }), 's0', actions))).toEqual(['leave']);
    expect(ids(menuTop('room', table(), null, actions))).toEqual(['leave']);
    expect(ids(menuTop('room', table({ result: { winners: ['s1'], reason: 'concede', atSeq: 3 } }), 's0', actions))).toEqual(['leave']);
    const conceded = table();
    conceded.seats.s0 = { ...conceded.seats.s0!, conceded: true };
    expect(ids(menuTop('room', conceded, 's0', actions))).toEqual(['leave']);
    const concede = menuTop('room', table(), 's0', actions)[0]!.items.find((i) => i.id === 'concede')!;
    expect(concede.danger).toBe(true);
  });

  it('runs the given actions', () => {
    const ran: string[] = [];
    const items = menuTop('room', table(), 's0', { leave: () => ran.push('leave'), invite: () => ran.push('invite'), concede: () => ran.push('concede') })[0]!.items;
    for (const i of items) i.run?.();
    expect(ran).toEqual(['leave', 'invite', 'concede']);
  });
});

describe('leavesTable (the browser\'s Back leaves like the arrow)', () => {
  const r = (h: string) => parseRoute(h);
  it('a table route left for Home, a shell page or another table is left', () => {
    expect(leavesTable(r('#/c/c-abc'), r('#/'))).toBe(true);
    expect(leavesTable(r('#/p/p-abc'), r('#/decks'))).toBe(true);
    expect(leavesTable(r('#/t/amber-fox-42/QXVkaXRBdWRpdEF1ZGl0QQ'), r('#/history'))).toBe(true);
    expect(leavesTable(r('#/c/c-abc'), r('#/c/c-def'))).toBe(true);
    expect(leavesTable(r('#/t/amber-fox-42/QXVkaXRBdWRpdEF1ZGl0QQ'), r('#/t/other-room-7/QXVkaXRBdWRpdEF1ZGl0QQ'))).toBe(true);
  });
  it('the same table with another suffix, the sandbox and the shell pages are not', () => {
    expect(leavesTable(r('#/t/amber-fox-42/QXVkaXRBdWRpdEF1ZGl0QQ'), r('#/t/amber-fox-42/QXVkaXRBdWRpdEF1ZGl0QQ/watch'))).toBe(false);
    expect(leavesTable(r('#/c/c-abc'), r('#/c/c-abc'))).toBe(false);
    expect(leavesTable(r('#/solo'), r('#/'))).toBe(false);
    expect(leavesTable(r('#/'), r('#/decks'))).toBe(false);
  });
});

describe('the five leak test files of contracts.md Part A', () => {
  const files = ['tests/unit/decks/queue-leak.test.ts', 'tests/sim/flow/leak-lobby.test.ts', 'tests/sim/resume/leak-rejoin.test.ts', 'tests/sim/bot/leak.test.ts', 'tests/sim/lobby/leak.test.ts'];
  for (const f of files) {
    it(`${f} exists and holds no it.todo`, () => {
      const text = fs.readFileSync(path.resolve(f), 'utf8');
      expect(text).not.toMatch(/\b(it|test)\.todo\s*\(/);
      expect(text).toMatch(/\b(it|test)\s*\(/);
    });
  }
});
