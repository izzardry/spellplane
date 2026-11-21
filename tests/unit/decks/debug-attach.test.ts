/** The decks debug hook's attachments (M8-P3): a destroyed page takes its card source, store and settings away again. */
import { describe, expect, it } from 'vitest';
import type { CardDataSource } from '../../../src/data/types';
import type { DeckStore } from '../../../src/store/types';
import { attachDecksDebug, decksDebugDeps } from '../../../src/ui/decks/debug';

const store = (): DeckStore => ({ list: async () => [], get: async () => null, put: async () => undefined, delete: async () => undefined });

describe('attachDecksDebug', () => {
  it('detaching leaves nothing of that page behind, in either order', () => {
    const a = { decks: store(), cardData: {} as CardDataSource, settings: null, now: () => 1 };
    const b = { decks: store(), cardData: {} as CardDataSource, now: () => 2 };
    const offA = attachDecksDebug(a);
    const offB = attachDecksDebug(b);
    expect(decksDebugDeps().cardData).toBe(b.cardData);
    // The older page is destroyed after the newer one mounted: the newer one's parts stay.
    offA();
    expect(decksDebugDeps().cardData).toBe(b.cardData);
    expect(decksDebugDeps().decks).toBe(b.decks);
    offB();
    expect(decksDebugDeps().cardData).toBeUndefined();
    expect(decksDebugDeps().decks).toBeUndefined();
    expect(decksDebugDeps().settings).toBeUndefined();
    expect(decksDebugDeps().now?.()).toBeGreaterThan(2);
    offB();
  });
});
