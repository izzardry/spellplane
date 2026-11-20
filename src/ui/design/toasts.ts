/**
 * The toast store (docs/design/m8/contracts.md Part B "ToastHost"; visual.md V21, 2.8): destructive actions get an
 * undo toast, never a question; requests from another player are a toast with two buttons that stays until answered
 * or withdrawn; presence and connection messages share one status slot (a new one replaces the old one).
 *
 * - `undo(text, undo, opts?)`: lives 5 s; a second undo toast restarts the shared timer and the newest shows
 *   `UNDO ALL`, which undoes every pending one, newest first. When the timer runs out every undo toast closes and
 *   each `opts.commit` runs (the removal becomes final).
 * - `info(text, action?)`: lives 5 s, one optional action.
 * - `request(text, { allow, decline })`: until answered, or until the returned `withdraw()` is called.
 * - `status(text | null)`: the one status slot; `null` clears it.
 * - `clear()`: closes everything without running any callback.
 *
 * Timers are plain `setTimeout`s (fake timers in tests drive them); nothing runs per frame. Added by M8-P1.
 */

export type ToastKind = 'undo' | 'request' | 'status' | 'info';

export interface ToastAction {
  label: string;
  primary?: boolean;
  run(): void;
}

export interface ToastEntry {
  id: number;
  kind: ToastKind;
  text: string;
  detail?: string | undefined;
  actions: ToastAction[];
}

export interface UndoOptions {
  detail?: string;
  /** Runs when the toast times out unanswered (the change becomes final). */
  commit?: () => void;
}

/** How long an undo or info toast stays (visual.md 2.8: "5 s"). */
export const TOAST_MS = 5000;

interface Pending {
  id: number;
  text: string;
  detail?: string | undefined;
  undo: () => void;
  commit?: (() => void) | undefined;
}

export interface ToastStore {
  undo(text: string, undo: () => void, opts?: UndoOptions): number;
  info(text: string, action?: { label: string; run(): void }): number;
  request(text: string, answers: { allow(): void; decline(): void }): { id: number; withdraw(): void };
  status(text: string | null): void;
  clear(): void;
  /** Closes one toast without running its callbacks (the close icon). An undo toast closed this way commits. */
  dismiss(id: number): void;
  list(): readonly ToastEntry[];
  subscribe(listener: (list: readonly ToastEntry[]) => void): () => void;
}

export function createToasts(ms = TOAST_MS): ToastStore {
  let seq = 0;
  let undos: Pending[] = [];
  let undoTimer: ReturnType<typeof setTimeout> | null = null;
  let infos: { entry: ToastEntry; timer: ReturnType<typeof setTimeout> }[] = [];
  let requests: ToastEntry[] = [];
  let statusEntry: ToastEntry | null = null;
  let snapshot: readonly ToastEntry[] = [];
  const listeners = new Set<(list: readonly ToastEntry[]) => void>();

  function undoEntries(): ToastEntry[] {
    return undos.map((u, i) => {
      const newest = i === undos.length - 1;
      const actions: ToastAction[] = [{ label: 'Undo', primary: newest && undos.length === 1, run: () => undoOne(u.id) }];
      if (newest && undos.length > 1) actions.push({ label: 'Undo all', primary: true, run: undoAll });
      return { id: u.id, kind: 'undo' as const, text: u.text, detail: u.detail, actions };
    });
  }

  function emit(): void {
    snapshot = [...(statusEntry ? [statusEntry] : []), ...requests, ...infos.map((i) => i.entry), ...undoEntries()];
    for (const l of [...listeners]) l(snapshot);
  }

  function restartUndoTimer(): void {
    if (undoTimer) clearTimeout(undoTimer);
    undoTimer = undos.length ? setTimeout(expireUndos, ms) : null;
  }

  function expireUndos(): void {
    undoTimer = null;
    const done = undos;
    undos = [];
    emit();
    for (const u of done) u.commit?.();
  }

  function undoOne(id: number): void {
    const u = undos.find((x) => x.id === id);
    if (!u) return;
    undos = undos.filter((x) => x.id !== id);
    restartUndoTimer();
    emit();
    u.undo();
  }

  function undoAll(): void {
    const all = [...undos].reverse();
    undos = [];
    restartUndoTimer();
    emit();
    for (const u of all) u.undo();
  }

  return {
    undo(text, undo, opts = {}) {
      const id = ++seq;
      undos = [...undos, { id, text, detail: opts.detail, undo, commit: opts.commit }];
      restartUndoTimer();
      emit();
      return id;
    },
    info(text, action) {
      const id = ++seq;
      const entry: ToastEntry = { id, kind: 'info', text, actions: action ? [{ label: action.label, primary: true, run: () => (close(id), action.run()) }] : [] };
      const timer = setTimeout(() => close(id), ms);
      infos = [...infos, { entry, timer }];
      emit();
      return id;
    },
    request(text, answers) {
      const id = ++seq;
      const answer = (fn: () => void) => () => {
        if (!requests.some((r) => r.id === id)) return;
        requests = requests.filter((r) => r.id !== id);
        emit();
        fn();
      };
      requests = [...requests, { id, kind: 'request', text, actions: [{ label: 'Decline', run: answer(answers.decline) }, { label: 'Allow', primary: true, run: answer(answers.allow) }] }];
      emit();
      return {
        id,
        withdraw: () => {
          requests = requests.filter((r) => r.id !== id);
          emit();
        },
      };
    },
    status(text) {
      statusEntry = text === null ? null : { id: ++seq, kind: 'status', text, actions: [] };
      emit();
    },
    clear() {
      if (undoTimer) clearTimeout(undoTimer);
      undoTimer = null;
      for (const i of infos) clearTimeout(i.timer);
      undos = [];
      infos = [];
      requests = [];
      statusEntry = null;
      emit();
    },
    dismiss(id) {
      close(id);
    },
    list: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      listener(snapshot);
      return () => {
        listeners.delete(listener);
      };
    },
  };

  function close(id: number): void {
    const u = undos.find((x) => x.id === id);
    if (u) {
      undos = undos.filter((x) => x.id !== id);
      restartUndoTimer();
      emit();
      u.commit?.();
      return;
    }
    const info = infos.find((i) => i.entry.id === id);
    if (info) {
      clearTimeout(info.timer);
      infos = infos.filter((i) => i !== info);
    }
    requests = requests.filter((r) => r.id !== id);
    if (statusEntry?.id === id) statusEntry = null;
    emit();
  }
}

/** The page's one toast store (ToastHost renders it). */
export const toasts: ToastStore = createToasts();
