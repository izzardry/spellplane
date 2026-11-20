<!--
  The shell around Home, Decks, History, Settings, About and Diag (journey.md section 4 "Common frame", J2, J3, J4,
  4.15; visual.md 2.9 top bar; contracts.md Part C "Shell"). M8-P2.

  - Backdrop: the soft arena still (scene/still.ts, passed in as `still`), the look's gradient while it is null, under
    the veil. No CSS blur anywhere.
  - Top bar: wordmark; the nav PLAY │ DECKS │ HISTORY as one Segmented; the profile chip with a small popover
    (nickname, made up on first visit; rating when one exists); the gear (Settings, About, Connection check).
  - The queue bar renders QueueChip while the matchmaker is not off; one ToastHost.
  - `#/history` renders the History sheet when the route has no children of its own.
-->
<script lang="ts">
  import { onDestroy, onMount, type Snippet } from 'svelte';
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
  import QueueChip from '../play/QueueChip.svelte';
  import { themeContext } from '../settings/theme';
  import { tableDeps } from '../table/context';
  import { renderArenaStill } from '../../scene/still';
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
  let alive = true;

  const nav = $derived(navOf(route));
  // The queue bar follows the player through every shell page but Home, which shows the search itself (journey.md 4.5).
  const queueBar = $derived(status.phase !== 'off' && route.name !== 'home');
  const swatches = $derived(profileColours(theme?.current() ?? null));
  const chipColour = $derived(swatches[colour] ?? 'var(--ds-accent)');

  onMount(() => {
    const mm = matchmaker;
    status = mm.status();
    const offMm = mm.subscribe((s) => (status = s));
    const me = identity !== undefined ? identity : (page?.identity ?? null);
    const rate = ratings !== undefined ? ratings : (page?.ratings ?? null);
    const draw = still !== undefined ? still : theme ? () => renderArenaStill(theme.current(), { width: Math.min(1600, Math.max(320, window.innerWidth)) }) : null;
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
      try {
        const blob = draw ? await draw() : null;
        if (alive && blob) stillUrl = URL.createObjectURL(blob);
      } catch {
        /* the gradient stays */
      }
    })();
    return offMm;
  });

  onDestroy(() => {
    alive = false;
    if (stillUrl) URL.revokeObjectURL(stillUrl);
  });

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

<svelte:window onkeydown={closeMenus} />

<div class="ds-root shell" data-testid="shell">
  <div class="shell__backdrop" aria-hidden="true">
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
      <Button size="md" onclick={() => ((profileOpen = !profileOpen), (gearOpen = false))} aria-expanded={profileOpen} aria-label="Profile: {nickname || 'you'}" data-testid="profile-chip">
        {#snippet icon()}<SeatGlyph seat={0} colour={chipColour} size={20} />{/snippet}
        <span class="shell__nick" data-testid="profile-name-chip">{nickname || 'PROFILE'}</span>
        {#if rating !== null}<span class="shell__rating">{rating}</span>{/if}
      </Button>
      <span bind:this={gearButton}>
        <IconButton label="Settings and more" onclick={() => ((gearOpen = !gearOpen), (profileOpen = false))} aria-expanded={gearOpen} data-testid="shell-gear">⚙</IconButton>
      </span>
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

  <MatchHost {matchmaker} />
  <ToastHost place="bottom-centre" />
</div>

<style>
  .shell { position: relative; min-height: 100vh; min-height: 100dvh; color: var(--ds-ink); font-family: var(--ds-font-body); overflow-x: hidden; }
  .shell__backdrop { position: fixed; inset: 0; z-index: 0; pointer-events: none; }
  .shell__still { width: 100%; height: 100%; object-fit: cover; display: block; }
  .shell__gradient { width: 100%; height: 100%; background: radial-gradient(ellipse at 50% 60%, var(--ds-mat), var(--ds-frame)); }
  .shell__veil { position: absolute; inset: 0; background: var(--ds-ghost); }
  .shell__top { position: relative; z-index: 2; display: grid; grid-template-columns: 1fr auto 1fr; align-items: center; gap: 16px; padding: 24px 32px 0; }
  .shell__word { font-size: 18px; letter-spacing: 0.4em; font-weight: 500; color: var(--ds-ink); text-decoration: none; white-space: nowrap; }
  .shell__nav { justify-self: center; }
  .shell__right { position: relative; justify-self: end; display: flex; align-items: center; gap: 8px; }
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
</style>
