<!--
  The app with hash routing (docs/design/m8/contracts.md Part C; journey.md section 3): `#/` is Home; Home, Decks,
  History, Settings, About and Diag sit inside the shell (ui/shell/Shell.svelte); every table route renders the table
  frame: `#/solo` the sandbox and `#/p/<room>` a practice table (ui/play/SoloRoute.svelte), `#/c/<room>` a computer
  game (ui/computer/ComputerRoute.svelte), `#/t/<room>/<key>` a networked table (ui/lobby/RoomRoute.svelte). `#/lobby`
  keeps the legacy start page (frozen, linked from nowhere). The look (M7-P2's wiring, ui/design/look.ts) dresses every
  page. Props come from main.ts (ui/types.ts AppProps). Revised by M8-C; M8-P8 owns the file.
-->
<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import { cssText } from '../themes/index';
  import './design/kit';
  import { lookCssVars } from './design/css';
  import { LookChoice, registerLookDebug, setLookContext } from './design/look';
  import type { Theme } from '../themes/types';
  import { registerThemeDebug, setThemeContext, ThemeChoice, waitsForStoredTheme } from './settings/theme';
  import type { AppProps, RoomLink } from './types';
  import Smoke from './Smoke.svelte';
  import DiagRoute from './diag/DiagRoute.svelte';
  import RoomRoute from './lobby/RoomRoute.svelte';
  import StartRoute from './lobby/StartRoute.svelte';
  import { isShellRoute, parseRoute, routeHash, type Route } from './routes';
  import About from './about/About.svelte';
  import { HintController } from './hints/hints';
  import SettingsPage from './settings/SettingsPage.svelte';
  import UpdateNotice from './storage/UpdateNotice.svelte';
  import OfflineNotice from './storage/OfflineNotice.svelte';
  import type { UpdatePlace } from './update';
  import type { Stage } from '../core/types';
  import { installReducedMotionCss } from './a11y/motion';
  import FrameMeter from './perf/FrameMeter.svelte';
  import Shell from './shell/Shell.svelte';
  import Home from './home/Home.svelte';
  import HistoryPage from './history/HistoryPage.svelte';
  import DecksRoute from './decks/DecksRoute.svelte';
  import ComputerRoute from './computer/ComputerRoute.svelte';
  import SoloRoute from './play/SoloRoute.svelte';
  import MatchHost from './play/MatchHost.svelte';
  import { settingsChime } from './play/mm-view';
  import { setLeaveGuardHost, setTableDeps } from './table/context';
  import { keepsTarget, leavesTable } from './table/leave-guard';
  import { FakeMatchmaker } from './fakes';
  import type { TableSession } from '../session/types';

  let props: Partial<AppProps> & { newRoom?: () => RoomLink; registerTable?: (session: TableSession) => () => void } = $props();

  let route = $state<Route>(parseRoute(typeof location === 'undefined' ? '' : location.hash));
  /**
   * Show `next` unless it is the route already shown. One move can fire several hashchange events (the leave guard's
   * Home and its target land as two), and each new route object would wake every page reading it: a table route
   * joined its room once per event, and the extra joins stalled the real one (gate M8 R2).
   */
  function show(next: Route): void {
    if (JSON.stringify(next) !== JSON.stringify(untrack(() => route))) route = next;
  }
  const go = (hash: string): void => {
    location.hash = hash;
  };

  // The browser's Back leaves a table like the arrow (journey.md 4.10 "Leaving"; M8-P8): while a table frame is shown
  // it registers its leave here; a hash change away from its route first runs that leave (save, leave the room,
  // dispose, Home, the toast) and only then switches the page. Any page the change named other than Home is kept.
  let leaveGuard: (() => Promise<void>) | null = null;
  /** The longest the guard holds the table route, ms. */
  const LEAVE_GUARD_MS = 5000;
  setLeaveGuardHost((leave) => (leaveGuard = leave));
  function onHashChange(): void {
    const next = parseRoute(location.hash);
    const guard = leaveGuard;
    if (guard && leavesTable(route, next)) {
      leaveGuard = null;
      const target = location.hash;
      // The leave bounds each of its steps; a store that never answers must not hold the page either (M8-P8).
      const left = new Promise<void>((resolve) => {
        const t = setTimeout(resolve, LEAVE_GUARD_MS);
        void guard().finally(() => {
          clearTimeout(t);
          resolve();
        });
      });
      void left.then(() => {
        // leave.ts goes Home; any other page the change named (Back to Decks, an invite or bring-back link pasted into
        // the tab, another table) is where the player asked to be. The left table itself is never the target.
        const asked = parseRoute(target);
        if (keepsTarget(asked) && location.hash !== target) location.hash = target;
        show(parseRoute(location.hash));
      });
      return;
    }
    show(next);
  }

  // The viewer's theme (PLAN M4-P6): kept in this browser's settings, shared with the shells below through the
  // context, applied to the whole page as CSS custom properties. The table waits for the stored choice, so a page
  // whose viewer picked Dusk does not first build Paper's scene.
  const choice = new ThemeChoice({ settings: untrack(() => props.settings) });
  setThemeContext(choice);
  let theme = $state.raw<Theme>(choice.current());
  // The viewer's look (M7-P2, ui/design/look.ts): the HUD's and the pages' design tokens; picking one also picks its table.
  const looks = new LookChoice(choice, untrack(() => props.settings));
  setLookContext(looks);
  let look = $state(looks.current());
  let ready = $state(false);
  /** The welcome hint on the start page (M5-P5 first-run hints); the start page decides when it shows (StartRoute). */
  const startHints = new HintController(untrack(() => props.settings), { where: 'start', touch: false, voice: false });
  void startHints.load();
  const cssVars = $derived(cssText(lookCssVars(theme, look)));
  // The page without a matchmaker (a harness, blocked storage) gets one that stays off.
  const matchmaker = untrack(() => props.matchmaker ?? new FakeMatchmaker());
  const soloChime = untrack(() => settingsChime(props.settings ?? null));
  // What every table frame needs (ui/table/context.ts).
  untrack(() => {
    if (props.createScene && props.faces && props.cardData && props.game)
      setTableDeps({
        createScene: props.createScene,
        faces: props.faces,
        cardData: props.cardData,
        game: props.game,
        settings: props.settings,
        parseDecklist: props.parseDecklist,
        sets: props.sets,
        update: props.update,
        identity: props.identity,
        decks: props.decks,
        matches: props.matches ?? null,
        ratings: props.ratings ?? null,
        matchmaker,
        openPractice: props.openPractice,
      });
  });
  onMount(() => {
    // Every animation cuts under prefers-reduced-motion, on every page of the app (M5-P4, ui/a11y/motion.ts).
    installReducedMotionCss();
    registerThemeDebug(choice);
    registerLookDebug(looks);
    const off = choice.subscribe((s) => (theme = s.theme));
    const offLook = looks.subscribe((l) => (look = l));
    void choice.ready.then(() => (ready = true));
    return () => {
      off();
      offLook();
    };
  });
  // `#/build[/<id>]` (M6-P5's routes) go to Decks (decks.md section 1).
  $effect(() => {
    const canonical = routeHash(route);
    if (/^#\/build(\/|$)/.test(location.hash) && canonical !== location.hash) history.replaceState(history.state, '', canonical);
  });
  // Updates only between games (M5-P3, ui/storage/UpdateNotice.svelte): the pages without a table and the sandbox
  // here; a networked table shows its own notice with its stage (ui/table/TableFrame.svelte).
  let soloStage = $state<Stage | null>(null);
  let sandbox = $state.raw<TableSession | null>(untrack(() => props.session ?? null));
  $effect(() => {
    const s = sandbox;
    if (!s || route.name !== 'solo') return;
    soloStage = s.getState().stage;
    return s.subscribe((st) => (soloStage = st.stage));
  });
  const updatePlace = $derived<UpdatePlace>(route.name === 'solo' ? { route: 'solo', stage: soloStage } : { route: route.name, stage: null });
  // The page itself (body background, scrollbars, form controls) follows the theme and the look too.
  $effect(() => {
    const root = document.documentElement;
    for (const [k, v] of Object.entries(lookCssVars(theme, look))) root.style.setProperty(k, v);
    root.dataset.theme = theme.id;
    root.dataset.look = look;
  });

  /** The sandbox's session: main.ts's eager one at `#/solo`, else opened once when the route is first shown. */
  function openSandbox(): Promise<TableSession> {
    if (sandbox) return Promise.resolve(sandbox);
    if (!props.openSandbox) return Promise.reject(new Error('this page has no table'));
    return props.openSandbox().then((s) => (sandbox = s));
  }
  const tableReady = $derived(!!(props.createScene && props.faces && props.cardData && props.game));
  const testid = (r: Route): string => `route-${r.name === 'diagJoin' ? 'diag' : r.name === 'deckNew' || r.name === 'deck' || r.name === 'deckOpen' ? 'decks' : r.name}`;
</script>

<svelte:window onhashchange={onHashChange} />

{#if route.name !== 'room' && route.name !== 'practice' && route.name !== 'computer'}<UpdateNotice update={props.update} place={updatePlace} />{/if}
<!-- [M8-P7] A search goes on over a solo table (the sandbox, practice, a computer game): the match-found card shows
     there too; its notices wait for Home's toast host. -->
<!-- Practice and computer tables mount their own MatchHost in the table frame (M8-P8); only the sandbox needs this one. -->
{#if route.name === 'solo'}<MatchHost {matchmaker} chime={soloChime} notices={false} />{/if}
<OfflineNotice />
<FrameMeter />

{#if !ready && waitsForStoredTheme(route)}
  <!-- Reading the stored theme before a table builds its scene: a moment, at most a few seconds (ui/settings/theme.ts).
       The pages without a scene (Home, the start page, the connection check) do not wait. -->
  <p class="theme-wait" role="status" data-testid="theme-wait">Loading…</p>
{:else if route.name === 'solo'}
  {#if tableReady && (props.session || props.openSandbox)}
    <SoloRoute kind="sandbox" code={null} open={openSandbox} games={props.games ?? null} {go} />
  {:else}
    <Smoke />
  {/if}
{:else if route.name === 'practice'}
  {#key route.room}
    {@const room = route.room}
    {#if tableReady && props.openPractice}
      <SoloRoute kind="practice" code={room} open={() => props.openPractice!(room)} release={(s) => s.dispose()} games={props.games ?? null} {go} />
    {:else}
      <main class="sp-page" data-testid="route-practice"><p role="alert">This page cannot open a table.</p><p><a href="#/">Home</a></p></main>
    {/if}
  {/key}
{:else if route.name === 'computer'}
  {#key route.room}
    <ComputerRoute room={route.room} {go} registerTable={props.registerTable} />
  {/key}
{:else if route.name === 'room'}
  {#key `${route.room}/${route.key}`}
    <RoomRoute app={props} room={route.room} roomKey={route.key} {cssVars} />
  {/key}
{:else if isShellRoute(route)}
  <Shell {route} settings={props.settings ?? null} {matchmaker} games={props.games ?? null} {go}>
    <div class="ds-root shell-route" data-testid={testid(route)}>
      {#if route.name === 'home'}
        <Home {matchmaker} games={props.games ?? null} newRoom={props.newRoom} openPractice={props.openPractice} {go} />
      {:else if route.name === 'decks' || route.name === 'deckNew' || route.name === 'deck' || route.name === 'deckOpen'}
        <DecksRoute
          {route}
          decks={props.decks ?? null}
          settings={props.settings ?? null}
          cardData={props.cardData}
          sets={props.sets}
          faces={props.faces}
          searching={() => ['connecting', 'seeking', 'check', 'moving'].includes(matchmaker.status().phase)}
          {go}
        />
      {:else if route.name === 'history'}
        <HistoryPage games={props.games ?? null} {go} />
      {:else if route.name === 'settings'}
        <div class="sp-page"><SettingsPage settings={props.settings} keymap={props.game?.keymap ?? []} /></div>
      {:else if route.name === 'about'}
        <div class="sp-page"><About /></div>
      {:else if route.name === 'diag' || route.name === 'diagJoin'}
        <div class="sp-page"><DiagRoute diag={props.diag} room={route.name === 'diagJoin' ? { roomId: route.room, roomKey: route.key } : null} /></div>
      {/if}
    </div>
  </Shell>
{:else}
  <main class="sp-page ds-root" style={cssVars} data-testid={testid(route)}>
    {#if route.name === 'lobby'}
      <StartRoute start={props.start} welcome={startHints} />
      <p class="links"><a href="#/settings" data-testid="link-settings">Settings</a> · <a href="#/about" data-testid="link-about">About Spellplane</a></p>
    {:else if route.name === 'notFound'}
      <h1>Not found</h1>
      <p>There is nothing at {route.hash}.</p>
    {/if}
    <p><a href="#/">Home</a></p>
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
  /* The page frame of the pages outside a table (also used by ui/lobby/RoomRoute.svelte). */
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
  :global(.shell-route .sp-page) {
    max-height: none;
    background: transparent;
    padding-top: 24px;
  }
  :global(.sp-page a) {
    color: var(--sp-fg);
  }
  :global(.sp-page .links) {
    font-size: var(--ds-type-small);
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
