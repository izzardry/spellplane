<!--
  A button of the design system (PLAN Milestone 7, A1): `primary` is the one filled button on screen (the next move),
  `secondary` the resting default, `quiet` a flat one inside panels. Keys never show on it; a tooltip may name one.
-->
<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { HTMLButtonAttributes } from 'svelte/elements';

  let {
    variant = 'secondary',
    small = false,
    children,
    class: extra = '',
    type = 'button',
    ...rest
  }: HTMLButtonAttributes & { variant?: 'primary' | 'secondary' | 'quiet'; small?: boolean; children?: Snippet } = $props();
</script>

<button {type} class="ds-btn ds-btn--{variant} {extra}" class:ds-btn--small={small} {...rest}>{@render children?.()}</button>
