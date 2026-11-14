<!--
  Context menu (DESIGN "Input and interaction design": every action is reachable from a context menu, and context
  menus show the key beside each action). Keyboard (WAI-ARIA menu pattern; M5-P4, DESIGN Accessibility: every card
  action is reachable from the keyboard): opened from the keyboard it focuses its first entry; Up and Down move
  (wrapping), Home and End go to the ends, Enter or Space runs the entry, Escape (the HUD's) and Tab close it, and on
  close focus returns to the element that had it (the table's accessible mirror).
-->
<script lang="ts">
  import { untrack } from 'svelte';
  import type { MenuEntry } from './menu';

  let {
    title,
    entries,
    x,
    y,
    autofocus = false,
    onclose,
  }: { title: string; entries: MenuEntry[]; x: number; y: number; /** Opened from the keyboard: focus the first entry. */ autofocus?: boolean; onclose: () => void } = $props();

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

  const items = (): HTMLElement[] => (el ? [...el.querySelectorAll<HTMLElement>('[role="menuitem"]')] : []);

  // Focus in on open (from the keyboard), back out on close.
  $effect(() => {
    const active = document.activeElement;
    const returnTo = active instanceof HTMLElement && active !== document.body ? active : null;
    if (untrack(() => autofocus)) items()[0]?.focus({ preventScroll: true });
    return () => {
      const now = document.activeElement;
      if (returnTo?.isConnected && (!now || now === document.body || (el?.contains(now) ?? false))) returnTo.focus({ preventScroll: true });
    };
  });

  /** Up, Down, Home and End move between entries; Tab closes. Handled here, so the table keys never see them. */
  function onkeydown(e: KeyboardEvent) {
    if (e.ctrlKey || e.altKey || e.metaKey) return;
    if (e.key === 'Tab') {
      e.preventDefault();
      e.stopPropagation();
      onclose();
      return;
    }
    const list = items();
    const n = list.length;
    if (n === 0) return;
    const i = list.indexOf(document.activeElement as HTMLElement);
    const next = e.key === 'ArrowDown' ? (i + 1) % n : e.key === 'ArrowUp' ? (i <= 0 ? n - 1 : i - 1) : e.key === 'Home' ? 0 : e.key === 'End' ? n - 1 : -1;
    if (next < 0) return;
    e.preventDefault();
    e.stopPropagation();
    list[next]!.focus({ preventScroll: true });
  }

  /** Arrow keys reach a menu opened with the mouse too: the first press moves focus into it. */
  function onwindowkeydown(e: KeyboardEvent) {
    if (e.defaultPrevented || e.ctrlKey || e.altKey || e.metaKey || !el || el.contains(document.activeElement)) return;
    const list = items();
    const target = e.key === 'ArrowDown' || e.key === 'Home' ? list[0] : e.key === 'ArrowUp' || e.key === 'End' ? list[list.length - 1] : undefined;
    if (!target) return;
    e.preventDefault();
    target.focus({ preventScroll: true });
  }
</script>

<svelte:window onpointerdown={outside} onkeydown={onwindowkeydown} />

<div
  class="menu"
  role="menu"
  tabindex="-1"
  aria-label={title}
  data-testid="context-menu"
  bind:this={el}
  style:left="{pos.left}px"
  style:top="{pos.top}px"
  {onkeydown}
  oncontextmenu={(e) => e.preventDefault()}
>
  <div class="title">{title}</div>
  {#each entries as entry (entry.id)}
    <button
      type="button"
      role="menuitem"
      tabindex="-1"
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
