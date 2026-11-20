<!--
  A round icon button of the kit (docs/design/m8/contracts.md Part B; visual.md 2.8): `label` is its accessible name
  and tooltip, children (or the seed's `icon`) the icon. The seed's `icon`, `showLabel`, `key`, `badge` and `small`
  stay optional. Plain markup by M8-C; M8-P1 gives it its look.
-->
<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { HTMLButtonAttributes } from 'svelte/elements';
  import Icon from './Icon.svelte';
  import type { IconName } from './icons';
  import type { ButtonVariant, Size } from './types';

  let {
    label,
    size = undefined,
    small = false,
    variant = 'secondary',
    pressed = undefined,
    disabled = false,
    onclick = undefined,
    icon = undefined,
    showLabel = false,
    key = null,
    badge = null,
    children,
    class: extra = '',
    ...rest
  }: Omit<HTMLButtonAttributes, 'onclick'> & {
    label: string;
    size?: Size | undefined;
    small?: boolean;
    variant?: ButtonVariant;
    pressed?: boolean | undefined;
    disabled?: boolean | null | undefined;
    onclick?: ((e: MouseEvent) => void) | null | undefined;
    icon?: IconName | undefined;
    showLabel?: boolean;
    key?: string | null;
    badge?: number | null;
    children?: Snippet;
  } = $props();
  const s = $derived<Size>(size ?? (small ? 'xs' : 'md'));
  const tip = $derived(key ? `${label} (${key})` : label);
</script>

<button
  type="button"
  class="ds-btn ds-btn--{variant} ds-btn--{s} ds-icon-btn {extra}"
  class:ds-icon-only={!showLabel}
  class:is-pressed={pressed}
  aria-label={showLabel ? undefined : label}
  aria-pressed={pressed}
  title={tip}
  disabled={disabled || undefined}
  onclick={onclick ?? undefined}
  {...rest}
  >{#if icon}<Icon name={icon} />{/if}{@render children?.()}{#if showLabel}<span>{label}</span>{/if}{#if badge}<span class="ds-badge" aria-label="{badge} new">{badge}</span>{/if}</button
>
