<!--
  App shell with hash routing (PLAN M0-P4): `#/` is the solo table, `#/t/<room>/<key>` a networked table
  (ui/lobby/RoomRoute.svelte: lobby, then the HUD), `#/lobby` the start page (ui/lobby/StartRoute.svelte) and `#/diag`
  or `#/diag/<room>/<key>` the connection check (ui/diag/DiagRoute.svelte) (PLAN M1-P5). Props come from main.ts
  (ui/types.ts AppProps); without a session the shell shows the bootstrap stage.
-->
<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import { cssText, hudCssVars } from '../themes/index';
  import type { Theme } from '../themes/types';
  import { registerThemeDebug, setThemeContext, ThemeChoice, waitsForStoredTheme } from './settings/theme';
  import type { AppProps } from './types';
  import Hud from './Hud.svelte';
  import Smoke from './Smoke.svelte';
  import DiagRoute from './diag/DiagRoute.svelte';
  import RoomRoute from './lobby/RoomRoute.svelte';
  import StartRoute from './lobby/StartRoute.svelte';
  import { parseRoute, type Route } from './routes';
  import UpdateNotice from './storage/UpdateNotice.svelte';
  import type { UpdatePlace } from './update';
  import type { Stage } from '../core/types';

  let props: Partial<AppProps> = $props();

  let route = $state<Route>(parseRoute(typeof location === 'undefined' ? '' : location.hash));

  // The viewer's theme (PLAN M4-P6): kept in this browser's settings, shared with the shells below through the
  // context, applied to the whole page as CSS custom properties. The table waits for the stored choice, so a page
  // whose viewer picked Dusk does not first build Paper's scene.
  const choice = new ThemeChoice({ settings: untrack(() => props.settings) });
  setThemeContext(choice);
  let theme = $state.raw<Theme>(choice.current());
  let ready = $state(false);
  const cssVars = $derived(cssText(hudCssVars(theme.tokens)));
  onMount(() => {
    registerThemeDebug(choice);
    const off = choice.subscribe((s) => (theme = s.theme));
    void choice.ready.then(() => (ready = true));
    return off;
  });
  // Updates only between games (M5-P3, ui/storage/UpdateNotice.svelte): the pages without a table and the solo table
  // here; a networked table shows its own notice with its stage (ui/lobby/TableRoom.svelte).
  let soloStage = $state<Stage | null>(null);
  $effect(() => {
    const s = props.session;
    if (!s) return;
    soloStage = s.getState().stage;
    return s.subscribe((st) => (soloStage = st.stage));
  });
  const updatePlace = $derived<UpdatePlace>(route.name === 'solo' ? { route: 'solo', stage: soloStage } : { route: route.name, stage: null });
  // The page itself (body background, scrollbars, form controls) follows the theme too.
  $effect(() => {
    const root = document.documentElement;
    for (const [k, v] of Object.entries(hudCssVars(theme.tokens))) root.style.setProperty(k, v);
    root.dataset.theme = theme.id;
  });
</script>

<svelte:window onhashchange={() => (route = parseRoute(location.hash))} />

{#if route.name !== 'room'}<UpdateNotice update={props.update} place={updatePlace} />{/if}

{#if !ready && waitsForStoredTheme(route)}
  <!-- Reading the stored theme before a table builds its scene: a moment, at most a few seconds (ui/settings/theme.ts).
       The pages without a scene (start page, connection check) do not wait. -->
  <p class="theme-wait" role="status" data-testid="theme-wait">Loading…</p>
{:else if route.name === 'solo'}
  {#if props.session && props.createScene && props.faces && props.cardData && props.game}
    <Hud
      session={props.session}
      createScene={props.createScene}
      faces={props.faces}
      cardData={props.cardData}
      game={props.game}
      {theme}
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
    background: var(--sp-bg, #fff);
    color: var(--sp-fg, #111);
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
  /* Shown only when reading the stored theme takes noticeably long, so a quick read does not flash it. */
  .theme-wait {
    margin: 0;
    padding: 48px 16px;
    text-align: center;
    font-family: var(--sp-font, system-ui);
    color: var(--sp-muted, #5f5f5f);
    opacity: 0;
    animation: theme-wait-show 0s linear 400ms forwards;
  }
  @keyframes theme-wait-show {
    to {
      opacity: 1;
    }
  }
</style>
