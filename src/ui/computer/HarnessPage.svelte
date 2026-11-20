<!--
  The `?harness=computer` page's body (ui/computer/harness.ts): the computer route on the table frame, or, after
  leaving, a stand-in Home with `Continue`.
-->
<script lang="ts">
  import type { ComputerGame } from '../../session/types';
  import type { GameStore } from '../../store/types';
  import type { TableDeps } from '../table/types';
  import ComputerRoute from './ComputerRoute.svelte';

  let {
    what,
    room,
    open,
    deps,
    games,
    go,
    oncontinue,
  }: {
    what: 'table' | 'home';
    room: string;
    open: (room: string) => Promise<ComputerGame>;
    deps: TableDeps;
    games: GameStore | null;
    go: (hash: string) => void;
    oncontinue: () => void;
  } = $props();
</script>

{#if what === 'table'}
  <div class="harness-table" data-harness="computer">
    <ComputerRoute {room} {open} {deps} {games} {go} />
  </div>
{:else}
  <main class="ds-page ds-root" data-testid="harness-home" data-harness="computer">
    <h1 class="ds-t-heading">Home</h1>
    <p class="ds-t-reading">The computer game is saved.</p>
    <button type="button" class="ds-btn ds-btn--primary ds-btn--md" data-testid="harness-continue" onclick={oncontinue}>Continue</button>
  </main>
{/if}

<style>
  .harness-table {
    position: fixed;
    inset: 0;
  }
</style>
