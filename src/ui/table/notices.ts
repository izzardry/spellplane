/**
 * The table's one notice slot (journey.md 4.10; m7-adjustments.md section 2 `HudShellProps.notice`; PLAN M8-C "Shared
 * glue"): a message through the HUD's one toast place ("Ben left the table. The game is saved."), with an optional
 * action. A new notice replaces the old one. The frame passes `notices.current()` to the HUD. Added by M8-C.
 */

/** One notice (HudShellProps.notice). */
export interface TableNotice {
  id: number;
  text: string;
  action?: { label: string; run: () => void };
}

/** The notice slot as a store. */
export interface NoticeStore {
  /** Show a notice (replacing the current one); returns its id. */
  show(text: string, action?: { label: string; run: () => void }): number;
  /** Clear the notice `id` (or any notice when omitted). */
  clear(id?: number): void;
  current(): TableNotice | null;
  subscribe(listener: (notice: TableNotice | null) => void): () => void;
}

/** A notice slot of its own (one per mounted table frame). */
export function createNotices(): NoticeStore {
  let seq = 0;
  let notice: TableNotice | null = null;
  const listeners = new Set<(n: TableNotice | null) => void>();
  const emit = (): void => {
    for (const l of [...listeners]) l(notice);
  };
  return {
    show(text, action) {
      notice = action ? { id: ++seq, text, action } : { id: ++seq, text };
      emit();
      return notice.id;
    },
    clear(id) {
      if (notice && (id === undefined || notice.id === id)) {
        notice = null;
        emit();
      }
    },
    current: () => notice,
    subscribe(listener) {
      listeners.add(listener);
      listener(notice);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

/** The page's notice slot: the table frame shows it; modules post to it. */
export const notices: NoticeStore = createNotices();
