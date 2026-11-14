<!--
  The app is offline (PLAN M5-P3, graceful behaviour offline; gate M5-G "offline banner"): while the browser reports no
  network, a small notice says so and what still works. Tables, decks and cached card images keep working from this
  device; joining a room and new card data or images wait for the connection. It takes no clicks, so it never gets in
  the way of play, and it goes away when the connection comes back.
-->
<script lang="ts">
  import { OFFLINE_NOTICE } from './offline';

  let online = $state(typeof navigator === 'undefined' || navigator.onLine !== false);
  $effect(() => {
    const update = () => (online = navigator.onLine !== false);
    update();
    addEventListener('online', update);
    addEventListener('offline', update);
    return () => {
      removeEventListener('online', update);
      removeEventListener('offline', update);
    };
  });
</script>

{#if !online}
  <div class="offline" role="status" data-testid="offline-notice">{OFFLINE_NOTICE}</div>
{/if}

<style>
  .offline {
    position: fixed;
    left: 50%;
    top: calc(68px + env(safe-area-inset-top, 0px));
    transform: translateX(-50%);
    max-width: min(34em, calc(100vw - 24px));
    padding: 6px 12px;
    border: 1px solid var(--sp-border, #ccc);
    border-left: 4px solid var(--sp-warning, #b26a00);
    border-radius: var(--sp-radius-lg, 8px);
    background: var(--sp-surface, #fff);
    color: var(--sp-fg, #111);
    font-family: var(--sp-font, system-ui);
    font-size: var(--sp-font-size-small, 12px);
    box-shadow: var(--sp-hud-shadow, 0 2px 12px rgba(0, 0, 0, 0.2));
    pointer-events: none;
    z-index: 60;
  }
</style>
