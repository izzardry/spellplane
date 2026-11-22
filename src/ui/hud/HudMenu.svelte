<!--
  The HUD's menu popover (docs/design/m8/m7-adjustments.md, M7-P2 "Menu" and "Plate menu"; visual.md 2.8 "Pop / menu":
  rows 36 high, sections divided by a line, a key or value right in muted type). Built from the kit's classes
  (.ds-pop, .ds-menu, .ds-menu-group, .ds-menu-item) so it wears the look; the arrow keys move, Esc closes, a press
  outside closes. `top` renders above the groups (the shell's plate section) and receives the close callback.
-->
<script lang="ts">
  import { onMount, tick, type Snippet } from 'svelte';
  import Icon from '../design/Icon.svelte';
  import type { HudMenuGroup } from './menu-model';

  let {
    groups,
    label,
    onclose,
    anchor = null,
    testid = 'menu-popover',
    autofocus = true,
    top,
  }: {
    groups: readonly HudMenuGroup[];
    label: string;
    onclose: () => void;
    anchor?: HTMLElement | null;
    testid?: string;
    autofocus?: boolean;
    top?: Snippet<[() => void]> | undefined;
  } = $props();
  let el = $state<HTMLElement | undefined>();
  /**
   * A press that started a drag out of the menu (the paperclip): the menu hides at once but stays in the page until that
   * pointer is released, so the press's target is not removed under it and the drag's moves still reach the window.
   */
  let handing = $state(false);
  let handOff: (() => void) | null = null;
  function handOver(e: PointerEvent): void {
    handing = true;
    const pointer = e.pointerId;
    const end = (ev: PointerEvent): void => {
      if (ev.pointerId !== pointer) return;
      handOff?.();
      onclose();
    };
    handOff = () => {
      window.removeEventListener('pointerup', end, true);
      window.removeEventListener('pointercancel', end, true);
      handOff = null;
    };
    window.addEventListener('pointerup', end, true);
    window.addEventListener('pointercancel', end, true);
  }

  function items(): HTMLElement[] {
    return el ? [...el.querySelectorAll<HTMLElement>('[role="menuitem"]:not(:disabled), .sp-menu-top button:not(:disabled)')] : [];
  }
  function close(): void {
    onclose();
    anchor?.focus({ preventScroll: true });
  }
  function key(e: KeyboardEvent): void {
    const list = items();
    const i = list.indexOf(document.activeElement as HTMLElement);
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const step = e.key === 'ArrowDown' ? 1 : -1;
      list[(i + step + list.length) % list.length]?.focus();
    } else if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault();
      list[e.key === 'Home' ? 0 : list.length - 1]?.focus();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      close();
    } else if (e.key === 'Tab') {
      onclose();
    }
  }
  /**
   * Keep the whole menu inside the window (gate M8 finding F11: at 900 px height it ran past the bottom): measured once
   * when it opens and when its content grows, it shrinks to the room left below its top (or above its bottom, when it
   * opens upward) and scrolls.
   */
  /**
   * The table's Menu set in two columns of groups when one column would not fit the window's height (gate M8 finding
   * N10: at 900 px "Settings…" was cut and had to be scrolled to); a narrow window keeps one scrolling column.
   */
  let columns = $state(false);
  function fit(): void {
    if (!el || typeof window === 'undefined') return;
    const r = el.getBoundingClientRect();
    const margin = 8;
    if (!top && !columns && window.innerWidth >= 720 && el.scrollHeight > window.innerHeight - margin - Math.max(margin, r.top)) {
      columns = true;
      el.style.maxHeight = '';
      void tick().then(fit);
      return;
    }
    if (r.bottom > window.innerHeight - margin) el.style.maxHeight = `${Math.max(120, window.innerHeight - margin - Math.max(margin, r.top))}px`;
    else if (r.top < margin) el.style.maxHeight = `${Math.max(120, r.bottom - margin)}px`;
  }
  onMount(() => {
    fit();
    // Content that grows after it opened (the plate menu's BRING BACK link and QR code) is fitted again.
    const grow = typeof ResizeObserver === 'function' ? new ResizeObserver(() => fit()) : null;
    if (el) grow?.observe(el);
    if (autofocus) el?.querySelector<HTMLElement>('[role="menuitem"]:not(:disabled)')?.focus({ preventScroll: true });
    const away = (e: PointerEvent): void => {
      const t = e.target as Node | null;
      if (el?.contains(t) || anchor?.contains(t)) return;
      onclose();
    };
    window.addEventListener('pointerdown', away, true);
    return () => {
      grow?.disconnect();
      window.removeEventListener('pointerdown', away, true);
      handOff?.();
    };
  });
  const shown = $derived(groups.filter((g) => g.items.length));
  /** The groups in two columns: the first takes whole groups until it holds about half of the rows. */
  const halves = $derived.by((): [HudMenuGroup[], HudMenuGroup[]] => {
    const rows = (g: HudMenuGroup): number => g.items.length + (g.label ? 1 : 0);
    const total = shown.reduce((n, g) => n + rows(g), 0);
    const first: HudMenuGroup[] = [];
    let n = 0;
    for (const g of shown) {
      if (first.length && n + rows(g) / 2 > total / 2) break;
      first.push(g);
      n += rows(g);
    }
    return [first, shown.slice(first.length)];
  });
