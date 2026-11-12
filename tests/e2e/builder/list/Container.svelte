<!--
  A stand-in for the builder container (M2-P5 owns the real one with the builder table): it holds the shared DeckBuild
  and switches between a placeholder for the table view and the real list view, as DESIGN "Pre-game", Deck building
  asks ("two views of the same pool, switchable at any time"). Test page only.
-->
<script lang="ts">
  import type { CardRef, DeckBuild } from '../../../../src/core/types';
  import type { CardData } from '../../../../src/data/types';
  import type { DeckRecord, DeckStore } from '../../../../src/store/types';
  import ListView from '../../../../src/ui/builder/list/ListView.svelte';
  import type { BuilderViewKind } from '../../../../src/ui/types';
  import { harness } from './control.svelte';

  let { card, search, decks, origin }: { card: (ref: CardRef) => CardData | null; search: (q: string) => Promise<CardData[]>; decks: DeckStore | undefined; origin: DeckRecord['origin'] | undefined } = $props();

  function onChange(build: DeckBuild) {
    harness.changes++;
    harness.build = build;
  }
  function show(view: BuilderViewKind) {
    harness.view = view;
  }
</script>

<nav class="switch">
  <button type="button" data-testid="view-table" aria-pressed={harness.view === 'table'} onclick={() => show('table')}>Table</button>
  <button type="button" data-testid="view-list" aria-pressed={harness.view === 'list'} onclick={() => show('list')}>List</button>
</nav>
<main>
  {#if harness.view === 'list'}
    <ListView build={harness.build} {onChange} {card} sort={harness.sort} {search} {decks} {origin} />
  {:else}
    <div data-testid="fake-table" class="table">Builder table (stand-in): {harness.build.main.length} of {harness.build.cards.length} cards in the deck.</div>
  {/if}
</main>

<style>
  :global(html, body) {
    margin: 0;
    height: 100%;
  }
  .switch {
    display: flex;
    gap: 4px;
    padding: 6px 16px;
  }
  main {
    height: calc(100vh - 48px);
  }
  .table {
    padding: 16px;
  }
</style>
