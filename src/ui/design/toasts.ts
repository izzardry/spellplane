/**
 * The toast store (docs/design/m8/contracts.md Part B "ToastHost"; visual.md 2.8): destructive actions get an undo toast
 * (5 s), requests from another player stay until answered, presence and connection messages share one status slot.
 * `toasts` is the page's store; `ToastHost.svelte` shows it. A simple working version by M8-C (undo toasts share no
 * timer and `UNDO ALL` is not offered yet); M8-P1 owns the file.
 */

/** The four kinds of toast (visual.md 2.8). */
export type ToastKind = 'undo' | 'request' | 'status' | 'info';

/** A button on a toast. */
export interface ToastAction {
  label: string;
  primary?: boolean;
  run(): void;
}

/** One toast as the host shows it. */
export interface ToastEntry {
  id: number;
  kind: ToastKind;
  text: string;
  detail?: string | undefined;
  actions: ToastAction[];
}

/** Options of an undo toast. */
export interface UndoOptions {
  detail?: string;
  /** Runs when the toast times out unanswered (the change becomes final). */
  commit?: () => void;
}

/** How long an undo or info toast stays (visual.md 2.8: "5 s"). */
export const TOAST_MS = 5000;

/** The toast store (contracts.md Part B). */
export interface ToastStore {
  undo(text: string, undo: () => void, opts?: UndoOptions): number;
  info(text: string, action?: { label: string; run(): void }): number;
  request(text: string, answers: { allow(): void; decline(): void }): { id: number; withdraw(): void };
  status(text: string | null): void;
  clear(): void;
  /** Close one toast without running its callbacks. */
  dismiss(id: number): void;
  list(): readonly ToastEntry[];
  subscribe(listener: (list: readonly ToastEntry[]) => void): () => void;
}

/** A toast store with its own timers (plain setTimeout; fake timers drive them in tests). */
export function createToasts(ms = TOAST_MS): ToastStore {
  let seq = 0;
  let entries: ToastEntry[] = [];
  const timers = new Map<number, ReturnType<typeof setTimeout>>();
  const listeners = new Set<(list: readonly ToastEntry[]) => void>();
  const emit = (): void => {
    for (const l of [...listeners]) l(entries);
  };
  const remove = (id: number): void => {
    const t = timers.get(id);
    if (t !== undefined) clearTimeout(t);
    timers.delete(id);
    entries = entries.filter((e) => e.id !== id);
    emit();
  };
  const add = (entry: ToastEntry, timeout: (() => void) | null): number => {
    entries = [...entries, entry];
    if (timeout) timers.set(entry.id, setTimeout(() => {
      timers.delete(entry.id);
      remove(entry.id);
      timeout();
    }, ms));
    emit();
    return entry.id;
  };
  return {
    undo(text, undo, opts = {}) {
      const id = ++seq;
      return add({ id, kind: 'undo', text, detail: opts.detail, actions: [{ label: 'Undo', primary: true, run: () => (remove(id), undo()) }] }, () => opts.commit?.());
    },
    info(text, action) {
      const id = ++seq;
      return add({ id, kind: 'info', text, actions: action ? [{ label: action.label, run: () => (remove(id), action.run()) }] : [] }, () => undefined);
    },
    request(text, answers) {
      const id = ++seq;
      add(
        {
          id,
          kind: 'request',
          text,
          actions: [
            { label: 'Decline', run: () => (remove(id), answers.decline()) },
            { label: 'Allow', primary: true, run: () => (remove(id), answers.allow()) },
          ],
        },
        null,
      );
      return { id, withdraw: () => remove(id) };
    },
    status(text) {
      for (const e of entries.filter((x) => x.kind === 'status')) remove(e.id);
      if (text !== null) add({ id: ++seq, kind: 'status', text, actions: [] }, null);
    },
    clear() {
      for (const t of timers.values()) clearTimeout(t);
      timers.clear();
      entries = [];
      emit();
    },
    dismiss: remove,
    list: () => entries,
    subscribe(listener) {
      listeners.add(listener);
      listener(entries);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

/** The page's toasts (contracts.md Part B: `toasts.undo`, `toasts.info`, `toasts.request`, `toasts.status`, `toasts.clear`). */
export const toasts: ToastStore = createToasts();
