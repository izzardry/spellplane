/**
 * The open deck of the deck page (decks.md section 7 "Storage"; D26): every change goes through data/deck/edit.ts,
 * the last 50 records before each edit are undoable (a multi-card step such as `+N LANDS` or the suggestion is one
 * step), and the record saves itself 400 ms after the last edit and at once on `flush()` (DONE, leaving, pagehide). Each
 * save refreshes `updatedAt` and the summary. Plain TypeScript with injected timers so the page and tests share it.
 * Implementer: M8-P3.
 */
import type { CardLookup } from '../../../data/deck/analyse';
import type { EditResult } from '../../../data/deck/edit';
import { summarise } from '../../../data/deck/summary';
import type { DeckRecord, DeckStore } from '../../../store/types';

export const UNDO_LIMIT = 50;
export const AUTOSAVE_MS = 400;

export interface EditorDeps {
  store: Pick<DeckStore, 'put'>;
  lookup: CardLookup;
  now: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (t: unknown) => void;
  /** Called after every change of the open record or of the undo stacks. */
  onchange?: (deck: DeckRecord) => void;
  /** A save reached the store and nothing newer is waiting. */
  onsaved?: () => void;
  /** A save failed (quota): the deck stays open and dirty. */
  onsaveerror?: (e: unknown) => void;
}

export class DeckEditor {
  private past: DeckRecord[] = [];
  private future: DeckRecord[] = [];
  private timer: unknown = null;
  private dirty = false;
  private saving: Promise<void> = Promise.resolve();
  private disposed = false;

  constructor(
    private current: DeckRecord,
    private readonly deps: EditorDeps,
  ) {}

  get deck(): DeckRecord {
    return this.current;
  }
  get canUndo(): boolean {
    return this.past.length > 0;
  }
  get canRedo(): boolean {
    return this.future.length > 0;
  }
  get isDirty(): boolean {
    return this.dirty;
  }

  /** Apply one or several edits as one undo step; the first refusal stops the step and changes nothing. */
  apply(...steps: ((deck: DeckRecord) => EditResult)[]): EditResult {
    let next = this.current;
    for (const step of steps) {
      const r = step(next);
      if (!r.ok) return r;
      next = r.deck;
    }
    this.past.push(this.current);
    if (this.past.length > UNDO_LIMIT) this.past.shift();
    this.future = [];
    this.set(next);
    return { ok: true, deck: next };
  }

  undo(): boolean {
    const prev = this.past.pop();
    if (!prev) return false;
    this.future.push(this.current);
    this.set(prev);
    return true;
  }

  redo(): boolean {
    const next = this.future.pop();
    if (!next) return false;
    this.past.push(this.current);
    this.set(next);
    return true;
  }

  private set(deck: DeckRecord): void {
    this.current = deck;
    this.dirty = true;
    this.schedule();
    this.deps.onchange?.(deck);
  }

  private schedule(): void {
    const set = this.deps.setTimer ?? ((fn: () => void, ms: number) => setTimeout(fn, ms));
    const clear = this.deps.clearTimer ?? ((t: unknown) => clearTimeout(t as ReturnType<typeof setTimeout>));
    if (this.timer !== null) clear(this.timer);
    this.timer = set(() => {
      this.timer = null;
      void this.flush();
    }, AUTOSAVE_MS);
  }

  /** Save now when there is anything unsaved (DONE, leaving the route, pagehide). */
  flush(): Promise<void> {
    if (this.timer !== null) {
      (this.deps.clearTimer ?? ((t: unknown) => clearTimeout(t as ReturnType<typeof setTimeout>)))(this.timer);
      this.timer = null;
    }
    if (!this.dirty) return this.saving;
    this.dirty = false;
    const now = this.deps.now();
    const record: DeckRecord = { ...this.current, updatedAt: now };
    record.summary = summarise(record, this.deps.lookup);
    this.current = record;
    this.saving = this.saving
      .then(() => this.deps.store.put(record))
      .then(() => {
        if (!this.dirty) this.deps.onsaved?.();
      })
      .catch((e: unknown) => {
        this.dirty = true;
        this.deps.onsaveerror?.(e);
      });
    return this.saving;
  }

  /** Flush and stop the timer; the undo stacks are dropped with the page. */
  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    await this.flush();
    this.past = [];
    this.future = [];
  }
}
