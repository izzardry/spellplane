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

  let {
    coach,
    touch = false,
    bottom = '0px',
    hidden = false,
  }: {
    coach: CoachController;
    touch?: boolean;
    /** Where the slot above the hand starts, from the window's bottom edge (the HUD's above-hand offset). */
    bottom?: string;
    /** Nothing is shown (a read-only table, a prompt in the slot); the mark waits and returns. */
    hidden?: boolean;
  } = $props();

  let id = $state<CoachMarkId | null>(untrack(() => coach.current()));
  onMount(() => {
    const off = coach.subscribe((c) => (id = c));
    id = coach.current();
    return off;
  });
  const shown = $derived(id ? coachText(id, touch) : null);
</script>

{#if id && shown && !hidden}
  <aside class="coach" style:bottom={bottom} data-testid="coach-mark" data-coach={id} data-anchor={shown.anchor} aria-live="polite">
    <span class="dot" aria-hidden="true"></span>
    <span class="text">{shown.text}</span>
    <button type="button" class="ds-btn ds-btn--ghost {touch ? 'ds-btn--md' : 'ds-btn--xs'}" data-testid="coach-dismiss" onclick={() => id && coach.dismiss(id)}>Got it</button>
  </aside>
{/if}

<style>
  .coach {
    position: fixed;
    left: 50%;
    z-index: 23;
    transform: translateX(-50%);
    margin-bottom: 8px;
    display: flex;
    align-items: center;
    gap: 10px;
    max-width: min(520px, 92vw);
    padding: 6px 6px 6px 12px;
    pointer-events: none;
    background: var(--ds-coach, var(--sp-surface));
    color: var(--ds-coach-ink, var(--sp-fg));
    border: 1px solid var(--ds-border, var(--sp-border));
    border-radius: 999px;
    box-shadow: var(--ds-elevation-pop, var(--sp-hud-shadow));
    font-family: var(--ds-font-body, var(--sp-font));
    font-weight: 500;
    font-size: 13px;
    line-height: 1.3;
    animation: appear 160ms ease-out;
  }
  .dot {
    flex: none;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--ds-accent, var(--sp-focus));
  }
  button {
    pointer-events: auto;
    flex: none;
    height: 28px;
    box-sizing: border-box;
    padding: 0 12px;
    border-radius: 999px;
    border: 1px solid var(--ds-border, var(--sp-border));
    background: transparent;
    color: inherit;
    font-family: var(--ds-font-body, var(--sp-font));
    font-weight: 600;
    font-size: 12px;
    line-height: 1;
    cursor: pointer;
  }
  .coach button.ds-btn--md {
    height: 44px;
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
