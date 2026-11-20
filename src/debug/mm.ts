/**
 * The matchmaking part of the debug hook (dev and test builds): `window.__spellplane.mm` (matchmaking.md 2.13; PLAN
 * M8-P7 E2E). Tests drive and read the page's matchmaker here, never pixels: `status()`, `tickets()`, `messages()`,
 * `broker()`, `tick(ms)` (moves the matchmaker's clock, so the 10 s alone text and the 20 s ready ring are never slept
 * through) and `seek(...)` (instead of Home; it may first store a deck record). M8-P7.
 */
import type { QueueId } from '../core/types';
import type { MatchmakerControl } from '../session/matchmaker';
import type { Matchmaker } from '../session/types';
import type { DeckRecord, DeckStore } from '../store/types';
import { chimeCount } from '../ui/play/mm-view';
import { registerDebug } from '../util/debug';
import type { MmDebug } from './types';

function control(mm: Matchmaker): Partial<MatchmakerControl> {
  return mm as Partial<MatchmakerControl>;
}

/** Register `window.__spellplane.mm` for the page's matchmaker. */
export function registerMmDebug(mm: Matchmaker | null | undefined, deps: { decks?: DeckStore | null } = {}): void {
  if (!__SPELLPLANE_DEBUG__ || !mm) return;
  const c = control(mm);
  const decks = (): DeckStore | null => deps.decks ?? c.decks?.() ?? null;
  const seekWith = async (o: { queues?: QueueId[]; deckId?: string; deck?: DeckRecord }): Promise<void> => {
    let deckId = o.deckId ?? o.deck?.id ?? 'no-deck';
    const store = decks();
    if (o.deck && store) {
      await store.put(o.deck);
      deckId = o.deck.id;
    }
    mm.seek({ queues: o.queues ?? ['1v1.constructed.casual'], deckId });
  };
  const api: MmDebug = {
    status: () => mm.status(),
    tickets() {
      const st = c.room?.()?.state;
      if (!st) return [];
      return [...(st.ticket ? [st.ticket] : []), ...Object.values(st.peers).flatMap((p) => (p.ticket ? [p.ticket] : []))];
    },
    messages: () => c.messages?.() ?? [],
    broker: () => c.room?.()?.state ?? null,
    tick: (ms) => c.advance?.(ms),
    // Accepts the contract's `{ queues, deckId }` and, for specs, `{ deck }` (stored first) or a missing queue list.
    seek: (o) => void seekWith(o),
    seekDeck: (o) => seekWith(o),
    answer: (a) => mm.answer(a),
    cancel: () => mm.cancel(),
    widen: () => mm.widen(),
    watch: (on) => mm.watch(on),
    chimes: () => chimeCount(),
    notice: () => c.notice?.() ?? null,
    matches: async () => (c.matches ? c.matches().list() : []),
  };
  registerDebug({ mm: api });
}
