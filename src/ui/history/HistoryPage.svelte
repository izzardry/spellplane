<!-- `#/history`: the History list in a sheet on the shared stage (journey.md 4.14; visual.md board 6). M8-P2. -->
<script lang="ts">
  import Sheet from '../design/Sheet.svelte';
  import type { GameStore, GameSummary } from '../../store/types';
  import HistoryList from './HistoryList.svelte';
  import { openHash } from './rows';

  let { games, go = (h: string) => (location.hash = h), now = () => Date.now() }: { games: GameStore | null; go?: (hash: string) => void; now?: () => number } = $props();
  let count = $state<number | null>(null);
</script>

<Sheet label="History" data-testid="history-page">
  {#snippet header()}
    <h2 class="title">HISTORY</h2>
    {#if count !== null}<span class="count">{count} {count === 1 ? 'GAME' : 'GAMES'}</span>{/if}
  {/snippet}
  <HistoryList {games} {now} onopen={(g: GameSummary) => go(openHash(g))} onchange={(n) => (count = n)} />
</Sheet>

<style>
  .title { margin: 0; font-size: 20px; letter-spacing: 0.06em; }
  .count { font-size: 11px; letter-spacing: 0.1em; color: var(--ds-muted); }
</style>
