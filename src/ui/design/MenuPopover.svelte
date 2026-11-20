<!--
  A menu popover (PLAN Milestone 7, A1 and A8: one pattern for menus; docs/design/m7-hud-proposal.md, In the menu:
  "Grouped, with icons, keys shown on the right in muted type"). Arrow keys move through the items, Esc and a press
  outside close it, and focus returns to the button that opened it.
-->
<script lang="ts">
  import { onMount } from 'svelte';
  import Icon from './Icon.svelte';
  import type { MenuGroup } from './menu';

  let { groups, label, onclose, anchor = null, testid = 'menu-popover', autofocus = true }: { groups: MenuGroup[]; label: string; onclose: () => void; anchor?: HTMLElement | null; testid?: string; autofocus?: boolean } = $props();
  let el = $state<HTMLElement | undefined>();

  function items(): HTMLButtonElement[] {
    return el ? [...el.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')] : [];
  }
  function close(): void {
    onclose();
    anchor?.focus({ preventScroll: true });
  }
  function key(e: KeyboardEvent): void {
    const list = items();
    const i = list.indexOf(document.activeElement as HTMLButtonElement);
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
    if (autofocus) items()[0]?.focus({ preventScroll: true });
    const away = (e: PointerEvent): void => {
      const t = e.target as Node | null;
      if (el?.contains(t) || anchor?.contains(t)) return;
      onclose();
    };
    window.addEventListener('pointerdown', away, true);
    return () => window.removeEventListener('pointerdown', away, true);
  });
</script>

<div bind:this={el} class="ds-pop ds-menu" role="menu" aria-label={label} data-testid={testid} tabindex="-1" onkeydown={key}>
  {#each groups as g (g.id)}
    {#if g.items.length}
      <div class="ds-menu-group" role="group" aria-label={g.label} data-group={g.id}>
        <span class="ds-label" aria-hidden="true">{g.label}</span>
        {#each g.items as item (item.id)}
          <button
            type="button"
            role="menuitem"
            class="ds-menu-item"
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
            >{#if item.icon}<Icon name={item.icon} size={18} />{/if}<span>{item.label}</span>{#if item.key}<span class="ds-key">{item.key}</span>{/if}</button
          >
        {/each}
      </div>
    {/if}
  {/each}
</div>

<style>
  [role='menu'] {
    max-height: calc(100vh - 80px);
    overflow-y: auto;
    box-sizing: border-box;
  }
</style>
