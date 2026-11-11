<!--
  Context menu (DESIGN "Input and interaction design": every action is reachable from a context menu, and context
  menus show the key beside each action).
-->
<script lang="ts">
  import type { MenuEntry } from './menu';

  let { title, entries, x, y, onclose }: { title: string; entries: MenuEntry[]; x: number; y: number; onclose: () => void } = $props();

  let el = $state<HTMLElement | undefined>();
  let pos = $state({ left: 0, top: 0 });

  $effect(() => {
    const w = el?.offsetWidth ?? 220;
    const h = el?.offsetHeight ?? 300;
    pos = { left: Math.max(4, Math.min(x, window.innerWidth - w - 4)), top: Math.max(4, Math.min(y, window.innerHeight - h - 4)) };
  });

  function outside(e: PointerEvent) {
    if (el && !el.contains(e.target as Node)) onclose();
  }
</script>

<svelte:window onpointerdown={outside} />

<div class="menu" role="menu" aria-label={title} data-testid="context-menu" bind:this={el} style:left="{pos.left}px" style:top="{pos.top}px">
  <div class="title">{title}</div>
  {#each entries as entry (entry.id)}
    <button
      type="button"
      role="menuitem"
      data-action={entry.id}
      onclick={() => {
        onclose();
        entry.run();
      }}
    >
      <span>{entry.label}</span>
      {#if entry.key}<kbd>{entry.key}</kbd>{/if}
    </button>
  {/each}
</div>

<style>
  .menu {
    position: fixed;
    z-index: 60;
    min-width: 220px;
    max-height: calc(100vh - 8px);
    overflow-y: auto;
    background: var(--sp-surface, #fff);
    color: var(--sp-fg, #111);
    border: 1px solid var(--sp-fg, #111);
    border-radius: var(--sp-radius-md, 4px);
    padding: var(--sp-space-xs, 2px) 0;
    font: var(--sp-font-size-small, 12px) / 1.4 var(--sp-font, system-ui);
    box-shadow: 0 2px 8px rgb(0 0 0 / 0.12);
  }
  .title {
    padding: 4px 10px;
    color: var(--sp-muted, #5f5f5f);
    font-variant: small-caps;
    letter-spacing: 0.04em;
    border-bottom: 1px solid var(--sp-border, #d8d8d8);
    margin-bottom: 2px;
  }
  button {
    display: flex;
    width: 100%;
    justify-content: space-between;
    gap: 16px;
    padding: 3px 10px;
    border: 0;
    background: none;
    color: inherit;
    font: inherit;
    text-align: left;
    cursor: pointer;
  }
  button:hover,
  button:focus-visible {
    background: var(--sp-fg, #111);
    color: var(--sp-bg, #fff);
    outline: none;
  }
  kbd {
    font-family: var(--sp-font-mono, monospace);
    color: inherit;
    opacity: 0.75;
  }
</style>
