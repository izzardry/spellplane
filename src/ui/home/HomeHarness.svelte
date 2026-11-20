<!-- The page of `?harness=home` and `?harness=history` (contracts.md Part C "Harness pages"): Shell, Home and History over the profile's stores, a fake matchmaker and a fake starter source. M8-P2. -->
<script lang="ts">
  import { onDestroy } from 'svelte';
  import Shell from '../shell/Shell.svelte';
  import Home from './Home.svelte';
  import HistoryPage from '../history/HistoryPage.svelte';
  import type { LaunchDeps } from '../play/launch';
  import type { Matchmaker } from '../../session/types';
  import type { LocalStores } from '../../store/stores';

  let { stores, deps, matchmaker, matchmakingAvailable, computerAvailable }: { stores: LocalStores | null; deps: LaunchDeps; matchmaker: Matchmaker; matchmakingAvailable: boolean; computerAvailable: boolean } = $props();

  let hash = $state(location.hash);
  const onHash = (): void => {
    hash = location.hash;
  };
  window.addEventListener('hashchange', onHash);
  onDestroy(() => window.removeEventListener('hashchange', onHash));

  const path = $derived(hash.replace(/^#\/?/, ''));
  const route = $derived(path === '' ? { name: 'home' } : path.startsWith('decks') ? { name: 'decks' } : path === 'history' ? { name: 'history' } : path.match(/^[tpc]\//) ? { name: 'table' } : { name: path.split('/')[0] ?? 'notFound' });
</script>

{#if route.name === 'table'}
  <div class="table-stub" data-testid="harness-table" data-hash={hash}>TABLE {hash}</div>
{:else}
  {#key route.name}
    <Shell {route} settings={stores?.settings ?? null} {matchmaker} games={stores?.games ?? null} identity={stores?.identity ?? null} ratings={stores?.ratings ?? null} go={deps.go}>
      {#if route.name === 'home'}
        <Home {deps} {matchmaker} {matchmakingAvailable} {computerAvailable} storageOk={stores !== null} />
      {:else if route.name === 'history'}
        <HistoryPage games={stores?.games ?? null} go={deps.go} />
      {:else}
        <div class="stub" data-testid="harness-stub-{route.name}">{route.name.toUpperCase()} (stub)</div>
      {/if}
    </Shell>
  {/key}
{/if}

<style>
  .table-stub, .stub { padding: 24px; font-size: 14px; color: var(--ds-ink); }
</style>
