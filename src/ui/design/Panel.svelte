<!--
  A panel (docs/design/m8/contracts.md Part B; visual.md V6, O-1): eyebrow, title with icon actions at its right, body,
  footer (actions right-aligned, the primary last). Padding 24, blocks 16 apart. The seed's `pop` (a floating panel)
  stays. Rewritten by M8-P1.
-->
<script lang="ts">
  import './kit';
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
  }: { eyebrow?: string | undefined; title?: string | undefined; actions?: Snippet | undefined; footer?: Snippet | undefined; pop?: boolean; children?: Snippet; class?: string; [attr: string]: unknown } = $props();
</script>

<div class="{pop ? 'ds-pop ds-panel ds-panel--pop' : 'ds-panel'} {extra}" {...rest}>
  {#if eyebrow || title || actions}
    <div class="ds-panel__head">
      <div class="ds-panel__titles">
        {#if eyebrow}<span class="ds-t-eyebrow">{eyebrow}</span>{/if}
        {#if title}<h2 class="ds-t-title">{title}</h2>{/if}
      </div>
      {#if actions}<div class="ds-row">{@render actions()}</div>{/if}
    </div>
  {/if}
  {@render children?.()}
  {#if footer}<div class="ds-panel__foot ds-row">{@render footer()}</div>{/if}
</div>
