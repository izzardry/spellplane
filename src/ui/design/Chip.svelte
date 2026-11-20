<!--
  A chip of the kit (docs/design/m8/contracts.md Part B; visual.md 2.8): 28 high (`sm` 36, a filter chip), `fill`,
  `line` (off) or `on` (ink). With `onclick` it is a toggle button. The seed's `icon` stays optional. Plain markup by
  M8-C; M8-P1 gives it its look.
-->
<script lang="ts">
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
  const cls = $derived(`ds-chip ds-chip--${variant}${size === 'sm' ? ' ds-chip--sm' : ''} ${extra}`.trim());
</script>

{#if onclick}
  <button type="button" class="{cls} ds-chip--button" aria-pressed={pressed} {onclick} {...rest}>{#if icon}<Icon name={icon} size={14} />{/if}{@render children?.()}</button>
{:else}
  <span class={cls} {...rest}>{#if icon}<Icon name={icon} size={14} />{/if}{@render children?.()}</span>
{/if}
