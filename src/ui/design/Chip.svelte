<!--
  A chip (docs/design/m8/contracts.md Part B; visual.md 2.8): 28 px (36 as a filter chip, `size: 'sm'`), `fill` on the
  chip colour, `line` outlined and muted (off), `on` in ink. With `onclick` it is a toggle button (`pressed`). The seed's
  `icon` name stays. Rewritten by M8-P1.
-->
<script lang="ts">
  import './kit';
  import type { Snippet } from 'svelte';
  import Icon from './Icon.svelte';
  import type { IconName } from './icons';

  let {
    variant = 'fill',
    size = 'xs',
    onclick = undefined,
    pressed = undefined,
    icon = null,
    children,
    class: extra = '',
    ...rest
  }: {
    variant?: 'fill' | 'line' | 'on';
    size?: 'xs' | 'sm';
    onclick?: ((e: MouseEvent) => void) | undefined;
    pressed?: boolean | undefined;
    icon?: IconName | null;
    children?: Snippet;
    class?: string;
    [attr: string]: unknown;
  } = $props();
  const cls = $derived(`ds-chip ds-chip--${variant} ds-chip--${size} ${extra}`.trim());
</script>

{#if onclick}
  <button type="button" class="{cls} ds-chip--button" aria-pressed={pressed} {onclick} {...rest}>{#if icon}<Icon name={icon} size={14} />{/if}{@render children?.()}</button>
{:else}
  <span class={cls} {...rest}>{#if icon}<Icon name={icon} size={14} />{/if}{@render children?.()}</span>
{/if}
