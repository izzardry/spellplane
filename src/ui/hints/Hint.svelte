<!--
  A first-run hint (PLAN M5-P5: short, dismissible, never blocking; ui/hints/hints.ts). It sits in a corner, takes no
  focus and lets pointer events through everywhere but its own button, so the table stays live under it.
-->
<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import type { ActionId } from '../../games/types';
  import { hintText, type FirstRunHint, type HintController } from './hints';

  let {
    hints,
    keyOf = () => null,
    placement = 'corner',
  }: {
    hints: HintController;
    keyOf?: (action: ActionId) => string | null;
    /** 'corner': fixed at the top centre of the screen, below the turn strip; 'inline': in the page flow. */
    placement?: 'corner' | 'inline';
  } = $props();

  let hint = $state<FirstRunHint | null>(untrack(() => hints.current()));
  // Read again on mount: the stored hints may have loaded between the first render and the subscription.
  onMount(() => {
    const off = hints.subscribe((h) => (hint = h));
    hint = hints.current();
    return off;
  });
  const shown = $derived(hint ? hintText(hint, keyOf, hints.touch) : null);
</script>

{#if hint && shown}
  <aside class="hint {placement}" data-testid="hint" data-hint={hint} aria-label="Hint: {shown.title}">
    <strong>{shown.title}</strong>
    <span>{shown.text}</span>
    <button type="button" data-testid="hint-dismiss" onclick={() => void hints.dismiss(hint!)}>Got it</button>
  </aside>
{/if}

<style>
  .hint {
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
    gap: 4px;
    max-width: min(300px, calc(100vw - 32px));
    padding: 10px 12px;
    background: var(--sp-surface, #fff);
    color: var(--sp-fg, #111);
    border: 1px solid var(--sp-border, #8c8c8c);
    border-left: 3px solid var(--sp-accent, #1f6fd1);
    border-radius: var(--sp-radius-sm, 4px);
    box-shadow: var(--sp-hud-shadow, none);
    font: var(--sp-font-size-small, 12px) / 1.45 var(--sp-font, system-ui);
  }
  .hint.corner {
    position: fixed;
    z-index: 60;
    /* Top centre, below the turn strip and the notices: clear of the hand fan, the log, the toolbar and the avatars
       (M5 gate); over the far side of the table, which stays live under it. */
    left: 50%;
    transform: translateX(-50%);
    top: calc(140px + env(safe-area-inset-top, 0px));
    /* Never blocking: only the button takes pointer events. */
    pointer-events: none;
  }
  button {
    align-self: flex-end;
    pointer-events: auto;
    font: inherit;
    cursor: pointer;
    min-height: 28px;
  }
  @media (pointer: coarse) {
    button {
      min-height: 44px;
      min-width: 44px;
    }
  }
</style>
