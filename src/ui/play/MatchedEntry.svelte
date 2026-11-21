<!--
  The automatic entry of a matched table (matchmaking.md 2.6; contracts.md Part C, Part G "Matchmaking"): mounted by the
  table frame when a MatchRecord exists for the room. It runs `runMatchedEntry` (seat and colour by the plan's order,
  enterMatch with autoSetup and matched, the creator starts, the opening hands), shows who is being connected until the
  stage is `match`, and when a member cannot be reached within 30 s it leaves the room at once (the matchmaker is
  already seeking again with the waiting time kept; MatchHost shows why). Once everyone is reached the match must start
  within 30 s more, else it leaves with the reason (a deck that could not be read, a member that never got ready). A
  quiet LEAVE leaves at any time. A game left before its start is void and not in History. Never a waiting room. M8-P7.
-->
<script lang="ts">
  import { onDestroy, untrack } from 'svelte';
  import type { MatchRecord } from '../../core/types';
  import { deckImportOfRecord } from '../../session/deck-build';
  import { abandonMatchedTable, runMatchedEntry, type MatchedEntryStage } from '../../session/match-room';
  import type { TableSession } from '../../session/types';
  import type { DeckStore, GameStore, MatchStore } from '../../store/types';
  import Button from '../design/Button.svelte';
  import SeatGlyph from '../design/SeatGlyph.svelte';
  import { toasts } from '../design/toasts';
  import { LEFT_NETWORKED } from './leave';
  import { queueLabel, seatColourVar } from './mm-view';

  let {
    session,
    record,
    decks = null,
    matches = null,
    games = null,
    onleave,
    onstage,
  }: {
    session: TableSession;
    record: MatchRecord;
    decks?: DeckStore | null;
    matches?: MatchStore | null;
    games?: GameStore | null;
    /** Leave the table (the frame's one leave path); resolves once it is done. */
    onleave: () => void | Promise<unknown>;
    onstage?: (stage: MatchedEntryStage) => void;
  } = $props();

  let stage: MatchedEntryStage = $state('connecting');
  let stop: (() => void) | null = null;
  let gone = false;
  let leaving = false;

  /**
   * Leave a matched table whose game never started: the record is void and the game not in History (the matchmaker
   * does it while it still moves to this room), then the frame's leave. Its "seat is kept" toast does not apply to a
   * game that never started, so the reason (if any) replaces it.
   */
  function abandon(text: string | null): void {
    if (leaving) return;
    leaving = true;
    stop?.();
    void abandonMatchedTable({ session, roomId: record.roomId, matches, games })
      .catch(() => undefined)
      .then(() => onleave())
      .then(() => {
        for (const t of toasts.list()) if (t.text === LEFT_NETWORKED) toasts.dismiss(t.id);
        if (text) toasts.info(text);
      });
  }

  const me = untrack(() => session.getState().seats[session.seat]?.peer ?? '');
  void (async () => {
    const rec = decks ? await decks.get(record.deckId).catch(() => null) : null;
    if (gone) return;
    stop = runMatchedEntry({
      session,
      record,
      me,
      deck: rec ? deckImportOfRecord(rec) : null,
      // The table frame runs the automatic setup itself (startAutoSetup on mount).
      autoSetup: false,
      onStage: (s) => {
        stage = s;
        onstage?.(s);
      },
      // The matchmaker already shows why (MatchHost) and goes back to its search.
      onStranded: () => abandon(null),
      onStalled: (text) => abandon(text),
    });
  })();
  onDestroy(() => {
    gone = true;
    stop?.();
  });
</script>

{#if stage !== 'match'}
  <div class="mm-entry ds-pop ds-root" role="status" data-testid="matched-entry" data-stage={stage}>
    <p class="mm-entry-title">{record.roomId.replace(/-/g, ' ').toUpperCase()} · {queueLabel(record.queue)}</p>
    <ul class="mm-entry-seats">
      {#each record.players as p, i (p.peerId)}
        <li class="mm-entry-seat"><SeatGlyph seat={i} colour={seatColourVar(i)} size={28} label={`Seat ${i + 1}`} /> {p.name}</li>
      {/each}
    </ul>
    <p class="mm-entry-line">{stage === 'connecting' ? 'CONNECTING…' : stage === 'entering' ? 'DEALING…' : 'NOT CONNECTED'}</p>
    <div class="mm-entry-actions">
      <Button variant="ghost" size="sm" onclick={() => abandon(null)} data-testid="matched-entry-leave">LEAVE</Button>
    </div>
  </div>
{/if}

<style>
  .mm-entry {
    position: fixed;
    left: 50%;
    top: 50%;
    transform: translate(-50%, -50%);
    z-index: 800;
    width: min(420px, calc(100% - 32px));
    display: grid;
    gap: var(--ds-space-sm);
    justify-items: center;
    padding: var(--ds-space-lg);
    border-radius: var(--ds-radius-md);
    background: var(--ds-panel-raised);
    color: var(--ds-ink);
    box-shadow: var(--ds-elevation-pop);
    font-family: var(--ds-font-body);
    pointer-events: none;
  }
  .mm-entry-actions {
    pointer-events: auto;
  }
  .mm-entry-title,
  .mm-entry-line {
    margin: 0;
    font-family: var(--ds-font-mono);
    letter-spacing: 0.08em;
    font-size: var(--ds-type-small);
  }
  .mm-entry-seat {
    display: inline-flex;
    align-items: center;
    gap: var(--ds-space-xs);
  }
  .mm-entry-seats {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-wrap: wrap;
    gap: var(--ds-space-md);
    justify-content: center;
  }
</style>
