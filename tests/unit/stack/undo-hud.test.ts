/**
 * Personal undo of the stack through the real HUD path (DESIGN "Turn flow and confirmation", Undo: "Ctrl+Z reverts the
 * player's own most recent actions, one at a time"; "Input and interaction design": everything is reversible through
 * personal undo). The HUD's commands always open a confirmation round with a push (DESIGN "The effect stack", Stack
 * and confirmation); the round must never make a stack action un-undoable. Solo table: the empty chair passes at once.
 */
import { describe, expect, it } from 'vitest';
import type { InstanceId } from '../../../src/core/types';
import { mtg } from '../../../src/games/index';
import type { SoloSession } from '../../../src/session/index';
import { Commands, type UiHooks } from '../../../src/ui/commands';
import { withDeck } from '../session/helpers';

interface Table {
  s: SoloSession;
  commands: Commands;
  view: { hovered: InstanceId | null; selection: InstanceId[] };
  notes: string[];
}

async function table(hand = 3): Promise<Table> {
  const s = await withDeck();
  await s.draw(hand);
  const view = { hovered: null as InstanceId | null, selection: [] as InstanceId[] };
  const notes: string[] = [];
  const ui = new Proxy({} as UiHooks, {
    get: (_t, hook: string) => (...args: unknown[]) => {
      if (hook === 'notify') notes.push(String(args[0]));
    },
  });
  let n = 0;
  const commands = new Commands({ session: s, game: mtg, scene: () => null, view: () => view, ui, newId: (p) => `${p}-${++n}`, now: () => 0 });
  return { s, commands, view, notes };
}

/** Hover a hand card and press C (cast). */
function cast(t: Table, card: InstanceId): void {
  t.view.hovered = card;
  t.commands.run('cast');
  t.view.hovered = null;
}

const stackIds = (t: Table) => t.s.getState().stack.map((i) => i.card ?? i.id);

describe('Ctrl+Z on the stack after a confirmation round (HUD commands, solo session)', () => {
  it('cast with a round, all pass, resolve: Ctrl+Z puts the item back on the stack', async () => {
    const t = await table();
    const [c1] = t.s.secrets().hand;
    cast(t, c1!);
    const st = t.s.getState();
    expect(st.confirm).toMatchObject({ about: st.stack[0]!.id });
    expect(stackIds(t)).toEqual([c1]);
    t.commands.run('resolve');
    expect(stackIds(t)).toEqual([]);
    expect(t.s.canUndo()).toBe(true);
    t.commands.run('undo');
    expect(t.notes).toEqual([]);
    expect(stackIds(t)).toEqual([c1]);
    expect(t.s.getState().cards[c1!]!.zone).toBe('stack');
    // And the cast itself is undoable next: the card goes back to the hand.
    t.commands.run('undo');
    expect(stackIds(t)).toEqual([]);
    expect(t.s.getState().cards[c1!]!.zone).toBe(`hand:${t.s.seat}`);
    t.s.dispose();
  });

  it('counter (Shift+R) is undoable', async () => {
    const t = await table();
    const [c1] = t.s.secrets().hand;
    cast(t, c1!);
    t.commands.run('counterTop');
    expect(t.s.getState().cards[c1!]!.zone).toBe(`graveyard:${t.s.seat}`);
    t.commands.run('undo');
    expect(t.notes).toEqual([]);
    expect(stackIds(t)).toEqual([c1]);
    t.s.dispose();
  });

  it('a second cast onto a non-empty stack is undoable; then the first', async () => {
    const t = await table();
    const [c1, c2] = t.s.secrets().hand;
    cast(t, c1!);
    cast(t, c2!);
    expect(stackIds(t)).toEqual([c1, c2]);
    t.commands.run('undo');
    expect(t.notes).toEqual([]);
    expect(stackIds(t)).toEqual([c1]);
    t.commands.run('undo');
    expect(stackIds(t)).toEqual([]);
    expect(t.s.secrets().hand).toContain(c1);
    expect(t.s.secrets().hand).toContain(c2);
    t.s.dispose();
  });

  it('casting a selection is undone as one step', async () => {
    const t = await table();
    const [c1, c2, c3] = t.s.secrets().hand;
    t.view.selection = [c1!, c2!, c3!];
    t.commands.run('cast');
    expect(stackIds(t)).toEqual([c1, c2, c3]);
    t.commands.run('undo');
    expect(t.notes).toEqual([]);
    expect(stackIds(t)).toEqual([]);
    t.s.dispose();
  });
});
