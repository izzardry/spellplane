<!--
  The game-over overlay (journey.md 4.13): VICTORY or DEFEAT, REMATCH, FIND ANOTHER, HOME. Stub by M8-C: one plain line
  with the result and a way home. M8-P4 owns the file.
-->
<script lang="ts">
  import { untrack } from 'svelte';
  import type { TableSession } from '../../session/types';
  import { resultOf } from '../../session/result';

  let { session, onhome = undefined }: { session: TableSession; onhome?: (() => void) | undefined } = $props();
  let st = $state.raw(untrack(() => session.getState()));
  $effect(() => session.subscribe((s) => (st = s)));
  const result = $derived(resultOf(st));
  const won = $derived(!!(result && session.seat && result.winners.includes(session.seat)));
</script>

{#if result}
  <div class="ds-toast ds-toast--info game-over" role="status" data-testid="game-over">
    <span class="ds-toast__text">{won ? 'Victory' : 'Game over'}</span>
    {#if onhome}<button type="button" class="ds-btn ds-btn--xs ds-btn--ghost" onclick={onhome}>Home</button>{/if}
  </div>
{/if}

<style>
  .game-over {
    position: fixed;
    top: 16px;
    left: 50%;
    transform: translateX(-50%);
    z-index: 40;
  }
</style>
