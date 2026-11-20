<!--
  The automatic entry of a matched table (matchmaking.md 2.6; contracts.md Part C, Part G "Matchmaking"): mounted by the
  table frame when a MatchRecord exists for the room. It runs `runMatchedEntry` (seat and colour by the plan's order,
  enterMatch with autoSetup and matched, the creator starts, the opening hands), shows who is being connected until the
  stage is `match`, and when a member cannot be reached within 30 s it leaves the room at once (the matchmaker is
  already seeking again with the waiting time kept; MatchHost shows why). Never a waiting room. M8-P7.
-->
<script lang="ts">
  import { onDestroy } from 'svelte';
  import type { MatchRecord } from '../../core/types';
  import { deckImportOfRecord } from '../../session/deck-build';
  import { runMatchedEntry, type MatchedEntryStage } from '../../session/match-room';
  import type { TableSession } from '../../session/types';
  import type { DeckStore, MatchStore, RatingStore } from '../../store/types';
  import { queueLabel } from './mm-view';

  let {
    session,
    record,
    decks = null,
    ratings = null,
    matches = null,
    onleave,
    onstage,
  }: {
    session: TableSession;
    record: MatchRecord;
    decks?: DeckStore | null;
    ratings?: RatingStore | null;
    matches?: MatchStore | null;
    onleave: () => void;
    onstage?: (stage: MatchedEntryStage) => void;
  } = $props();

  let stage: MatchedEntryStage = $state('connecting');
  let stop: (() => void) | null = null;
  let gone = false;

  const me = session.getState().seats[session.seat]?.peer ?? '';
  void (async () => {
    const rec = decks ? await decks.get(record.deckId).catch(() => null) : null;
    if (gone) return;
    stop = runMatchedEntry({
      session,
      record,
      me,
      deck: rec ? deckImportOfRecord(rec) : null,
      ratings,
      matches,
      onStage: (s) => {
        stage = s;
        onstage?.(s);
      },
      onStranded: () => onleave(),
    });
  })();
  onDestroy(() => {
    gone = true;
    stop?.();
  });
</script>

{#if stage !== 'match'}
  <div class="mm-entry" role="status" data-testid="matched-entry" data-stage={stage}>
    <p class="mm-entry-title">{record.roomId.replace(/-/g, ' ').toUpperCase()} · {queueLabel(record.queue)}</p>
    <ul class="mm-entry-seats">
      {#each record.players as p, i (p.peerId)}
        <li><span aria-hidden="true">{['◆', '▲', '●', '■'][i] ?? '◆'}</span> {p.name}</li>
      {/each}
    </ul>
    <p class="mm-entry-line">{stage === 'connecting' ? 'CONNECTING…' : stage === 'entering' ? 'DEALING…' : 'NOT CONNECTED'}</p>
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
  .mm-entry-title,
  .mm-entry-line {
    margin: 0;
    font-family: var(--ds-font-mono);
    letter-spacing: 0.08em;
    font-size: var(--ds-type-small);
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
