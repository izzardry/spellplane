/**
 * The `decks` part of the debug hook (decks.md section 7 "Debug hook"; contracts.md Part C): `list()`, `get(id)`,
 * `summary(id)`, `edit(id, op)` (through data/deck/edit.ts, so the seal answers as it does in the app), `setOffline(on)`
 * (the card search fails while on), `nextSeed(hex)`, `select(id)` and `selected()`. Dev and test builds only
 * (`registerDebug` is a no-op otherwise). The members beyond the contract's `list()` are declared in debug/decks.ts.
 *
 * `registerDecksDebug(decks)` (debug/decks.ts, called by debug/index.ts with the app's deck store) registers it; the
 * card source and the settings are attached by whoever has them (the decks harness, or DecksRoute while mounted)
 * through `attachDecksDebug`. Without card data `edit` still answers the seal from the record (a card outside the pool
 * is `notInPool`), and `summary` returns the stored summary. Implementer: M8-P3.
 */
import type { CardLookup } from '../../data/deck/analyse';
import { applyEdit } from '../../data/deck/edit';
import { summarise } from '../../data/deck/summary';
import { settleEdited } from '../../store/decks';
import type { CardData, CardDataSource } from '../../data/types';
import type { DeckRecord, DeckStore, SettingsStore } from '../../store/types';
import { registerDebug } from '../../util/debug';
import { pinNextSeed } from './state/open';

/** What the harness or the deck mode route attaches. */
export interface DecksDebugAttach {
  decks?: DeckStore | null;
  cardData?: CardDataSource | null;
  settings?: SettingsStore | null;
  now?: () => number;
  /** Notified after an edit through the hook was saved (an open deck page reloads the record). */
  onchange?: (id: string) => void;
}

type Deps = Required<Pick<DecksDebugAttach, 'now'>> & Omit<DecksDebugAttach, 'now'>;
/** What registerDecksPart set (the page's deck store); the attachments of mounted pages lie over it, latest last. */
const base: Deps = { now: () => Date.now() };
const attached: DecksDebugAttach[] = [];
const deps: Deps = { ...base };

function recompute(): void {
  for (const k of Object.keys(deps) as (keyof Deps)[]) delete deps[k];
  Object.assign(deps, base, ...attached);
}
const offlineListeners = new Set<(on: boolean) => void>();
let offline = false;

/**
 * Add or replace the parts the hook works on; the returned function takes them away again (what an earlier attachment
 * or registerDecksPart set shows through), so a destroyed page leaves no card source or store behind in module state.
 */
export function attachDecksDebug(more: DecksDebugAttach): () => void {
  const mine = { ...more };
  attached.push(mine);
  recompute();
  return () => {
    const i = attached.indexOf(mine);
    if (i < 0) return;
    attached.splice(i, 1);
    recompute();
  };
}

/** What the hook works on now (tests). */
export function decksDebugDeps(): Readonly<DecksDebugAttach> {
  return { ...deps };
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
export function registerDecksPart(decks: DeckStore | null): void {
  if (decks) {
    base.decks = decks;
    recompute();
  }
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
        const saved: DeckRecord = { ...settleEdited(r.deck), updatedAt: deps.now() };
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
