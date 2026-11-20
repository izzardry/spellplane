<!--
  A menu popover (docs/design/m8/contracts.md Part B; visual.md 2.8 "Pop / menu"): white, radius `panel`, `pop`;
  groups of rows 36 px high with an eyebrow each, a value or key right in muted type; an optional `top` section
  (the plate menu's invitation) above them. Opens below or above its anchor (`placement`), clamped to the window.
  Arrow keys, Home and End move through the items; Tab stays inside; Escape and a press outside close it and focus
  returns to the anchor. `open` is bindable; the seed's `onclose`, `testid` and `autofocus` stay. Rewritten by M8-P1.
-->
<script lang="ts">
  import './kit';
  import { tick, type Snippet } from 'svelte';
  import Icon from './Icon.svelte';
  import { popoverPlace, type MenuGroup } from './menu';

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
    top?: Snippet<[() => void]> | undefined;
    placement?: 'above' | 'below' | 'auto';
    label: string;
    onclose?: (() => void) | undefined;
    testid?: string;
    autofocus?: boolean;
  } = $props();
  let el = $state<HTMLElement | undefined>();
  let pos = $state<{ left: number; top: number; side: 'above' | 'below' } | null>(null);

  function focusables(): HTMLElement[] {
    return el ? [...el.querySelectorAll<HTMLElement>('button:not(:disabled), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')] : [];
  }
  function items(): HTMLButtonElement[] {
    return el ? [...el.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')] : [];
  }
  function close(refocus = true): void {
    if (!open) return;
    // Read the anchor before `onclose`: the owner may drop the state its `anchor` prop is read from (Library's
    // `menu = null`), and reading the prop afterwards would throw before the chosen item runs.
    const at = anchor;
    open = false;
    onclose?.();
    if (refocus && at) {
      // The anchor may be a wrapper around the button that opened the menu: focus that button.
      const sel = 'button:not(:disabled), [href], [tabindex]:not([tabindex="-1"])';
      const back = at.matches(sel) ? at : (at.querySelector<HTMLElement>(sel) ?? at);
      back.focus({ preventScroll: true });
    }
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
      // Focus stays inside the popover (visual.md 2.12).
      const all = focusables();
      if (!all.length) return;
      const at = all.indexOf(document.activeElement as HTMLElement);
      e.preventDefault();
      all[(at + (e.shiftKey ? -1 : 1) + all.length) % all.length]?.focus();
    }
  }
  function place(): void {
    if (!el || !anchor) {
      pos = null;
      return;
    }
    const r = anchor.getBoundingClientRect();
    pos = popoverPlace(r, { width: el.offsetWidth, height: el.offsetHeight }, { width: window.innerWidth, height: window.innerHeight }, placement);
  }

  $effect(() => {
    if (!open || !el) return;
    void tick()
      .then(() => {
        place();
        // The popover is hidden until it is placed: focus after the placed state reached the DOM.
        return tick();
      })
      .then(() => {
        if (autofocus && open) (items()[0] ?? focusables()[0])?.focus({ preventScroll: true });
      });
    const away = (e: PointerEvent): void => {
      const t = e.target as Node | null;
      if (el?.contains(t) || anchor?.contains(t)) return;
      close(false);
    };
    const resize = (): void => place();
    window.addEventListener('pointerdown', away, true);
    window.addEventListener('resize', resize);
    // An ancestor that was animating in (a sheet rises 16 px) moved the anchor: place again once it has settled.
    window.addEventListener('animationend', resize, true);
    return () => {
      window.removeEventListener('animationend', resize, true);
      window.removeEventListener('pointerdown', away, true);
      window.removeEventListener('resize', resize);
    };
  });
</script>

{#if open}
  <div
    bind:this={el}
    class="ds-pop ds-menu"
    class:ds-menu--inline={!anchor}
    role="menu"
    aria-label={label}
    data-testid={testid}
    data-ds-layer="popover"
    data-side={pos?.side}
    tabindex="-1"
    style:left={pos ? `${pos.left}px` : undefined}
    style:top={pos ? `${pos.top}px` : undefined}
    style:visibility={anchor && !pos ? 'hidden' : undefined}
    onkeydown={key}
  >
    {#if top}<div class="ds-menu__top">{@render top(() => close())}</div>{/if}
    {#each groups as g, gi (g.id ?? gi)}
      {#if g.items.length}
        {@const eyebrow = g.title ?? g.label}
        <div class="ds-menu-group" role="group" aria-label={eyebrow} data-group={g.id ?? gi}>
          {#if eyebrow}<span class="ds-label" aria-hidden="true">{eyebrow}</span>{/if}
          {#each g.items as item (item.id)}
            {@const right = item.hint ?? item.key}
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
                    close(false);
                  }
                : undefined}
              onclick={() => {
                if (!item.run) return;
                if (!item.keepOpen) close();
                item.run();
              }}
              >{#if item.icon}<Icon name={item.icon} size={16} />{/if}<span>{item.label}</span>{#if right}<span class="ds-key">{right}</span>{/if}</button
            >
          {/each}
        </div>
      {/if}
    {/each}
  </div>
{/if}
