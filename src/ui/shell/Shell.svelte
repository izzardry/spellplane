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
  import SeatGlyph from '../design/SeatGlyph.svelte';
  import Segmented from '../design/Segmented.svelte';
  import ToastHost from '../design/ToastHost.svelte';
  import HistoryPage from '../history/HistoryPage.svelte';
  import { randomNickname } from '../lobby/names';
  import QueueChip from '../play/QueueChip.svelte';
  import type { Matchmaker, MatchmakerStatus } from '../../session/types';
  import type { GameStore, IdentityStore, RatingStore, SettingsStore } from '../../store/types';
  import { navOf, type ShellRoute } from './nav';

  let {
    route,
    settings: _settings = null,
    matchmaker,
    games = null,
    identity = null,
    ratings = null,
    still = null,
    go = (h: string) => (location.hash = h),
    children = undefined,
  }: {
    route: ShellRoute;
    settings?: SettingsStore | null;
    matchmaker: Matchmaker;
    games?: GameStore | null;
    /** The profile chip's nickname and colour (made up on first visit). */
    identity?: IdentityStore | null;
    ratings?: RatingStore | null;
    /** The soft arena still for the backdrop (scene/still.ts renderArenaStill bound to the look); null shows the gradient. */
    still?: (() => Promise<Blob | null>) | null;
    go?: (hash: string) => void;
    children?: Snippet | undefined;
  } = $props();

  let status: MatchmakerStatus = $state(matchmaker.status());
  const offMm = matchmaker.subscribe((s) => (status = s));
  let nickname = $state('');
  let draftName = $state('');
  let rating: number | null = $state(null);
  let profileOpen = $state(false);
  let gearOpen = $state(false);
  let stillUrl: string | null = $state(null);
  let alive = true;

  const nav = $derived(navOf(route));
  const searching = $derived(status.phase !== 'off' && status.phase !== 'watching');

  onMount(() => {
    void (async () => {
      if (identity) {
        try {
          const me = await identity.get();
          let name = me.nickname;
          if (!name) {
            name = randomNickname();
            await identity.setNickname(name);
          }
          if (alive) nickname = draftName = name;
        } catch {
          /* storage blocked: no chip name */
        }
      }
      try {
        const r = await ratings?.get('1v1.constructed');
        if (alive && r) rating = Math.round(r.rating);
      } catch {
        /* no rating */
      }
      try {
        const blob = still ? await still() : null;
        if (alive && blob) stillUrl = URL.createObjectURL(blob);
      } catch {
        /* the gradient stays */
      }
    })();
  });

  onDestroy(() => {
    alive = false;
    offMm();
    if (stillUrl) URL.revokeObjectURL(stillUrl);
  });

  async function saveName(): Promise<void> {
    const name = draftName.trim().slice(0, 24);
    if (!name || name === nickname) return;
    nickname = name;
    await identity?.setNickname(name).catch(() => undefined);
  }

  function navigate(v: string): void {
    go(v === 'play' ? '#/' : `#/${v}`);
  }

  function closeMenus(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      profileOpen = false;
      gearOpen = false;
    }
  }
</script>

<svelte:window onkeydown={closeMenus} />

<div class="shell" data-testid="shell">
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
      <Button size="md" onclick={() => ((profileOpen = !profileOpen), (gearOpen = false))} aria-expanded={profileOpen} data-testid="profile-chip">
        {#snippet icon()}<SeatGlyph seat={0} colour="var(--ds-seat-a)" size={28} />{/snippet}
        <span class="shell__nick">{nickname || 'PROFILE'}</span>
      </Button>
      <IconButton label="Settings and more" onclick={() => ((gearOpen = !gearOpen), (profileOpen = false))} aria-expanded={gearOpen} data-testid="shell-gear">⚙</IconButton>
      {#if profileOpen}
        <div class="shell__pop" role="dialog" aria-label="Profile" data-testid="profile-popover">
          <Field label="Nickname" bind:value={draftName} onenter={() => void saveName()} onblur={() => void saveName()} data-testid="profile-name" />
          {#if rating !== null}<p class="shell__meta">RATING {rating} · Ranked is an honour system.</p>{/if}
          <Button size="sm" variant="quiet" onclick={() => ((profileOpen = false), go('#/settings'))}>BACK UP MY DATA</Button>
        </div>
      {/if}
      {#if gearOpen}
        <div class="shell__pop shell__menu" role="menu" aria-label="More" data-testid="gear-menu">
          <Button size="sm" variant="quiet" role="menuitem" onclick={() => ((gearOpen = false), go('#/settings'))}>SETTINGS</Button>
          <Button size="sm" variant="quiet" role="menuitem" onclick={() => ((gearOpen = false), go('#/about'))}>ABOUT</Button>
          <Button size="sm" variant="quiet" role="menuitem" onclick={() => ((gearOpen = false), go('#/diag'))}>CONNECTION CHECK</Button>
        </div>
      {/if}
    </div>
  </header>

  {#if searching}
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

  <ToastHost />
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
  .shell__menu { width: 220px; gap: 4px; }
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
