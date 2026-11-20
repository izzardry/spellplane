<!-- The `?harness=match` page: a stand-in shell bar with the queue chip, and the match host (M8-P7). -->
<script lang="ts">
  import type { Matchmaker } from '../../session/types';
  import ToastHost from '../design/ToastHost.svelte';
  import MatchHost from './MatchHost.svelte';
  import QueueChip from './QueueChip.svelte';

  let { matchmaker, onhome, chime }: { matchmaker: Matchmaker; onhome: () => void; chime: () => void } = $props();
</script>

<main class="mm-harness ds-root" data-testid="harness-match">
  <div class="mm-harness-bar"><QueueChip {matchmaker} {onhome} /></div>
  <p class="ds-t-meta">Match harness</p>
  <MatchHost {matchmaker} {chime} />
  <ToastHost place="bottom-centre" />
</main>

<style>
  .mm-harness {
    min-height: 100vh;
    padding: var(--ds-space-md);
    background: var(--ds-panel);
    color: var(--ds-ink);
    font-family: var(--ds-font-body);
  }
  .mm-harness-bar {
    display: flex;
    justify-content: center;
    min-height: 56px;
  }
</style>
