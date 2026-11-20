/**
 * The deck library's model (journey.md 4.2 with the ruling "no summary panel"; decks.md section 3 D1): the list, the
 * filter ALL · CUSTOM · BOOSTER, the selected deck (Settings.home.deckId), PLAY (refused while a search runs),
 * duplicate, rename, convert, and delete with an undo window: the tile goes at once, the record is deleted when the
 * window ends or the library is left. Summaries are computed lazily for records that lack a current one. Plain
 * TypeScript with injected timers; the Svelte page renders it. Implementer: M8-P3.
 */
import { summarise, summaryStale } from '../../../data/deck/summary';
import { convertToCustom, duplicateDeck } from '../../../data/deck/seal';
import type { CardDataSource } from '../../../data/types';
import type { DeckRecord, DeckStore, SettingsStore } from '../../../store/types';

export type LibraryFilter = 'all' | 'custom' | 'sealed';
export const UNDO_WINDOW_MS = 5000;
export const SEARCH_LOCK_TEXT = 'Cancel the search to change deck.';

export interface LibraryDeps {
  decks: DeckStore;
  settings: SettingsStore | null;
  cardData: CardDataSource;
  newId: () => string;
  now: () => number;
  /** True while a matchmaking search runs: the selected deck is locked (contracts.md Part E). */
  searching?: () => boolean;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (t: unknown) => void;
  onchange?: () => void;
}

export class DeckLibrary {
  decks: DeckRecord[] = [];
  filter: LibraryFilter = 'all';
  selectedId: string | null = null;
  private pending = new Map<string, { deck: DeckRecord; timer: unknown }>();

  constructor(private readonly deps: LibraryDeps) {}

  private changed(): void {
    this.deps.onchange?.();
  }

  /** Read the list and the selection; fill missing summaries from card data and save them. */
  async load(): Promise<void> {
    this.decks = (await this.deps.decks.list()).filter((d) => !this.pending.has(d.id));
    this.selectedId = this.deps.settings ? (await this.deps.settings.get('home')).deckId : this.selectedId;
    this.changed();
    await this.refreshSummaries();
  }

  async refreshSummaries(): Promise<void> {
    const stale = this.decks.filter(summaryStale);
    if (stale.length === 0) return;
    const sids = [...new Set(stale.flatMap((d) => d.main.map((r) => r.sid)))];
    await this.deps.cardData.getMany(sids).catch(() => ({}));
    for (const d of stale) {
      const fresh: DeckRecord = { ...d, summary: summarise(d, (r) => this.deps.cardData.peek(r.sid)) };
      // Only a summary that knows its cards is worth keeping.
      if (fresh.summary!.unknown < fresh.main.length || fresh.main.length === 0) await this.deps.decks.put(fresh).catch(() => undefined);
      this.decks = this.decks.map((x) => (x.id === d.id ? fresh : x));
    }
    this.changed();
  }

  /** The tiles under the current filter, newest change first. */
  get visible(): DeckRecord[] {
    return this.decks.filter((d) => this.filter === 'all' || (d.kind ?? 'custom') === this.filter);
  }

  setFilter(f: LibraryFilter): void {
    this.filter = f;
    this.changed();
  }

  /** Select the deck Home plays with; refused (with the line to show) while a search runs. */
  async select(id: string): Promise<true | string> {
    if (this.deps.searching?.() && id !== this.selectedId) return SEARCH_LOCK_TEXT;
    this.selectedId = id;
    if (this.deps.settings) {
      const home = await this.deps.settings.get('home');
      await this.deps.settings.set('home', { ...home, deckId: id });
    }
    this.changed();
    return true;
  }

  async duplicate(id: string): Promise<DeckRecord | null> {
    const d = this.decks.find((x) => x.id === id);
    if (!d) return null;
    const copy = duplicateDeck(d, this.deps.newId(), this.deps.now());
    // The copy's own summary at once, so its tile and Home read it before the library loads again.
    copy.summary = summarise(copy, (r) => this.deps.cardData.peek(r.sid));
    await this.deps.decks.put(copy);
    this.decks = [copy, ...this.decks];
    this.changed();
    return copy;
  }

  async rename(id: string, name: string): Promise<void> {
    const n = name.trim().slice(0, 60);
    const d = this.decks.find((x) => x.id === id);
    if (!d || !n) return;
    const next = { ...d, name: n, updatedAt: this.deps.now() };
    if (next.summary) next.summary = { ...next.summary, at: next.updatedAt };
    await this.deps.decks.put(next);
    this.decks = this.decks.map((x) => (x.id === id ? next : x));
    this.changed();
  }

  /** "Convert to custom deck": a custom copy; the booster deck stays as it is. */
  async convert(id: string): Promise<DeckRecord | null> {
    const d = this.decks.find((x) => x.id === id);
    if (!d || d.kind !== 'sealed') return null;
    const copy = convertToCustom(d, this.deps.newId(), this.deps.now());
    copy.summary = summarise(copy, (r) => this.deps.cardData.peek(r.sid));
    await this.deps.decks.put(copy);
    this.decks = [copy, ...this.decks];
    this.changed();
    return copy;
  }

  /** Remove the tile now and delete the record when the undo window ends. */
  remove(id: string): DeckRecord | null {
    const d = this.decks.find((x) => x.id === id);
    if (!d) return null;
    this.decks = this.decks.filter((x) => x.id !== id);
    const set = this.deps.setTimer ?? ((fn: () => void, ms: number) => setTimeout(fn, ms));
    const timer = set(() => void this.commit(id), UNDO_WINDOW_MS);
    this.pending.set(id, { deck: d, timer });
    this.changed();
    return d;
  }

  undoRemove(id: string): boolean {
    const p = this.pending.get(id);
    if (!p) return false;
    (this.deps.clearTimer ?? ((t: unknown) => clearTimeout(t as ReturnType<typeof setTimeout>)))(p.timer);
    this.pending.delete(id);
    this.decks = [...this.decks, p.deck].sort((a, b) => b.updatedAt - a.updatedAt);
    this.changed();
    return true;
  }

  private async commit(id: string): Promise<void> {
    if (!this.pending.delete(id)) return;
    await this.deps.decks.delete(id);
    if (this.selectedId === id && this.deps.settings) {
      this.selectedId = null;
      const home = await this.deps.settings.get('home');
      if (home.deckId === id) await this.deps.settings.set('home', { ...home, deckId: null });
    }
    this.changed();
  }

  /** Leaving the library deletes what is waiting for its undo window. */
  async dispose(): Promise<void> {
    const ids = [...this.pending.keys()];
    for (const id of ids) {
      (this.deps.clearTimer ?? ((t: unknown) => clearTimeout(t as ReturnType<typeof setTimeout>)))(this.pending.get(id)!.timer);
      await this.commit(id);
    }
  }
}

const fresh = new Set<string>();

/** A new custom deck made by the chooser: written at once so its page can open it, removed again if left untouched. */
export function markFresh(id: string): void {
  fresh.add(id);
}

/** Whether the deck was made by the chooser and not edited since (and forget it). */
export function takeFresh(id: string): boolean {
  return fresh.delete(id);
}
