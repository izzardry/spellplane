<!--
  The `#/lobby` route (PLAN M1-P5: create table, share link, nickname): the start page with the props main.ts hands in,
  or with the profile's own stores (ui/lobby/start.ts). Rendered inside the app shell's page frame.
-->
<script lang="ts">
  import type { StartPageProps } from '../types';
  import StartPage from './StartPage.svelte';
  import { defaultStartProps } from './start';

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
</script>

{#if start}
  <StartPage {...start} />
{:else}
  <h1>Play with friends</h1>
  {#if error}<p role="alert">{error}</p>{/if}
{/if}
