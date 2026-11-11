<!--
  App shell with hash routing (PLAN M0-P4): `#/` is the solo table, `#/t/<room>/<key>` a networked table
  (ui/lobby/RoomRoute.svelte: lobby, then the HUD), `#/lobby` the start page (ui/lobby/StartRoute.svelte) and `#/diag`
  or `#/diag/<room>/<key>` the connection check (ui/diag/DiagRoute.svelte) (PLAN M1-P5). Props come from main.ts
  (ui/types.ts AppProps); without a session the shell shows the bootstrap stage.
-->
<script lang="ts">
  import { paper } from '../themes/paper/index';
  import { tokensToCssVars } from '../themes/index';
  import type { AppProps } from './types';
  import Hud from './Hud.svelte';
  import Smoke from './Smoke.svelte';
  import DiagRoute from './diag/DiagRoute.svelte';
  import RoomRoute from './lobby/RoomRoute.svelte';
  import StartRoute from './lobby/StartRoute.svelte';
  import { parseRoute, type Route } from './routes';

  let props: Partial<AppProps> = $props();

  let route = $state<Route>(parseRoute(typeof location === 'undefined' ? '' : location.hash));
  const cssVars = Object.entries(tokensToCssVars(paper.tokens))
    .map(([k, v]) => `${k}: ${v}`)
    .join('; ');
</script>

<svelte:window onhashchange={() => (route = parseRoute(location.hash))} />

{#if route.name === 'solo'}
  {#if props.session && props.createScene && props.faces && props.cardData && props.game}
    <Hud
      session={props.session}
      createScene={props.createScene}
      faces={props.faces}
      cardData={props.cardData}
      game={props.game}
      theme={paper}
      settings={props.settings}
      parseDecklist={props.parseDecklist}
    />
  {:else}
    <Smoke />
  {/if}
{:else if route.name === 'room'}
  {#key `${route.room}/${route.key}`}
    <RoomRoute app={props} room={route.room} roomKey={route.key} {cssVars} />
  {/key}
{:else}
  <main class="sp-page" style={cssVars} data-testid="route-{route.name === 'diagJoin' ? 'diag' : route.name}">
    {#if route.name === 'lobby'}
      <StartRoute start={props.start} />
    {:else if route.name === 'diag' || route.name === 'diagJoin'}
      <DiagRoute diag={props.diag} room={route.name === 'diagJoin' ? { roomId: route.room, roomKey: route.key } : null} />
    {:else}
      <h1>Not found</h1>
      <p>There is nothing at {route.hash}.</p>
    {/if}
    <p><a href="#/">Back to the solo table</a></p>
  </main>
{/if}

<style>
  :global(html, body) {
    margin: 0;
    height: 100%;
    background: #fff;
    color: #111;
    font-family: system-ui, -apple-system, 'Segoe UI', sans-serif;
    overflow: hidden;
  }
  :global(#app) {
    height: 100%;
  }
  /* The page frame of the non-table routes (also used by ui/lobby/RoomRoute.svelte). */
  :global(.sp-page) {
    box-sizing: border-box;
    max-width: 40em;
    max-height: 100%;
    overflow-y: auto;
    margin: 0 auto;
    padding: 48px 16px;
    font-family: var(--sp-font);
    color: var(--sp-fg);
    background: var(--sp-bg);
  }
  :global(.sp-page a) {
    color: var(--sp-fg);
  }
</style>
