<!--
  A menu popover (PLAN Milestone 7, A1 and A8: one pattern for menus; docs/design/m7-hud-proposal.md, In the menu:
  "Grouped, with icons, keys shown on the right in muted type"). Arrow keys move through the items, Esc and a press
  outside close it, and focus returns to the button that opened it.
-->
<script lang="ts">
  import { onMount } from 'svelte';
  import Icon from './Icon.svelte';
  import type { MenuGroup } from './menu';

  import type { Snippet } from 'svelte';

  let {
    open = $bindable(true),
    anchor = null,
    groups,
    top = undefined,
    placement = 'auto',
    label,
    onclose = undefined,
    testid = 'menu-popover',
    autofocus = true,
  }: {
    open?: boolean;
    anchor?: HTMLElement | null;
    groups: MenuGroup[];
    /** A section above the groups (the plate menu's invitation); its argument closes the menu. */
    top?: Snippet<[() => void]> | undefined;
    placement?: 'above' | 'below' | 'auto';
    label: string;
    /** Seed: called when the menu closes itself. */
    onclose?: (() => void) | undefined;
    testid?: string;
    autofocus?: boolean;
  } = $props();
  function shut(): void {
    open = false;
    onclose?.();
  }
  let el = $state<HTMLElement | undefined>();

  function items(): HTMLButtonElement[] {
    return el ? [...el.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')] : [];
  }
  function close(): void {
    shut();
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
      shut();
    }
  }
  onMount(() => {
    if (autofocus) items()[0]?.focus({ preventScroll: true });
    const away = (e: PointerEvent): void => {
      const t = e.target as Node | null;
      if (el?.contains(t) || anchor?.contains(t)) return;
      shut();
    };
    window.addEventListener('pointerdown', away, true);
    return () => window.removeEventListener('pointerdown', away, true);
  });
</script>

{#if open}
<div bind:this={el} class="ds-pop ds-menu ds-menu--{placement}" role="menu" aria-label={label} data-testid={testid} tabindex="-1" onkeydown={key}>
  {#if top}<div class="ds-menu__top">{@render top(shut)}</div>{/if}
  {#each groups as g, gi (g.id ?? gi)}
    {#if g.items.length}
      <div class="ds-menu-group" role="group" aria-label={g.title ?? g.label} data-group={g.id}>
        {#if g.title ?? g.label}<span class="ds-label" aria-hidden="true">{g.title ?? g.label}</span>{/if}
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
                  shut();
                }
              : undefined}
            onclick={() => {
              if (!item.run) return;
              if (!item.keepOpen) shut();
              item.run();
            }}
            >{#if item.icon}<Icon name={item.icon} size={18} />{/if}<span>{item.label}</span>{#if item.hint ?? item.key}<span class="ds-key">{item.hint ?? item.key}</span>{/if}</button
          >
        {/each}
      </div>
    {/if}
  {/each}
</div>
{/if}

<style>
  [role='menu'] {
    max-height: calc(100vh - 80px);
    overflow-y: auto;
    box-sizing: border-box;
  }
</style>
