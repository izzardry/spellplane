<!--
  An icon button (PLAN Milestone 7, A1): an icon with a visible label, or the icon alone with the label as its
  accessible name and tooltip. `key` adds the shortcut to the tooltip only (docs/design/m7-hud-proposal.md: "Keys show
  in tooltips, menus and the gesture sheet, never as text on everyday buttons").
-->
<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { HTMLButtonAttributes } from 'svelte/elements';
  import Icon from './Icon.svelte';
  import type { IconName } from './icons';

  let {
    icon,
    label,
    showLabel = false,
    key = null,
    variant = 'secondary',
    badge = null,
    children,
    class: extra = '',
    ...rest
  }: HTMLButtonAttributes & { icon: IconName; label: string; showLabel?: boolean; key?: string | null; variant?: 'secondary' | 'quiet'; badge?: number | null; children?: Snippet } = $props();
  const tip = $derived(key ? `${label} (${key})` : label);
</script>

<button type="button" class="ds-btn ds-btn--{variant} ds-icon-btn {extra}" class:ds-icon-only={!showLabel} aria-label={showLabel ? undefined : label} title={tip} {...rest}
  ><Icon name={icon} />{#if showLabel}<span>{label}</span>{/if}{#if badge}<span class="ds-badge" aria-label="{badge} new">{badge}</span>{/if}{@render children?.()}</button
>
