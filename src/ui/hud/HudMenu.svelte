<!--
  The HUD's menu popover (docs/design/m8/m7-adjustments.md, M7-P2 "Menu" and "Plate menu"; visual.md 2.8 "Pop / menu":
  rows 36 high, sections divided by a line, a key or value right in muted type). Built from the kit's classes
  (.ds-pop, .ds-menu, .ds-menu-group, .ds-menu-item) so it wears the look; the arrow keys move, Esc closes, a press
  outside closes. `top` renders above the groups (the shell's plate section) and receives the close callback.
-->
<script lang="ts">
  import { onMount, type Snippet } from 'svelte';
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
  onMount(() => {
    if (autofocus) el?.querySelector<HTMLElement>('[role="menuitem"]:not(:disabled)')?.focus({ preventScroll: true });
    const away = (e: PointerEvent): void => {
      const t = e.target as Node | null;
      if (el?.contains(t) || anchor?.contains(t)) return;
      onclose();
    };
    window.addEventListener('pointerdown', away, true);
    return () => window.removeEventListener('pointerdown', away, true);
  });
  const shown = $derived(groups.filter((g) => g.items.length));
</script>

<div bind:this={el} class="ds-pop ds-menu sp-menu" role="menu" aria-label={label} data-testid={testid} tabindex="-1" onkeydown={key}>
  {#if top}
    <div class="sp-menu-top" data-testid="menu-top-slot">{@render top(onclose)}</div>
    {#if shown.length}<div class="sp-menu-divider" role="separator"></div>{/if}
  {/if}
  {#each shown as g (g.id)}
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
                onclose();
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
  {/each}
</div>

<style>
  .sp-menu {
    max-height: calc(100vh - 80px);
    overflow-y: auto;
    box-sizing: border-box;
    contain: layout paint;
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
