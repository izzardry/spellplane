<!--
  One gesture coach mark (PLAN M7-P5: "gesture coach marks that appear once at the moment an action becomes relevant
  (first draw, first land, first attack) and never cover the play area"; ui/hints/coach.ts). It sits in the HUD's slot
  above the hand, beside the prompts (docs/design/m7-hud-proposal.md: "centre-bottom, above the hand. It never covers the
  battlefield"), lets pointer events through everywhere but its own button, and goes once the gesture is done. Added by
  M7-P5.
-->
<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import type { CoachMarkId } from '../../store/types';
  import { coachText, type CoachController } from './coach';

  let { coach, touch = false }: { coach: CoachController; touch?: boolean } = $props();

  let id = $state<CoachMarkId | null>(untrack(() => coach.current()));
  onMount(() => {
    const off = coach.subscribe((c) => (id = c));
    id = coach.current();
    return off;
  });
  const shown = $derived(id ? coachText(id, touch) : null);
</script>

{#if id && shown}
  <aside class="coach" data-testid="coach-mark" data-coach={id} data-anchor={shown.anchor} aria-live="polite">
    <span class="dot" aria-hidden="true"></span>
    <span class="text">{shown.text}</span>
    <button type="button" data-testid="coach-dismiss" onclick={() => id && coach.dismiss(id)}>Got it</button>
  </aside>
{/if}

<style>
  .coach {
    display: flex;
    align-items: center;
    gap: 10px;
    max-width: min(520px, 92vw);
    padding: 6px 6px 6px 12px;
    pointer-events: none;
    background: var(--ds-coach, var(--sp-surface, #fff));
    color: var(--ds-coach-ink, var(--sp-fg, #111));
    border: 1px solid var(--ds-border, var(--sp-border, #d8d8d8));
    border-radius: 999px;
    box-shadow: var(--ds-elevation-pop, 0 2px 8px rgb(0 0 0 / 18%));
    font: 500 13px/1.3 var(--ds-font-body, var(--sp-font, system-ui));
    animation: appear 160ms ease-out;
  }
  .dot {
    flex: none;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--ds-accent, var(--sp-focus, #2563eb));
  }
  button {
    pointer-events: auto;
    flex: none;
    min-height: 28px;
    padding: 0 12px;
    border-radius: 999px;
    border: 1px solid var(--ds-border, var(--sp-border, #d8d8d8));
    background: transparent;
    color: inherit;
    font: 600 12px/1 var(--ds-font-body, var(--sp-font, system-ui));
    cursor: pointer;
  }
  :global(.touch-ui) .coach button {
    min-height: 44px;
  }
  @keyframes appear {
    from {
      opacity: 0;
    }
    to {
      opacity: 1;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .coach {
      animation: none;
    }
  }
</style>
