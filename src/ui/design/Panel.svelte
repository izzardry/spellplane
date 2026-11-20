<!--
  A panel of the kit (docs/design/m8/contracts.md Part B; visual.md 2.8): slots `eyebrow`, `title`, `actions`, body,
  `footer`. The seed's `pop` (a popover surface) stays optional. Plain markup by M8-C; M8-P1 gives it its look.
-->
<script lang="ts">
  import type { Snippet } from 'svelte';

  let {
    eyebrow = undefined,
    title = undefined,
    actions = undefined,
    footer = undefined,
    pop = false,
    children,
    class: extra = '',
    ...rest
  }: {
    eyebrow?: string | undefined;
    title?: string | undefined;
    actions?: Snippet | undefined;
    footer?: Snippet | undefined;
    pop?: boolean;
    children?: Snippet;
    class?: string;
    [attr: string]: unknown;
  } = $props();
</script>

<div class="{pop ? 'ds-pop' : 'ds-panel'} {extra}" {...rest}>
  {#if eyebrow || title || actions}
    <div class="ds-panel__head">
      <div class="ds-panel__titles">
        {#if eyebrow}<span class="ds-t-eyebrow">{eyebrow}</span>{/if}
        {#if title}<h2 class="ds-t-title">{title}</h2>{/if}
      </div>
      {#if actions}{@render actions()}{/if}
    </div>
  {/if}
  {@render children?.()}
  {#if footer}<div class="ds-panel__foot">{@render footer()}</div>{/if}
</div>
