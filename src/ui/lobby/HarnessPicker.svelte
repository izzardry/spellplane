<!--
  A stand-in for M8-P3's DeckPickerSheet on `?harness=lobby` (contracts.md Part C): lists the fake library and shows
  what the waiting room's `allow` answers for each deck, so the deck rule is checked without M8-P3's code. A deck that
  may not be picked dims its text and well and names the reason (contracts.md Part G "Decks" item 4). M8-P4.
-->
<script lang="ts">
  import { onMount } from 'svelte';
  import type { DeckRecord } from '../../store/types';
  import Sheet from '../design/Sheet.svelte';

  let { allow = undefined, onpick, onclose = undefined }: { allow?: ((deck: DeckRecord) => true | string) | undefined; onpick: (deck: DeckRecord) => void; onclose?: (() => void) | undefined } = $props();
  let decks = $state.raw<DeckRecord[]>([]);
  // The harness's fake library (src/ui/lobby/harness.ts).
  onMount(() => void (window as unknown as { __lobbyHarness?: { library(): Promise<DeckRecord[]> } }).__lobbyHarness?.library().then((d) => (decks = d)));
</script>

<Sheet label="Choose a deck" width="narrow" {onclose} data-testid="deck-picker">
  {#snippet header()}<h2 class="ds-t-title">Choose a deck</h2>{/snippet}
  <ul class="list">
    {#each decks as d (d.id)}
      {@const ok = allow ? allow(d) : true}
      <li>
        <button type="button" class="tile" class:locked={ok !== true} data-testid="picker-deck" data-deck={d.id} data-allowed={ok === true} aria-disabled={ok !== true} onclick={() => ok === true && onpick(d)}>
          <span class="name">{d.name}</span>
          {#if ok !== true}<span class="ds-badge" data-testid="picker-reason">{ok}</span>{/if}
        </button>
      </li>
    {/each}
  </ul>
</Sheet>

<style>
  .list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: var(--ds-space-sm);
  }
  .tile {
    box-sizing: border-box;
    width: 100%;
    height: var(--ds-control-lg);
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--ds-space-sm);
    padding: 0 var(--ds-space-lg);
    border: 0;
    border-radius: var(--ds-radius-card);
    background: var(--ds-panel-raised);
    box-shadow: var(--ds-elevation-raised);
    color: var(--ds-ink);
    font: inherit;
    cursor: pointer;
  }
  .tile.locked {
    background: var(--ds-chip);
    cursor: default;
  }
  .tile.locked .name {
    opacity: 0.5;
  }
</style>
