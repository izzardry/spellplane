<!--
  The shell around Home, Decks, History, Settings, About and Diag (docs/design/m8/contracts.md Part C; journey.md 4.1,
  4.15): the top bar with the wordmark and the nav PLAY · DECKS · HISTORY, the queue bar while a search runs, the
  match-found card and the page's toasts. Stub by M8-C: a plain top bar over the page. M8-P2 owns the file.
-->
<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { Matchmaker } from '../../session/types';
  import type { GameStore, SettingsStore } from '../../store/types';
  import ToastHost from '../design/ToastHost.svelte';
  import MatchHost from '../play/MatchHost.svelte';
  import QueueChip from '../play/QueueChip.svelte';
  import type { Route } from '../routes';

  let {
    route,
    settings: _settings = null,
    matchmaker,
    games: _games = null,
    go = (h: string) => (location.hash = h),
    children = undefined,
  }: {
    route: Route;
    settings?: SettingsStore | null;
    matchmaker: Matchmaker;
    games?: GameStore | null;
    go?: (hash: string) => void;
    children?: Snippet | undefined;
  } = $props();

  const here = $derived(route.name === 'home' ? 'play' : route.name === 'history' ? 'history' : route.name.startsWith('deck') ? 'decks' : null);
  const links = [
    { id: 'play', label: 'Play', href: '#/' },
    { id: 'decks', label: 'Decks', href: '#/decks' },
    { id: 'history', label: 'History', href: '#/history' },
  ] as const;
</script>

<div class="ds-root shell" data-testid="shell">
  <header class="shell-top">
    <a class="ds-t-word wordmark" href="#/" aria-label="Spellplane, home">Spellplane</a>
    <nav class="ds-seg ds-seg--sm" aria-label="Main" data-testid="shell-nav">
      {#each links as l (l.id)}<a class="ds-seg__opt" class:on={here === l.id} href={l.href} aria-current={here === l.id ? 'page' : undefined} data-nav={l.id}>{l.label}</a>{/each}
    </nav>
    <a class="ds-t-meta" href="#/settings" data-testid="link-settings">Settings</a>
  </header>
  <div class="shell-queue"><QueueChip {matchmaker} onhome={() => go('#/')} /></div>
  <div class="shell-page">{@render children?.()}</div>
  <MatchHost {matchmaker} />
  <ToastHost place="bottom-centre" />
</div>

<style>
  .shell {
    box-sizing: border-box;
    height: 100%;
    display: flex;
    flex-direction: column;
    background: var(--ds-mat);
    color: var(--ds-ink);
    font-family: var(--ds-font-body);
  }
  .shell-top {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--ds-space-lg);
    padding: var(--ds-space-xl) var(--ds-space-xxl) 0;
  }
  .wordmark {
    color: var(--ds-ink);
    text-decoration: none;
  }
  .shell-page {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
  }
  @media (max-width: 600px) {
    .shell-top {
      padding: var(--ds-space-lg) var(--ds-space-lg) 0;
      flex-wrap: wrap;
    }
  }
</style>
