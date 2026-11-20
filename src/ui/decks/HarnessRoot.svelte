<!--
  The decks harness page (`?harness=decks`; contracts.md Part C): DecksRoute for the `#/decks…` routes over the
  harness's sources, a stand-in for Home at `#/` (Home is M8-P2's), and the toast host the shell would provide.
  Implementer: M8-P3.
-->
<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import type { CardDataSource, FaceSource, SetDataSource } from '../../data/types';
  import type { DeckStore, SettingsStore } from '../../store/types';
  import ToastHost from '../design/ToastHost.svelte';
  import { parseRoute, type Route } from '../routes';
  import DecksRoute from './DecksRoute.svelte';

  let {
    decks,
    settings,
    cardData,
    sets,
    faces,
    searching,
  }: { decks: DeckStore | null; settings: SettingsStore | null; cardData: CardDataSource; sets: SetDataSource; faces: FaceSource; searching: () => boolean } = $props();

  let route = $state<Route>(parseRoute(location.hash || '#/decks'));
  const onHash = (): void => {
    route = parseRoute(location.hash);
  };
  onMount(() => window.addEventListener('hashchange', onHash));
  onDestroy(() => window.removeEventListener('hashchange', onHash));
</script>

<main class="ds-root harness" data-testid="decks-harness">
  {#if route.name === 'decks' || route.name === 'deckNew' || route.name === 'deck' || route.name === 'deckOpen'}
    {#key route.name === 'decks' ? 'lib' : route.name === 'deckNew' ? `new:${route.path ?? ''}` : `${route.name}:${route.id}`}
      <DecksRoute {route} {decks} {settings} {cardData} {sets} {faces} {searching} />
    {/key}
  {:else}
    <section class="home" data-testid="harness-home">
      <h1 class="ds-t-title">Home</h1>
      <a href="#/decks">Decks</a>
    </section>
  {/if}
  <ToastHost />
</main>

<style>
  .harness {
    min-height: 100vh;
    background: var(--ds-panel);
  }
  .home {
    padding: var(--ds-space-xl);
  }
</style>
