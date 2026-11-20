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
  import Hint from '../hints/Hint.svelte';
  import { startPageHint, type StartPageHint } from './start-hint';
  import type { FirstRunHint, HintController } from '../hints/hints';

  let { start: given, welcome }: { start?: StartPageProps | undefined; welcome?: HintController | undefined } = $props();

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
  /** The stores could not be opened: no storage hints (nor panel) on this page. */
  let storesFailed = $state(false);
  $effect(() => {
    lobbyStores().then(
      (s) => (stores = s),
      () => {
        stores = null;
        storesFailed = true;
      },
    );
  });

  // One hint at a time (PLAN M5-P5; M5 gate): the storage hints come first, the welcome only when neither shows. The
  // page decides once both have loaded (what was answered, whether storage is kept, what the welcome's store holds),
  // so the welcome never shows before a storage hint replaces it (ui/lobby/start-hint.ts).
  let storageHint = $state<'installHomeScreen' | 'persistStorage' | null | undefined>(undefined);
  let welcomeHint = $state<{ loaded: boolean; hint: FirstRunHint | null }>({ loaded: false, hint: null });
  $effect(() => {
    const w = welcome;
    if (!w) return;
    const read = (): void => {
      welcomeHint = { loaded: w.loaded, hint: w.current() };
    };
    read();
    return w.subscribe(read);
  });
  const shown = $derived<StartPageHint | undefined>(startPageHint(storesFailed ? null : storageHint, welcome ? welcomeHint : { loaded: true, hint: null }));
</script>

{#if start}
  <StartPage {...start} savedDecks={stores ? () => stores!.decks.list() : undefined} />
{:else}
  <h1>Spellplane</h1>
  {#if error}<p role="alert">{error}</p>{/if}
{/if}

<!-- Housekeeping comes after play (critique, Start page 3): the one-time hints, then the connection check and storage. -->
<footer class="housekeeping" aria-label="Housekeeping">
  <div class="hints" data-testid="start-hints" data-start-hint={shown ?? 'deciding'}>
    {#if stores}<Hints settings={stores.settings} hints={['installHomeScreen', 'persistStorage']} onDecided={(h) => (storageHint = h)} />{/if}
    {#if shown === 'welcome' && welcome}<Hint hints={welcome} placement="inline" />{/if}
  </div>
  <p class="foot"><a href="#/diag">Check your connection</a></p>
  {#if stores}
    <details class="storage" data-testid="start-storage">
      <summary>Storage and backup</summary>
      <StoragePanel {stores} />
    </details>
  {/if}
</footer>

<style>
  .hints {
    display: contents;
  }
  .housekeeping {
    display: grid;
    gap: var(--ds-space-md);
    margin-top: var(--ds-space-xxl);
    padding-top: var(--ds-space-lg);
    border-top: 1px solid var(--ds-line);
    font-size: var(--ds-type-small);
    color: var(--ds-ink);
  }
  .foot {
    margin: 0;
  }
  .storage summary {
    cursor: pointer;
    color: var(--ds-ink);
  }
</style>
