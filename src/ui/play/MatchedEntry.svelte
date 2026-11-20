<!--
  Entering a matched room (matchmaking.md 2.9; journey.md 4.7): seats, decks and opening hands without a waiting room.
  Stub by M8-C: a plain line while the table is not in play. M8-P7 owns the file.
-->
<script lang="ts">
  import type { MatchRecord } from '../../core/types';
  import type { TableSession } from '../../session/types';
  import type { DeckStore, MatchStore, RatingStore } from '../../store/types';

  let {
    session: _session,
    record,
    decks: _decks = null,
    ratings: _ratings = null,
    matches: _matches = null,
    onleave,
  }: { session: TableSession; record: MatchRecord; decks?: DeckStore | null; ratings?: RatingStore | null; matches?: MatchStore | null; onleave: () => void } = $props();
</script>

<main class="ds-page" data-testid="matched-entry">
  <p class="ds-t-meta">Match {record.matchId}: entering the table…</p>
  <button type="button" class="ds-btn ds-btn--ghost ds-btn--sm" onclick={onleave}>Leave</button>
</main>
