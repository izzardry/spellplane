<!--
  The list of games in History (journey.md 4.14; persistence.md section 4), newest first; also Home's recent games
  (`limit`). Stub by M8-C: one plain row per game. M8-P2 owns the file.
-->
<script lang="ts">
  import type { GameStore, GameSummary } from '../../store/types';

  let { games, limit = undefined, onopen }: { games: GameStore | null; limit?: number | undefined; onopen: (g: GameSummary) => void } = $props();
  let rows = $state.raw<GameSummary[] | null>(null);
  $effect(() => {
    let cancelled = false;
    const store = games;
    if (!store) {
      rows = [];
      return;
    }
    store.list().then(
      (list) => {
        if (!cancelled) rows = limit === undefined ? list : list.slice(0, limit);
      },
      () => {
        if (!cancelled) rows = [];
      },
    );
    return () => {
      cancelled = true;
    };
  });
</script>

<div class="history-list" data-testid="history-list">
  {#if rows && rows.length === 0}
    <p class="ds-t-meta" data-testid="history-empty">No games yet.</p>
  {:else if rows}
    <ul>
      {#each rows as g (g.code)}
        <li>
          <button type="button" class="ds-btn ds-btn--ghost ds-btn--sm" data-testid="history-row" data-code={g.code} onclick={() => onopen(g)}>
            {g.title || g.players.map((p) => p.name).join(' · ') || g.code} · turn {g.turn}
          </button>
        </li>
      {/each}
    </ul>
  {/if}
</div>

<style>
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: var(--ds-space-sm);
  }
</style>
