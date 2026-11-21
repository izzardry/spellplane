<!--
  The teammate's question after a seat was claimed by a new browser (contracts.md Part G "Rejoin" item 1): `Ben is back
  from a new browser (link made by Cy). Show him your hand?` · `SHOW` · `NOT YET`. Until SHOW, this browser sends that
  seat no `teamHand` (session/team.ts). Implementer: M8-P5.
-->
<script lang="ts">
  import { untrack } from 'svelte';
  import type { TeamControls } from '../../session/types';

  let { team }: { team: TeamControls } = $props();
  let list = $state.raw(untrack(() => team.withheld?.() ?? []));
  $effect(() => team.subscribe(() => (list = team.withheld?.() ?? [])));
</script>

{#each list as w (w.seat)}
  <div class="prompt" role="alertdialog" aria-label="Show your hand" data-testid="team-prompt" data-seat={w.seat}>
    <p class="text">{w.name} is back from a new browser{w.by ? ` (link made by ${w.by})` : ''}. Show him your hand?</p>
    <div class="row">
      <button type="button" class="ds-btn ds-btn--ghost ds-btn--xs" data-testid="team-prompt-later" onclick={() => team.holdHand?.(w.seat)}>NOT YET</button>
      <button type="button" class="ds-btn ds-btn--primary ds-btn--xs" data-testid="team-prompt-show" onclick={() => team.showHand?.(w.seat)}>SHOW</button>
    </div>
  </div>
{/each}

<style>
  .prompt {
    display: flex;
    flex-direction: column;
    gap: var(--ds-space-sm);
    padding: var(--ds-space-md);
    border-radius: var(--ds-radius-panel);
    background: var(--ds-panel);
    box-shadow: var(--ds-elevation-pop);
    max-width: 320px;
  }
  .text {
    margin: 0;
    font: var(--ds-type-body);
    color: var(--ds-ink);
  }
  .row {
    display: flex;
    gap: var(--ds-space-sm);
    justify-content: flex-end;
  }
</style>
