/**
 * The `decks` part of the debug hook (decks.md section 7 "Debug hook"; contracts.md Part C): `list()`, `get(id)`,
 * `summary(id)`, `edit(id, op)` (through data/deck/edit.ts, so the seal answers as it does in the app), `setOffline(on)`
 * (the fixture source's card search fails while on), `nextSeed(hex)` and `select(id)`. Dev and test builds only.
 * Owner: M8-P3.
 */
import type { CardLookup } from '../data/deck/analyse';
import { applyEdit, type EditOp, type EditResult } from '../data/deck/edit';
import { summarise } from '../data/deck/summary';
import type { CardDataSource } from '../data/types';
import type { DeckRecord, DeckStore, DeckSummary, SettingsStore } from '../store/types';
import { pinNextSeed } from '../ui/decks/state/open';
import { registerDebug } from '../util/debug';

export interface DecksDebug {
  list(): Promise<DeckRecord[]>;
  get(id: string): Promise<DeckRecord | null>;
  /** The stored summary, or one computed now from the card data when the record has none. */
  summary(id: string): Promise<DeckSummary | null>;
  /** Apply one edit and save it; refusals are answered and nothing is saved. */
  edit(id: string, op: EditOp): Promise<EditResult | { ok: false; reason: 'gone' }>;
  setOffline(on: boolean): void;
  nextSeed(hex: string | null): void;
  select(id: string | null): Promise<void>;
  /** Settings.home.deckId. */
  selected(): Promise<string | null>;
}

declare module '../util/debug' {
  interface DebugParts {
    decks: DecksDebug;
  }
}

export interface DecksDebugDeps {
  decks: DeckStore | null;
  cardData: CardDataSource;
  settings?: SettingsStore | null;
  now?: () => number;
  /** Notified after an edit through the hook was saved (the open page reloads the record). */
  onchange?: (id: string) => void;
}

/** Register the hook over the given stores (the app, or the decks harness over its own profile). */
export function registerDecksDebug(deps?: DecksDebugDeps): void {
  if (!deps) return;
  const lookup: CardLookup = (r) => deps.cardData.peek(r.sid);
  const now = deps.now ?? (() => Date.now());
  const api: DecksDebug = {
    list: async () => (deps.decks ? deps.decks.list() : []),
    get: async (id) => (deps.decks ? deps.decks.get(id) : null),
    async summary(id) {
      const d = await deps.decks?.get(id);
      if (!d) return null;
      await deps.cardData.getMany([...new Set(d.main.map((r) => r.sid))]).catch(() => ({}));
      return d.summary ?? summarise(d, lookup);
    },
    async edit(id, op) {
      const d = await deps.decks?.get(id);
      if (!d || !deps.decks) return { ok: false, reason: 'gone' };
      const sid = 'sid' in op && typeof op.sid === 'string' ? [op.sid] : [];
      await deps.cardData.getMany([...sid, ...d.main.map((r) => r.sid)]).catch(() => ({}));
      const r = applyEdit(d, op, lookup);
      if (!r.ok) return r;
      const saved: DeckRecord = { ...r.deck, updatedAt: now() };
      saved.summary = summarise(saved, lookup);
      await deps.decks.put(saved);
      deps.onchange?.(id);
      return { ok: true, deck: saved };
    },
    setOffline(on) {
      const src = deps.cardData as CardDataSource & { offline?: boolean };
      if ('offline' in src) src.offline = on;
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
  };
  registerDebug({ decks: api });
}

const offlineListeners = new Set<(on: boolean) => void>();

/** The deck page listens, so its search field disables at once when a test sets the source offline. */
export function onDecksOffline(fn: (on: boolean) => void): () => void {
  offlineListeners.add(fn);
  return () => offlineListeners.delete(fn);
}
