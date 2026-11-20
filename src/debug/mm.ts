/**
 * The matchmaking part of the debug hook (dev and test builds): `window.__spellplane.mm` (matchmaking.md 2.13; PLAN
 * M8-P7 E2E). Tests drive and read the page's matchmaker here, never pixels: `status()`, `tickets()`, `messages()`,
 * `broker()`, `tick(ms)` (moves the matchmaker's clock, so the 10 s alone text and the 20 s ready ring are never slept
 * through) and `seek(...)` (instead of Home; it may first store a deck record). M8-P7.
 */
import type { QueueId } from '../core/types';
import type { BrokerState } from '../net/lobby/broker';
import type { Ticket } from '../net/lobby/messages';
import type { LobbyMessageRecord } from '../net/lobby/room';
import type { MatchmakerControl } from '../session/matchmaker';
import type { Matchmaker, MatchmakerStatus } from '../session/types';
import type { DeckRecord, DeckStore } from '../store/types';
import { registerDebug, type DebugParts } from '../util/debug';

export interface MmDebug {
  status(): MatchmakerStatus;
  /** This page's ticket (if seeking) and the verified tickets of the other seekers. */
  tickets(): Ticket[];
  messages(): LobbyMessageRecord[];
  broker(): BrokerState | null;
  /** Move the matchmaker's clock forward by `ms` and run one tick. */
  tick(ms: number): void;
  /** Start a search; with `deck`, that record is stored first and its id used. */
  seek(o: { queues?: QueueId[]; deckId?: string; deck?: DeckRecord }): Promise<void>;
  answer(accept: boolean): void;
  cancel(): void;
  widen(): void;
  watch(on: boolean): void;
  /** How often the matchFound chime was asked for. */
  chimes(): number;
  notice(): string | null;
}

let chimeCount = 0;
/** Counted by the app's MatchHost chime (src/ui/play/MatchHost.svelte through main.ts or App.svelte). */
export function countChime(): void {
  chimeCount++;
}

function control(mm: Matchmaker): Partial<MatchmakerControl> {
  return mm as Partial<MatchmakerControl>;
}

/** Register `window.__spellplane.mm` for the page's matchmaker. */
export function registerMmDebug(mm: Matchmaker | null | undefined, deps: { decks?: DeckStore | null } = {}): void {
  if (!__SPELLPLANE_DEBUG__ || !mm) return;
  const c = control(mm);
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
    async seek(o) {
      let deckId = o.deckId ?? o.deck?.id ?? 'no-deck';
      if (o.deck && deps.decks) {
        await deps.decks.put(o.deck);
        deckId = o.deck.id;
      }
      mm.seek({ queues: o.queues ?? ['1v1.constructed.casual'], deckId });
    },
    answer: (a) => mm.answer(a),
    cancel: () => mm.cancel(),
    widen: () => mm.widen(),
    watch: (on) => mm.watch(on),
    chimes: () => chimeCount,
    notice: () => c.notice?.() ?? null,
  };
  registerDebug({ mm: api } as unknown as Partial<DebugParts>);
}
