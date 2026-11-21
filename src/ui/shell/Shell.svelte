<!--
  The shell around Home, Decks, History, Settings, About and Diag (journey.md section 4 "Common frame", J2, J3, J4,
  4.15; visual.md 2.9 top bar; contracts.md Part C "Shell"). M8-P2.

  - Backdrop: the soft arena still (scene/still.ts, passed in as `still`), the look's gradient while it is null, under
    the veil. One still is kept per look in use for the page (journey.md J1), so a return from a table draws none; a
    look picked in Settings swaps it. No CSS blur anywhere.
  - Top bar: wordmark; the nav PLAY │ DECKS │ HISTORY as one Segmented; the profile chip with a small popover
    (nickname, made up on first visit; rating when one exists); the gear (Settings, About, Connection check).
  - The queue bar renders QueueChip while the matchmaker is not off; one ToastHost.
  - `#/history` renders the History sheet when the route has no children of its own.
-->
<script lang="ts" module>
  let purgedThisPage = false;
</script>

<script lang="ts">
  import { onDestroy, onMount, untrack, type Snippet } from 'svelte';
  import Button from '../design/Button.svelte';
  import Field from '../design/Field.svelte';
  import IconButton from '../design/IconButton.svelte';
  import MenuPopover from '../design/MenuPopover.svelte';
  import SeatGlyph from '../design/SeatGlyph.svelte';
  import Segmented from '../design/Segmented.svelte';
  import ToastHost from '../design/ToastHost.svelte';
  import HistoryPage from '../history/HistoryPage.svelte';
  import { randomNickname } from '../lobby/names';
  import MatchHost from '../play/MatchHost.svelte';
  import { settingsChime } from '../play/mm-view';
  import QueueChip from '../play/QueueChip.svelte';
  import { themeContext } from '../settings/theme';
  import { tableDeps } from '../table/context';
  import { hasStill, stillUrlOf } from './stills';
  import type { Matchmaker, MatchmakerStatus } from '../../session/types';
  import type { GameStore, IdentityStore, RatingStore, SettingsStore } from '../../store/types';
  import { navOf, profileColours, type ShellRoute } from './nav';

  let {
    route,
    settings: _settings = null,
    matchmaker,
    games = null,
    identity = undefined,
    ratings = undefined,
    still = undefined,
    go = (h: string) => (location.hash = h),
    children = undefined,
  }: {
    route: ShellRoute;
    settings?: SettingsStore | null;
    matchmaker: Matchmaker;
    games?: GameStore | null;
    /** The profile chip's nickname and colour (made up on first visit; default: the page's identity store). */
    identity?: IdentityStore | null | undefined;
    /** The rating on the profile chip (default: the page's rating store). */
    ratings?: RatingStore | null | undefined;
    /** The soft arena still for the backdrop (default: scene/still.ts in the viewer's look); null shows the gradient. */
    still?: (() => Promise<Blob | null>) | null | undefined;
    go?: (hash: string) => void;
    children?: Snippet | undefined;
  } = $props();

  // The page's stores and the viewer's theme (App.svelte's contexts); a harness passes its own as props.
  // [M8-P7] The match-found chime under the viewer's sound setting.
  const matchChime = untrack(() => settingsChime(_settings));
  const page = tableDeps();
  const theme = themeContext();

  let status: MatchmakerStatus = $state({ phase: 'off' });
  let nickname = $state('');
  let draftName = $state('');
  let colour = $state(0);
  let rating: number | null = $state(null);
  let profileOpen = $state(false);
  let gearOpen = $state(false);
  let gearButton: HTMLElement | null = $state(null);
  let stillUrl: string | null = $state(null);
  /** Whether the backdrop is still being drawn, shows the still, or keeps the gradient (tests wait on it). */
  let stillState: 'pending' | 'still' | 'gradient' = $state('pending');
  /** A still drawn by the `still` prop (a harness): not cached, revoked on destroy. */
  let ownUrl: string | null = null;
  let stillSeq = 0;
  let alive = true;

  const nav = $derived(navOf(route));
  // The queue bar follows the player through every shell page but Home, which shows the search itself (journey.md 4.5):
  // while connecting, seeking and through the check; `watching`, `failed` (a toast) and `off` close it.
  const QUEUE_BAR_PHASES: ReadonlySet<MatchmakerStatus['phase']> = new Set(['connecting', 'seeking', 'check', 'moving']);
  const queueBar = $derived(QUEUE_BAR_PHASES.has(status.phase) && route.name !== 'home');
  const swatches = $derived(profileColours(theme?.current() ?? null));
  const chipColour = $derived(swatches[colour] ?? 'var(--ds-accent)');

  onMount(() => {
    // Removals whose undo window the last page did not outlive are purged once per page load (persistence.md section 3).
    if (!purgedThisPage && games?.purgeRemoved) {
      purgedThisPage = true;
      void games.purgeRemoved().catch(() => undefined);
    }
    const mm = matchmaker;
    status = mm.status();
    const offMm = mm.subscribe((s) => (status = s));
    const me = identity !== undefined ? identity : (page?.identity ?? null);
    const rate = ratings !== undefined ? ratings : (page?.ratings ?? null);
    void (async () => {
      if (me) {
        try {
          const rec = await me.get();
          let name = rec.nickname;
          if (!name) {
            name = randomNickname();
            await me.setNickname(name);
          }
          if (alive) {
            nickname = draftName = name;
            colour = rec.seatColour;
          }
        } catch {
          /* storage blocked: no chip name */
        }
      }
      try {
        const r = await rate?.get('1v1.constructed');
        if (alive && r) rating = Math.round(r.rating);
      } catch {
        /* no rating */
      }
    })();
    void showStill();
    // A look picked in Settings while the shell stays mounted swaps the still (its own, cached per theme).
    const offTheme = still === undefined && theme ? theme.subscribe(() => void showStill()) : null;
    return () => {
      offMm();
      offTheme?.();
    };
  });

  onDestroy(() => {
    alive = false;
    if (ownUrl) URL.revokeObjectURL(ownUrl);
  });

  /** The still of the theme shown now: from the page's cache, drawn once per theme; the gradient meanwhile. */
  async function showStill(): Promise<void> {
    const n = ++stillSeq;
    const current = (): boolean => alive && n === stillSeq;
    let url: string | null = null;
    try {
      if (still !== undefined) {
        const blob = still ? await still() : null;
        url = blob ? URL.createObjectURL(blob) : null;
        if (!current()) {
          if (url) URL.revokeObjectURL(url);
          return;
        }
        if (ownUrl) URL.revokeObjectURL(ownUrl);
        ownUrl = url;
      } else if (theme) {
        const t = theme.current();
        if (!hasStill(t)) {
          if (stillUrl !== null) stillUrl = null;
          stillState = 'pending';
        }
        url = await stillUrlOf(t, Math.min(1600, Math.max(320, window.innerWidth)));
        if (!current()) return;
      }
    } catch {
      url = null;
      if (!current()) return;
    }
    stillUrl = url;
    stillState = url ? 'still' : 'gradient';
  }

  function profileStore(): IdentityStore | null {
    return identity !== undefined ? identity : (page?.identity ?? null);
  }

  async function saveName(): Promise<void> {
    const name = draftName.trim().slice(0, 24);
    if (!name || name === nickname) return;
    nickname = name;
    await profileStore()?.setNickname(name).catch(() => undefined);
  }

  async function saveColour(c: number): Promise<void> {
    colour = c;
    await profileStore()?.setSeatColour(c).catch(() => undefined);
  }

  function navigate(v: string): void {
    go(v === 'play' ? '#/' : `#/${v}`);
  }

  function closeMenus(e: KeyboardEvent): void {
    if (e.key === 'Escape') profileOpen = false;
  }

  // A press outside the profile popover and its chip closes it (journey.md section 4 "Common frame").
  let profileHost: HTMLElement | null = $state(null);
  function closeOutside(e: PointerEvent): void {
    if (profileOpen && profileHost && e.target instanceof Node && !profileHost.contains(e.target)) profileOpen = false;
  }

  const gearGroups = [
    {
      items: [
        { id: 'settings', label: 'Settings', testid: 'gear-settings', run: () => go('#/settings') },
        { id: 'about', label: 'About', testid: 'gear-about', run: () => go('#/about') },
        { id: 'diag', label: 'Connection check', testid: 'gear-diag', run: () => go('#/diag') },
      ],
    },
  ];
