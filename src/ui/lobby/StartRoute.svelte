<!--
  The `#/lobby` route (PLAN M1-P5: create table, share link, nickname): the start page with the props main.ts hands in,
  or with the profile's own stores (ui/lobby/start.ts). Rendered inside the app shell's page frame.
-->
<script lang="ts">
  import type { StartPageProps } from '../types';
  import StartPage from './StartPage.svelte';
  import { defaultStartProps, lobbyStores } from './start';
  import type { LocalStores } from '../../store/stores';
  import Hints from '../storage/Hints.svelte';
  import StoragePanel from '../storage/StoragePanel.svelte';

  let { start: given }: { start?: StartPageProps | undefined } = $props();

  let start = $state.raw<StartPageProps | null>(null);
  let error = $state('');
  $effect(() => {
    if (start) return;
    if (given) start = given;
    else
      defaultStartProps()
        .then((s) => (start = s))
        .catch((e: unknown) => (error = `Local storage is unavailable: ${e instanceof Error ? e.message : String(e)}`));
  });

  // Storage and backup, and M5-P3's one-time hints (Home Screen on iPhone and iPad, keeping storage for good).
  let stores = $state.raw<LocalStores | null>(null);
  $effect(() => {
    lobbyStores().then(
      (s) => (stores = s),
      () => (stores = null),
    );
  });
</script>

{#if stores}<Hints settings={stores.settings} hints={['installHomeScreen', 'persistStorage']} />{/if}

{#if start}
  <StartPage {...start} />
{:else}
  <h1>Play with friends</h1>
  {#if error}<p role="alert">{error}</p>{/if}
{/if}
{#if stores}<div class="storage"><StoragePanel {stores} /></div>{/if}

<style>
  .storage {
    margin-top: var(--sp-space-lg, 16px);
  }
</style>
