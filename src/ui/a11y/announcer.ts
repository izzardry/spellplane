/**
 * The page's live region (DESIGN "Input and interaction design", Accessibility: "The log is a live region, so screen
 * readers announce actions"; PLAN M5-P4: the log as an ARIA live region, polite, not flooding). AnnounceQueue is the
 * pure scheduling: polite texts that arrive close together are spoken as one announcement, a burst becomes a count and
 * its latest line, a focus change is spoken at once and replaces a focus text still waiting, and 'assertive' (prompts
 * addressed to this player) goes out at once on its own region. DomAnnouncer puts the result into two visually hidden
 * live regions, one per page.
 */
import { ANNOUNCE_HISTORY_MAX, type LiveAnnouncer, type Politeness } from './index';

/** Scheduling constants (M5-P4's choice, docs/DECISIONS.md). */
export const ANNOUNCE = {
  /** Polite texts arriving within this of the first are spoken together (ms). */
  batchMs: 400,
  /** At most this many texts are read out in one announcement; a larger burst becomes a count and the latest. */
  maxLines: 3,
  /** Live-region children kept in the DOM (older ones are removed; aria-relevant="additions" ignores removals). */
  keepNodes: 3,
} as const;

/** Where announcements go. */
export interface AnnounceSink {
  write(text: string, politeness: Politeness): void;
}

/** Timers (fake ones in unit tests). */
export interface AnnounceTimers {
  set(fn: () => void, ms: number): unknown;
  clear(handle: unknown): void;
}

const realTimers: AnnounceTimers = {
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
};

/** One polite announcement for a batch of texts (oldest first). */
export function batchText(texts: readonly string[]): string {
  if (texts.length <= ANNOUNCE.maxLines) return texts.join('. ');
  return `${texts.length} new log lines. Latest: ${texts[texts.length - 1]}`;
}

/** The scheduling of the live region (pure apart from the injected sink and timers). */
export class AnnounceQueue implements LiveAnnouncer {
  private pending: string[] = [];
  private timer: unknown = null;
  private said: string[] = [];

  constructor(
    private readonly sink: AnnounceSink,
    private readonly timers: AnnounceTimers = realTimers,
  ) {}

  /** Polite texts wait up to ANNOUNCE.batchMs to be joined with what follows; assertive ones go out at once. */
  announce(text: string, politeness: Politeness = 'polite'): void {
    const t = text.trim();
    if (!t) return;
    if (politeness === 'assertive') {
      this.emit(t, 'assertive');
      return;
    }
    this.pending.push(t);
    if (this.timer === null) this.timer = this.timers.set(() => this.flush(), ANNOUNCE.batchMs);
  }

  /** A keyboard focus change: spoken at once (it answers a key press), never batched with log lines. */
  focus(text: string): void {
    const t = text.trim();
    if (t) this.emit(t, 'polite');
  }

  /** Speak what waits now. */
  flush(): void {
    if (this.timer !== null) this.timers.clear(this.timer);
    this.timer = null;
    const batch = this.pending;
    this.pending = [];
    if (batch.length) this.emit(batchText(batch), 'polite');
  }

  history(): string[] {
    return [...this.said];
  }

  /** Drop what waits (the page leaves the table). */
  dispose(): void {
    if (this.timer !== null) this.timers.clear(this.timer);
    this.timer = null;
    this.pending = [];
  }

  private emit(text: string, politeness: Politeness): void {
    this.said.push(text);
    if (this.said.length > ANNOUNCE_HISTORY_MAX) this.said.splice(0, this.said.length - ANNOUNCE_HISTORY_MAX);
    this.sink.write(text, politeness);
  }
}

const SR_ONLY = 'position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip-path:inset(50%);white-space:nowrap;border:0;';

/** Two visually hidden live regions in `host` (document.body by default): one polite, one assertive. */
export function domSink(host: HTMLElement = document.body): AnnounceSink & { remove(): void } {
  const region = (politeness: Politeness) => {
    const el = document.createElement('div');
    el.setAttribute('aria-live', politeness);
    el.setAttribute('aria-atomic', 'false');
    el.setAttribute('aria-relevant', 'additions');
    el.setAttribute('data-testid', `live-${politeness}`);
    el.setAttribute('style', SR_ONLY);
    host.appendChild(el);
    return el;
  };
  const regions: Record<Politeness, HTMLElement> = { polite: region('polite'), assertive: region('assertive') };
  return {
    write(text, politeness) {
      const el = regions[politeness];
      const p = document.createElement('p');
      p.textContent = text;
      el.appendChild(p);
      while (el.childElementCount > ANNOUNCE.keepNodes) el.firstElementChild?.remove();
    },
    remove() {
      regions.polite.remove();
      regions.assertive.remove();
    },
  };
}

let page: { queue: AnnounceQueue; remove(): void; users: number } | null = null;

/**
 * The page's announcer (one per page, M5-C): created on first use with its live regions in document.body; `release`
 * removes them once the last user (a table HUD) is gone.
 */
export function pageAnnouncer(): { announcer: AnnounceQueue; release(): void } {
  if (!page) {
    const sink = domSink();
    page = { queue: new AnnounceQueue(sink), remove: () => sink.remove(), users: 0 };
  }
  const p = page;
  p.users++;
  let released = false;
  return {
    announcer: p.queue,
    release() {
      if (released) return;
      released = true;
      p.users--;
      if (p.users <= 0 && page === p) {
        p.queue.dispose();
        p.remove();
        page = null;
      }
    },
  };
}