</script>

<svelte:window onkeydown={closeMenus} onpointerdown={closeOutside} />

<div class="ds-root shell" class:shell--fit={route.name === 'deck'} data-testid="shell">
  <div class="shell__backdrop" aria-hidden="true" data-testid="shell-backdrop" data-still={stillState}>
    {#if stillUrl}<img class="shell__still" src={stillUrl} alt="" data-testid="shell-still" />{:else}<div class="shell__gradient" data-testid="shell-gradient"></div>{/if}
    <div class="shell__veil"></div>
  </div>

  <header class="shell__top">
    <a class="shell__word" href="#/" aria-label="Spellplane, Home">SPELLPLANE</a>
    <nav class="shell__nav" aria-label="Places">
      <Segmented
        label="Places"
        value={nav ?? ''}
        onchange={navigate}
        options={[
          { value: 'play', label: 'PLAY' },
          { value: 'decks', label: 'DECKS' },
          { value: 'history', label: 'HISTORY' },
        ]}
        data-testid="shell-nav"
      />
    </nav>
    <div class="shell__right">
      <span class="shell__profile" bind:this={profileHost}>
        <Button size="md" onclick={() => ((profileOpen = !profileOpen), (gearOpen = false))} aria-expanded={profileOpen} aria-label="Profile: {nickname || 'you'}" data-testid="profile-chip">
          {#snippet icon()}<SeatGlyph seat={0} colour={chipColour} size={20} />{/snippet}
          <span class="shell__nick" data-testid="profile-name-chip">{nickname || 'PROFILE'}</span>
          {#if rating !== null}<span class="shell__rating">{rating}</span>{/if}
        </Button>
        {#if profileOpen}
          <div class="ds-pop shell__pop" role="dialog" aria-label="Profile" data-ds-layer="popover" data-testid="profile-popover">
            <Field label="Nickname" bind:value={draftName} onenter={() => void saveName()} onblur={() => void saveName()} data-testid="profile-name" />
            {#if swatches.length}
              <div class="shell__swatches" role="radiogroup" aria-label="Seat colour" data-testid="profile-colours">
                {#each swatches as c, i (i)}
                  <button type="button" role="radio" class="ds-btn ds-btn--quiet ds-btn--xs shell__swatch" aria-checked={colour === i} aria-label="Seat colour {i + 1}" onclick={() => void saveColour(i)}>
                    <SeatGlyph seat={i % 4} colour={c} size={16} />
                  </button>
                {/each}
              </div>
            {/if}
            {#if rating !== null}<p class="shell__meta">RATING {rating} · Ranked is an honour system.</p>{/if}
            <Button size="sm" variant="quiet" onclick={() => ((profileOpen = false), go('#/settings'))}>BACK UP MY DATA</Button>
          </div>
        {/if}
      </span>
      <span bind:this={gearButton}>
        <IconButton label="Settings and more" onclick={() => ((gearOpen = !gearOpen), (profileOpen = false))} aria-expanded={gearOpen} data-testid="shell-gear">⚙</IconButton>
      </span>
      {#if gearOpen}
        <div class="shell__gear"><MenuPopover bind:open={gearOpen} anchor={gearButton} groups={gearGroups} label="More" placement="below" testid="gear-menu" /></div>
      {/if}
    </div>
  </header>

  {#if queueBar}
    <div class="shell__queue" data-testid="queue-bar">
      <QueueChip {matchmaker} onhome={() => go('#/')} />
    </div>
  {/if}

  <main class="shell__main">
    {#if children}
      {@render children()}
    {:else if route.name === 'history'}
      <HistoryPage {games} {go} />
    {/if}
  </main>

  <MatchHost {matchmaker} chime={matchChime} />
  <ToastHost place="bottom-centre" />
</div>

<style>
  /* overflow-x: clip, not hidden: a hidden overflow is a scroll container that focus or scrollIntoView could scroll
     sideways, taking the top bar and the left gutter off screen (gate M8 finding F7). */
  .shell { position: relative; min-height: 100vh; min-height: 100dvh; color: var(--ds-ink); font-family: var(--ds-font-body); overflow-x: clip; }
  /* A page that fills the window and scrolls inside its own panes (the deck page, board 3): the document never scrolls,
     so the top bar stays on screen. Wide windows only; narrower, the page scrolls as one column. */
  @media (min-width: 1101px) {
    .shell--fit { display: flex; flex-direction: column; height: 100vh; height: 100dvh; overflow: hidden; }
    .shell--fit .shell__main { flex: 1; min-height: 0; padding-bottom: 24px; }
    .shell--fit .shell__main > :global(*),
    .shell--fit .shell__main > :global(* > [data-testid='decks-route']) { height: 100%; min-height: 0; }
  }
  .shell__backdrop { position: fixed; inset: 0; z-index: 0; pointer-events: none; }
  .shell__still { width: 100%; height: 100%; object-fit: cover; display: block; }
  .shell__gradient { width: 100%; height: 100%; background: radial-gradient(ellipse at 50% 60%, var(--ds-mat), var(--ds-frame)); }
  .shell__veil { position: absolute; inset: 0; background: var(--ds-ghost); }
  .shell__top { position: relative; z-index: 2; display: grid; grid-template-columns: 1fr auto 1fr; align-items: center; gap: 16px; padding: 24px 32px 0; }
  .shell__word { font-size: 18px; letter-spacing: 0.4em; font-weight: 500; color: var(--ds-ink); text-decoration: none; white-space: nowrap; }
  .shell__nav { justify-self: center; }
  .shell__right { position: relative; justify-self: end; display: flex; align-items: center; gap: 8px; }
  .shell__profile { display: contents; }
  .shell__nick { max-width: 140px; overflow: hidden; text-overflow: ellipsis; text-transform: none; letter-spacing: 0; }
  .shell__pop { position: absolute; top: 52px; right: 0; z-index: 60; width: 280px; box-sizing: border-box; padding: 16px; border-radius: 16px; background: var(--ds-panel-raised); box-shadow: var(--ds-elevation-pop); display: flex; flex-direction: column; gap: 12px; }
  .shell__gear { position: absolute; top: 52px; right: 0; z-index: 60; width: 240px; }
  .shell__swatches { display: flex; flex-wrap: wrap; gap: 4px; }
  .shell__swatch[aria-checked='true'] { box-shadow: inset 0 0 0 2px var(--ds-ink); }
  .shell__rating { font-size: 11px; color: var(--ds-muted); }
  .shell__meta { margin: 0; font-size: 11px; color: var(--ds-muted); }
  .shell__queue { position: relative; z-index: 2; display: flex; justify-content: center; margin-top: 12px; }
  .shell__main { position: relative; z-index: 1; padding: 24px 32px 64px; box-sizing: border-box; }
  @media (max-width: 767px) {
    .shell__top { grid-template-columns: 1fr auto; padding: 12px 16px 0; }
    .shell__word { font-size: 14px; letter-spacing: 0.2em; }
    .shell__nav { grid-column: 1 / -1; grid-row: 2; }
    .shell__nick { display: none; }
    .shell__main { padding: 16px 16px 64px; }
  }
  /* Phone (journey.md section 4): the nav is a bottom tab bar, 56 px plus the safe area; toasts sit above it. */
  @media (max-width: 600px) {
    .shell__nav { position: fixed; left: 0; right: 0; bottom: 0; z-index: 3; display: flex; justify-content: center; align-items: center; box-sizing: content-box; height: 56px; padding: 0 16px env(safe-area-inset-bottom); background: var(--ds-panel-raised); box-shadow: var(--ds-elevation-pop); }
    .shell__main { padding-bottom: calc(64px + 56px + env(safe-area-inset-bottom)); }
    .shell :global(.ds-toast-host--bottom-centre) { bottom: calc(56px + env(safe-area-inset-bottom) + var(--ds-space-md)); }
  }
</style>
