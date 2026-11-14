<!--
  Updates only between games (PLAN Milestone 5, owner decisions): while a new version waits and the page is mid-game,
  the notice "New version available: it applies after this game" shows; where ui/update.ts allows (pages without a
  table, a table in its lobby) the waiting version is applied at once, which reloads the page into it. The notice never
  takes clicks, so it cannot get in the way of play.
-->
<script lang="ts">
  import { UPDATE_NOTICE, type UpdateStatus } from '../../util/pwa';
  import type { AppUpdate, UpdatePlace } from '../update';

  let { update, place }: { update?: AppUpdate | undefined; place: UpdatePlace } = $props();

  let status = $state<UpdateStatus>('current');
  $effect(() => {
    const u = update;
    if (!u) return;
    status = u.status();
    return u.subscribe((s) => (status = s));
  });
  // Apply as soon as the update waits at an allowed place, or the page arrives at one.
  $effect(() => {
    if (status === 'available') update?.applyAt({ route: place.route, stage: place.stage });
  });
</script>

{#if status === 'available'}
  <div class="notice" role="status" data-testid="update-notice">{UPDATE_NOTICE}</div>
{:else if status === 'applying'}
  <div class="notice" role="status" data-testid="update-applying">Updating to the new version…</div>
{/if}

<style>
  .notice {
    position: fixed;
    left: 50%;
    /* Below the turn strip (two rows on a tablet), never over the phases (M5 gate). */
    top: calc(104px + env(safe-area-inset-top, 0px));
    transform: translateX(-50%);
    max-width: calc(100vw - 24px);
    padding: 6px 12px;
    border: 1px solid var(--sp-border, #ccc);
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