</script>

<div bind:this={el} class="ds-pop ds-menu sp-menu" class:sp-handing={handing} class:sp-columns={columns} data-columns={columns ? '2' : '1'} role="menu" aria-label={label} data-testid={testid} tabindex="-1" onkeydown={key}>
  {#if top}
    <div class="sp-menu-top" data-testid="menu-top-slot">{@render top(onclose)}</div>
    {#if shown.length}<div class="sp-menu-divider" role="separator"></div>{/if}
  {/if}
  {#snippet group(g: HudMenuGroup)}
    <div class="ds-menu-group" role="group" aria-label={g.label ?? label} data-group={g.id}>
      {#if g.label}<span class="ds-label" aria-hidden="true">{g.label}</span>{/if}
      {#each g.items as item (item.id)}
        <button
          type="button"
          role="menuitem"
          class="ds-menu-item sp-h-sm"
          class:ds-danger={item.danger}
          data-item={item.id}
          data-testid={item.testid}
          disabled={item.disabled}
          title={item.title}
          onpointerdown={item.onpointerdown
            ? (e) => {
                item.onpointerdown?.(e);
                handOver(e);
              }
            : undefined}
          onclick={() => {
            if (!item.run) return;
            if (!item.keepOpen) onclose();
            item.run();
          }}
          >{#if item.icon}<Icon name={item.icon} size={18} />{/if}<span>{item.label}</span>{#if item.key}<span class="ds-key">{item.key}</span>{:else if item.hint}<span class="ds-key">{item.hint}</span>{/if}</button
        >
      {/each}
    </div>
  {/snippet}
  {#if columns}
    <!-- Two columns of whole groups, balanced by their rows; each column starts without a divider. -->
    <div class="sp-cols">
      {#each halves as half, ci (ci)}
        <div class="sp-col">
          {#each half as g (g.id)}{@render group(g)}{/each}
        </div>
      {/each}
    </div>
  {:else}
    {#each shown as g (g.id)}{@render group(g)}{/each}
  {/if}
</div>

<style>
  .sp-handing {
    visibility: hidden;
  }
  .sp-menu {
    max-height: calc(100vh - 80px);
    overflow-y: auto;
    box-sizing: border-box;
    contain: layout paint;
  }
  .sp-menu.sp-columns {
    width: min(600px, calc(100vw - 2 * var(--ds-edge, 16px)));
    max-width: none;
  }
  .sp-cols {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    gap: var(--ds-space-sm);
    align-items: start;
  }
  .sp-col {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  .sp-menu-top {
    display: grid;
    gap: var(--ds-space-xs);
    padding: var(--ds-space-xs);
  }
  .sp-menu-divider {
    height: 1px;
    margin: var(--ds-space-xs) var(--ds-space-md);
    background: var(--ds-line);
  }
</style>
