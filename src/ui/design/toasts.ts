/**
 * Kit stub (contracts.md Part B, ToastHost) written by M8-P2 because M8-C's UI commit did not land; M8-P1's file
 * replaces it. One toast slot per page: undo (5 s), info, request, status.
 */
import { writable, type Readable } from 'svelte/store';

export interface ToastItem {
  id: number;
  kind: 'undo' | 'request' | 'status' | 'info';
  text: string;
  actions: { label: string; primary?: boolean; run(): void }[];
}

const UNDO_MS = 5000;
const INFO_MS = 6000;
const list = writable<ToastItem[]>([]);
let next = 1;
const timers = new Map<number, ReturnType<typeof setTimeout>>();

function dismiss(id: number): void {
  const t = timers.get(id);
  if (t !== undefined) clearTimeout(t);
  timers.delete(id);
  list.update((l) => l.filter((x) => x.id !== id));
}

function show(item: Omit<ToastItem, 'id'>, ms: number | null, onexpire?: () => void): number {
  const id = next++;
  list.update((l) => [...l.filter((x) => x.kind !== item.kind || item.kind === 'undo'), { ...item, id }]);
  if (ms !== null)
    timers.set(
      id,
      setTimeout(() => {
        dismiss(id);
        onexpire?.();
      }, ms),
    );
  return id;
}

export const toasts = {
  items: list as Readable<ToastItem[]>,
  undo(text: string, undo: () => void, opts: { onexpire?: () => void } = {}): number {
    const id: number = show({ kind: 'undo', text, actions: [{ label: 'UNDO', primary: true, run: () => (dismiss(id), undo()) }] }, UNDO_MS, opts.onexpire);
    return id;
  },
  info(text: string, action?: { label: string; run(): void }): number {
    const id: number = show({ kind: 'info', text, actions: action ? [{ label: action.label, primary: true, run: () => (dismiss(id), action.run()) }] : [] }, INFO_MS);
    return id;
  },
  request(text: string, a: { allow(): void; decline(): void }): number {
    const id: number = show({ kind: 'request', text, actions: [{ label: 'DECLINE', run: () => (dismiss(id), a.decline()) }, { label: 'ALLOW', primary: true, run: () => (dismiss(id), a.allow()) }] }, null);
    return id;
  },
  status(text: string | null): void {
    list.update((l) => l.filter((x) => x.kind !== 'status'));
    if (text !== null) show({ kind: 'status', text, actions: [] }, null);
  },
  dismiss,
  clear(): void {
    for (const t of timers.values()) clearTimeout(t);
    timers.clear();
    list.set([]);
  },
};
