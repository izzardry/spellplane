<!--
  The thumb action bar (DESIGN "Input and interaction design", Touch: "A slim action bar above the hand exposes Attack,
  Settle, Resolve, Ask and the talk button, sized for thumbs"; PLAN Milestone 5, owner decisions). Each button runs its
  keymap action through ui/commands.ts, as the key and the context menu do; Talk acts while it is held.
-->
<script lang="ts">
  import type { ActionId } from '../../games/types';
  import { THUMB_BAR, TOUCH_TARGET_PX, type ThumbAction } from './actions';

  let {
    run,
    keyOf,
    talking = false,
    resolveLit = true,
  }: {
    run: (action: ActionId, phase: 'start' | 'end') => void;
    keyOf: (action: ActionId) => string | null;
    talking?: boolean;
    resolveLit?: boolean;
  } = $props();

  /** The pointer holding a hold button (talk), so its release ends it wherever the finger lifts. */
  let holding = $state<{ action: ActionId; pointer: number } | null>(null);

  function press(e: PointerEvent, b: ThumbAction) {
    if (!b.hold || holding) return;
    e.preventDefault();
    try {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    } catch {
      // Synthetic events without an active pointer cannot be captured.
    }
    holding = { action: b.action, pointer: e.pointerId };
    run(b.action, 'start');
  }
  function release(e: PointerEvent) {
    if (!holding || holding.pointer !== e.pointerId) return;
    const a = holding.action;
    holding = null;
    run(a, 'end');
  }
  function key(e: KeyboardEvent, b: ThumbAction, phase: 'start' | 'end') {
    if (!b.hold || (e.key !== ' ' && e.key !== 'Enter')) return;
    e.preventDefault();
    e.stopPropagation();
    if (phase === 'start' && (e.repeat || holding)) return;
    if (phase === 'start') holding = { action: b.action, pointer: -1 };
    else if (holding?.pointer === -1) holding = null;
    else return;
    run(b.action, phase);
  }
</script>

<svelte:window onpointerup={release} onpointercancel={release} />

<div class="thumb-bar" role="toolbar" aria-label="Touch actions" data-testid="thumb-bar" style:--target="{TOUCH_TARGET_PX}px">
  {#each THUMB_BAR as b (b.action)}
    {@const k = keyOf(b.action)}
    {#if b.hold}
      <button
        type="button"
        class="hold"
        class:on={holding?.action === b.action || (b.action === 'talk' && talking)}
        data-testid="thumb-{b.action}"
        aria-pressed={holding?.action === b.action}
        title="{b.label}: hold{k ? ` (or hold ${k})` : ''}"
        onpointerdown={(e) => press(e, b)}
        onkeydown={(e) => key(e, b, 'start')}
        onkeyup={(e) => key(e, b, 'end')}
        oncontextmenu={(e) => e.preventDefault()}>{b.label}</button
      >
    {:else}
      <button
        type="button"
        class:waiting={b.action === 'resolve' && !resolveLit}
        data-testid="thumb-{b.action}"
        data-ready={b.action === 'resolve' ? String(resolveLit) : undefined}
        title={k ? `${b.label} (${k})` : b.label}
        onclick={() => run(b.action, 'start')}>{b.label}</button
      >
    {/if}
  {/each}
</div>

<style>
  .thumb-bar {
    display: flex;
    gap: 6px;
    pointer-events: auto;
    padding: 4px;
    background: color-mix(in srgb, var(--sp-surface, #fff) 85%, transparent);
    border: 1px solid var(--sp-border, #d8d8d8);
    border-radius: 999px;
    -webkit-user-select: none;
    user-select: none;
    -webkit-touch-callout: none;
  }
  button {
    min-width: calc(var(--target) + 20px);
    min-height: var(--target);
    padding: 0 14px;
    border-radius: 999px;
    border: 1px solid var(--sp-fg, #111);
    background: var(--sp-surface, #fff);
    color: var(--sp-fg, #111);
    font: 600 var(--sp-font-size, 14px) / 1 var(--sp-font, system-ui);
    cursor: pointer;
    touch-action: manipulation;
  }
  /* A Resolve that is not ready keeps full-contrast text (Paper meets WCAG AA throughout, M5 review): it is told apart
     by a dashed border and normal weight instead of being dimmed; a ready one keeps the solid border and bold label. */
  button.waiting {
    border-style: dashed;
    font-weight: 400;
  }
  button.hold.on {
    background: var(--sp-fg, #111);
    color: var(--sp-bg, #fff);
  }
</style>
