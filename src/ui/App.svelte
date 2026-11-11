<!--
  App shell with hash routing (PLAN M0-P4): `#/` is the solo table; `#/t/<room>/<key>`, `#/lobby` and `#/diag` are
  reserved for later milestones. Props come from main.ts (ui/types.ts AppProps, wired by M0-P7); without a session the
  shell shows the bootstrap stage.
-->
<script lang="ts">
  import { paper } from '../themes/paper/index';
  import { tokensToCssVars } from '../themes/index';
  import type { AppProps } from './types';
  import Hud from './Hud.svelte';
  import Smoke from './Smoke.svelte';
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
{:else}
  <main class="page" style={cssVars} data-testid="route-{route.name}">
    {#if route.name === 'room'}
      <h1>Table {route.room}</h1>
      <p>Joining tables by link arrives with peer-to-peer play (milestone 1).</p>
    {:else if route.name === 'lobby'}
      <h1>Lobby</h1>
      <p>The lobby arrives with milestone 1.</p>
    {:else if route.name === 'diag'}
      <h1>Diagnostics</h1>
      <p>The connection check arrives with milestone 1.</p>
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
  .page {
    max-width: 40em;
    margin: 0 auto;
    padding: 48px 16px;
    font-family: var(--sp-font);
    color: var(--sp-fg);
    background: var(--sp-bg);
  }
  .page a {
    color: var(--sp-fg);
  }
</style>
