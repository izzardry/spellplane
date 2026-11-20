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
  import Button from '../design/Button.svelte';

  let {
    coach,
    touch = false,
    bottom = null,
    hidden = false,
  }: {
    coach: CoachController;
    touch?: boolean;
    /** Where the slot above the hand starts, from the window's bottom edge (the HUD's above-hand offset). */
    bottom?: string | null;
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
  <aside class="coach ds-coach" style:bottom={bottom} data-testid="coach-mark" data-coach={id} data-anchor={shown.anchor} aria-live="polite">
    <span class="dot" aria-hidden="true"></span>
    <span class="text ds-coach__text">{shown.text}</span>
    <Button variant="ghost" size={touch ? 'md' : 'xs'} data-testid="coach-dismiss" onclick={() => id && coach.dismiss(id)}>Got it</Button>
  </aside>
{/if}

<style>
  /* The kit's coach recipe (.ds-coach) gives the look; this places it in the slot above the hand. */
  .coach {
    position: fixed;
    left: 50%;
    /* The HUD's slot above the hand (Hud.svelte .above-hand) unless the HUD passes where it starts now. */
    bottom: calc(22vh + 16px);
    /* Under the strip and the pile actions (22): a control the player just opened is never covered by a hint. */
    z-index: 21;
    transform: translateX(-50%);
    margin-bottom: 8px;
    display: flex;
    align-items: center;
    gap: var(--ds-space-md, 10px);
    /* Narrow enough to stay clear of the own piles at the territory's right edge (an iPad's library sits about 220 px
       right of the centre); a longer line wraps. */
    max-width: min(380px, calc(100vw - 32px));
    padding: 6px 6px 6px 12px;
    pointer-events: none;
    font-family: var(--ds-font-body, var(--sp-font));
    font-size: var(--ds-type-body, 13px);
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
  .coach :global(.ds-btn) {
    pointer-events: auto;
    flex: none;
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
