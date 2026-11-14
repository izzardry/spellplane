/**
 * PLAN M5-P6 undo after a reload, on the solo table (session/solo.ts): DESIGN "Turn flow and confirmation", Undo —
 * Ctrl+Z reverts the player's own most recent actions one at a time, a draw goes back on top of the library, shuffles
 * cannot be undone. A reload changes nothing about that: the stack is rebuilt from the saved log (core/undo.ts
 * undoStackFromLog).
 */
import { afterEach, describe, expect, it } from 'vitest';
import { closeStores, session, stores, withDeck } from '../session/helpers';

afterEach(closeStores);

async function reload(name: string) {
  closeStores();
  return stores(name);
}

describe('solo undo after a reload', () => {
  it('takes back the draw (top of the library), the tap and the play, in that order', async () => {
    const db = await stores();
    const s = await withDeck(db);
    await s.shuffle();
    await s.draw(7);
    const card = s.secrets().hand[0]!;
    s.dispatch({ type: 'move', card, to: 'battlefield:s0', pose: { x: 30, y: 120, rot: 0 } });
    s.dispatch({ type: 'tap', card, tapped: true });
    const top = s.secrets().libraryOrder[0]!;
    await s.draw(1);
    await s.whenSaved();

    const again = await session(await reload(db.db.name));
    expect(again.canUndo()).toBe(true);
    expect(again.undo()).toBe(true);
    expect(again.secrets().libraryOrder[0]).toBe(top);
    expect(again.secrets().hand).not.toContain(top);
    expect(again.undo()).toBe(true);
    expect(again.getState().cards[card]!.tapped).toBe(false);
    expect(again.undo()).toBe(true);
    expect(again.getState().cards[card]?.zone ?? 'gone').not.toBe('battlefield:s0');
    // The card is back in the hand. The seven draws are the next step (one group, one step); the shuffle before them
    // is as far back as undo goes.
    expect(again.secrets().hand).toHaveLength(7);
    expect(again.undo()).toBe(true);
    expect(again.secrets().hand).toHaveLength(0);
    expect(again.undo()).toBe(false);
    expect(again.canUndo()).toBe(false);
  });

  it('a table saved right after a shuffle has nothing to undo after the reload', async () => {
    const db = await stores();
    const s = await withDeck(db);
    await s.draw(1);
    await s.shuffle();
    await s.whenSaved();
    const again = await session(await reload(db.db.name));
    expect(again.canUndo()).toBe(false);
  });
});
