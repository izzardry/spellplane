/** The deck page's open record (decks.md D26, section 7 "Storage"): undo of 50, one step per gesture, autosave. */
import { describe, expect, it, vi } from 'vitest';
import { add, remove } from '../../../src/data/deck/edit';
import type { DeckRecord } from '../../../src/store/types';
import { DeckEditor, UNDO_LIMIT } from '../../../src/ui/decks/state/editor';
import { customDeck, lookup, named, ref } from './fixture-decks';

function editor(start: DeckRecord = customDeck([])) {
  const saved: DeckRecord[] = [];
  let clock = 1000;
  const e = new DeckEditor(start, { store: { put: (d) => (saved.push(d), Promise.resolve()) }, lookup, now: () => ++clock });
  return { e, saved };
}

describe('DeckEditor', () => {
  it('saves 400 ms after the last edit without DONE, with a fresh summary', async () => {
    vi.useFakeTimers();
    try {
      const { e, saved } = editor();
      for (let i = 0; i < 4; i++) e.apply((d) => add(d, ref('Llanowar Elves'), 'main', 1, named('Llanowar Elves')));
      expect(saved).toHaveLength(0);
      await vi.advanceTimersByTimeAsync(399);
      expect(saved).toHaveLength(0);
      await vi.advanceTimersByTimeAsync(1);
      expect(saved).toHaveLength(1);
      expect(saved[0]!.main).toHaveLength(4);
      expect(saved[0]!.summary?.cards).toBe(4);
      expect(saved[0]!.summary?.at).toBe(saved[0]!.updatedAt);
    } finally {
      vi.useRealTimers();
    }
  });

  it('undo and redo walk the edits; a multi-card step is one undo step; a refusal changes nothing', async () => {
    const { e } = editor();
    e.apply((d) => add(d, ref('Shock'), 'main', 1, named('Shock')));
    e.apply(
      (d) => add(d, ref('Forest'), 'main', 3, named('Forest')),
      (d) => add(d, ref('Plains'), 'main', 2, named('Plains')),
    );
    expect(e.deck.main).toHaveLength(6);
    expect(e.apply((d) => remove(d, ref('Cancel'), 'main', 1))).toEqual({ ok: false, reason: 'absent' });
    e.undo();
    expect(e.deck.main).toHaveLength(1);
    e.undo();
    expect(e.deck.main).toHaveLength(0);
    expect(e.canUndo).toBe(false);
    e.redo();
    e.redo();
    expect(e.deck.main).toHaveLength(6);
    expect(e.canRedo).toBe(false);
    await e.dispose();
  });

  it(`keeps the last ${UNDO_LIMIT} edits`, async () => {
    const { e } = editor();
    for (let i = 0; i < UNDO_LIMIT + 5; i++) e.apply((d) => add(d, ref('Shock'), 'main', 1, named('Shock')));
    let n = 0;
    while (e.undo()) n++;
    expect(n).toBe(UNDO_LIMIT);
    expect(e.deck.main).toHaveLength(5);
    await e.dispose();
  });
});
