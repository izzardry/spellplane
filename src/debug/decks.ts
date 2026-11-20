/**
 * The `decks` part of the debug hook (decks.md section 7 "Debug hook"; contracts.md Part C): `list()`, `get(id)`,
 * `summary(id)`, `edit(id, op)` (through data/deck/edit.ts, so the seal answers as it does in the app), `setOffline(on)`
 * (the fixture source's card search fails while on), `nextSeed(hex)` and `select(id)`. Dev and test builds only.
 *
 * `registerDecksDebug(decks)` is called by debug/index.ts with the app's deck store; the card source and the settings
 * are attached by whoever has them (the decks harness, or the deck mode route while it is mounted) through
 * `attachDecksDebug`. Without card data `edit` still answers the seal from the record (a card outside the pool is
 * `notInPool`), and `summary` returns the stored summary. Owner: M8-P3.
 */
import type { CardLookup } from '../data/deck/analyse';
import { applyEdit, type EditOp, type EditResult } from '../data/deck/edit';
import { summarise } from '../data/deck/summary';
import type { CardData, CardDataSource } from '../data/types';
import type { DeckRecord, DeckStore, DeckSummary, SettingsStore } from '../store/types';
import { pinNextSeed } from '../ui/decks/state/open';
import { registerDebug } from '../util/debug';

declare module './types' {
  // Members of the `decks` part beyond the contract's `list()` (M8-P3; module augmentation, the contract file is untouched).
  interface DecksDebug {
    get(id: string): Promise<DeckRecord | null>;
    /** The stored summary, or one computed now from the card data when the record has none. */
    summary(id: string): Promise<DeckSummary | null>;
    /** Apply one edit and save it; refusals are answered and nothing is saved. */
    edit(id: string, op: EditOp): Promise<EditResult | { ok: false; reason: 'gone' }>;
    /** The card source's search fails while on (the fixture source); the deck page's search field disables. */
    setOffline(on: boolean): void;
    /** Pin the seed of the next OPEN. */
    nextSeed(hex: string | null): void;
    /** Settings.home.deckId. */
    select(id: string | null): Promise<void>;
    selected(): Promise<string | null>;
  }
}

/** What the harness or the deck mode route attaches. */
export interface DecksDebugAttach {
  decks?: DeckStore | null;
  cardData?: CardDataSource | null;
  settings?: SettingsStore | null;
  now?: () => number;
  /** Notified after an edit through the hook was saved (an open deck page reloads the record). */
  onchange?: (id: string) => void;
}

const deps: Required<Pick<DecksDebugAttach, 'now'>> & Omit<DecksDebugAttach, 'now'> = { now: () => Date.now() };
const offlineListeners = new Set<(on: boolean) => void>();
let offline = false;

/** Add or replace the parts the hook works on; returns a function that removes the listener-like parts again. */
export function attachDecksDebug(more: DecksDebugAttach): () => void {
  Object.assign(deps, more);
  return () => {
    if (more.onchange && deps.onchange === more.onchange) delete deps.onchange;
  };
}

/** Whether the hook set the card search offline. */
export function decksOffline(): boolean {
  return offline;
}

/** The deck page listens, so its search field disables at once when a test sets the source offline. */
export function onDecksOffline(fn: (on: boolean) => void): () => void {
  offlineListeners.add(fn);
  return () => offlineListeners.delete(fn);
}

function lookup(): CardLookup {
  return (r) => deps.cardData?.peek(r.sid) ?? null;
}

async function load(sids: string[]): Promise<void> {
  if (deps.cardData && sids.length) await deps.cardData.getMany([...new Set(sids)]).catch((): Record<string, CardData | null> => ({}));
}

/** Register `window.__spellplane.decks` over the page's deck library (null when storage cannot be opened). */
export function registerDecksDebug(decks: DeckStore | null): void {
  if (decks) deps.decks = decks;
  registerDebug({
    decks: {
      list: async () => (deps.decks ? deps.decks.list() : []),
      get: async (id) => (deps.decks ? deps.decks.get(id) : null),
      async summary(id) {
        const d = await deps.decks?.get(id);
        if (!d) return null;
        if (d.summary) return d.summary;
        await load(d.main.map((r) => r.sid));
        return summarise(d, lookup());
      },
      async edit(id, op) {
        const store = deps.decks;
        const d = await store?.get(id);
        if (!d || !store) return { ok: false, reason: 'gone' };
        const sid = 'sid' in op && typeof op.sid === 'string' ? [op.sid] : [];
        await load([...sid, ...d.main.map((r) => r.sid)]);
        const r = applyEdit(d, op, lookup());
        if (!r.ok) return r;
        const saved: DeckRecord = { ...r.deck, updatedAt: deps.now() };
        saved.summary = summarise(saved, lookup());
        await store.put(saved);
        deps.onchange?.(id);
        return { ok: true, deck: saved };
      },
      setOffline(on) {
        offline = on;
        const src = deps.cardData as (CardDataSource & { offline?: boolean }) | null | undefined;
        if (src && 'offline' in src) src.offline = on;
        offlineListeners.forEach((f) => f(on));
      },
      nextSeed: (hex) => pinNextSeed(hex),
      async select(id) {
        if (!deps.settings) return;
        const home = await deps.settings.get('home');
        await deps.settings.set('home', { ...home, deckId: id });
      },
      async selected() {
        return deps.settings ? (await deps.settings.get('home')).deckId : null;
      },
    },
  });
}
