<!--
  M5-P3's one-time hints (ui/storage/hints.ts): the Home Screen hint on iPhone and iPad (PLAN Milestone 5, owner
  decisions, Installable on iPad: Safari deletes a site's storage after 7 days without a visit unless it is on the Home
  Screen) and the storage-persistence prompt (PLAN M5-P3). Each shows until the player answers it once; the answer is
  kept in Settings.hintsSeen. `inline` flows with the page (start page); `corner` floats in a corner, away from the
  table (the in-table lobby). Without a settings store a hint is shown at most once per page.
-->
<script lang="ts">
  import { onMount } from 'svelte';
  import { isStoragePersisted, requestPersistentStorage } from '../../store/persist';
  import type { HintId, SettingsStore } from '../../store/types';
  import { HOME_SCREEN_HINT, pageHintEnv, PERSIST_HINT, showHomeScreenHint, showPersistHint, withSeen, type HintEnv } from './hints';

  let {
    settings,
    hints,
    placement = 'inline',
    env = pageHintEnv(),
  }: { settings?: SettingsStore | undefined; hints: readonly ('installHomeScreen' | 'persistStorage')[]; placement?: 'inline' | 'corner'; env?: HintEnv } = $props();

  let seen = $state<HintId[] | null>(null);
  let persistState = $state<{ supported: boolean; persisted: boolean } | null>(null);
  let persistAnswer = $state('');

  onMount(() => {
    void (settings?.get('hintsSeen') ?? Promise.resolve([] as HintId[])).then(
      (s) => (seen = s),
      () => (seen = []),
    );
    if (hints.includes('persistStorage')) {
      const supported = typeof navigator !== 'undefined' && typeof navigator.storage?.persist === 'function';
      void isStoragePersisted().then((persisted) => (persistState = { supported, persisted }));
    }
  });

  async function dismiss(id: HintId): Promise<void> {
    try {
      // Read again before writing: another hint may have been answered in another tab.
      const stored = (await settings?.get('hintsSeen')) ?? [];
      await settings?.set('hintsSeen', withSeen(stored, id));
    } catch {
      // Storage blocked: the hint stays away for this page only.
    }
    // Hidden once the answer is stored (a few milliseconds), so a reload right after never shows it again.
    seen = withSeen(seen ?? [], id);
  }

  async function keep(): Promise<void> {
    const granted = await requestPersistentStorage();
    persistAnswer = granted ? PERSIST_HINT.granted : PERSIST_HINT.refused;
    await dismiss('persistStorage');
  }

  const homeScreen = $derived(seen !== null && hints.includes('installHomeScreen') && showHomeScreenHint(env, seen));
  const persist = $derived(seen !== null && persistState !== null && hints.includes('persistStorage') && showPersistHint(persistState, seen));
</script>

{#if homeScreen}
  <aside class="hint {placement}" data-testid="hint-home-screen" aria-labelledby="hint-home-screen-title">
    <h2 id="hint-home-screen-title">{HOME_SCREEN_HINT.title}</h2>
    <p>{HOME_SCREEN_HINT.body}</p>
    <p class="small">{HOME_SCREEN_HINT.backup}</p>
    <button type="button" data-testid="hint-home-screen-ok" onclick={() => void dismiss('installHomeScreen')}>Got it</button>
  </aside>
{/if}
{#if persist}
  <aside class="hint {placement}" data-testid="hint-persist" aria-labelledby="hint-persist-title">
    <h2 id="hint-persist-title">{PERSIST_HINT.title}</h2>
    <p>{PERSIST_HINT.body}</p>
    <div class="row">
      <button type="button" class="primary" data-testid="hint-persist-keep" onclick={() => void keep()}>Keep them</button>
      <button type="button" data-testid="hint-persist-later" onclick={() => void dismiss('persistStorage')}>Not now</button>
    </div>
  </aside>
{/if}
{#if persistAnswer}<p class="answer" role="status" data-testid="hint-persist-answer">{persistAnswer}</p>{/if}

<style>
  .hint {
    display: grid;
    gap: 6px;
    padding: 12px 16px;
    border: 1px solid var(--sp-border, #ccc);
    border-radius: var(--sp-radius-lg, 8px);
    background: var(--sp-surface, #fff);
    color: var(--sp-fg, #111);
    font-family: var(--sp-font, system-ui);
  }
  .hint.corner {
    position: fixed;
    right: calc(12px + env(safe-area-inset-right, 0px));
    bottom: calc(12px + env(safe-area-inset-bottom, 0px));
    max-width: min(22em, calc(100vw - 24px));
    box-shadow: var(--sp-hud-shadow, 0 2px 12px rgba(0, 0, 0, 0.2));
    z-index: 50;
  }
  h2 {
    margin: 0;
    font-size: var(--sp-font-size, 14px);
  }
  p {
    margin: 0;
    line-height: 1.4;
  }
  .small,
  .answer {
    font-size: var(--sp-font-size-small, 12px);
    color: var(--sp-muted, #555);
  }
  .answer {
    margin: 0;
  }
  .row {
    display: flex;
    gap: 8px;
  }
  button {
    font: inherit;
    min-height: 44px;
    padding: 8px 14px;
    border: 1px solid var(--sp-fg, #111);
    border-radius: var(--sp-radius-md, 4px);
    background: var(--sp-surface, #fff);
    color: var(--sp-fg, #111);
    cursor: pointer;
    justify-self: start;
  }
  button.primary {
    background: var(--sp-fg, #111);
    color: var(--sp-bg, #fff);
  }
  button:focus-visible {
    outline: 2px solid var(--sp-focus, #1f6fd1);
    outline-offset: 2px;
  }
</style>
