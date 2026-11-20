<!-- Kit stub (contracts.md Part B) written by M8-P2 because M8-C's UI commit did not land; M8-P1's file replaces it. -->
<script lang="ts">
  import { toasts } from './toasts';
  let { place = 'bottom-centre' }: { place?: 'bottom-centre' | 'above-primary' } = $props();
  const items = toasts.items;
</script>

<div class="ds-toasts ds-toasts--{place}" aria-live="polite">
  {#each $items as t (t.id)}
    <div class="ds-toast" data-testid="toast" data-kind={t.kind}>
      <span class="ds-toast__text">{t.text}</span>
      {#each t.actions as a (a.label)}<button type="button" class="ds-btn-xs" class:primary={a.primary} onclick={a.run}>{a.label}</button>{/each}
      <button type="button" class="ds-toast__close" aria-label="Close" onclick={() => toasts.dismiss(t.id)}>×</button>
    </div>
  {/each}
</div>

<style>
  .ds-toasts { position: fixed; left: 50%; bottom: 24px; transform: translateX(-50%); display: flex; flex-direction: column; gap: 8px; z-index: 70; max-width: calc(100vw - 32px); }
  .ds-toast { display: flex; align-items: center; gap: 12px; min-height: 52px; box-sizing: border-box; padding: 12px 16px; border-radius: 12px; background: var(--ds-panel-raised); color: var(--ds-ink); box-shadow: var(--ds-elevation-pop); font-size: 13px; }
  .ds-btn-xs, .ds-toast__close { height: 28px; min-width: 28px; padding: 0 12px; border: 0; border-radius: 999px; background: var(--ds-chip); color: var(--ds-ink); font: inherit; font-size: 11px; font-weight: 600; letter-spacing: 0.08em; cursor: pointer; }
  .ds-btn-xs.primary { background: var(--ds-ink); color: var(--ds-panel); }
  .ds-toast__close { padding: 0; background: transparent; }
</style>
