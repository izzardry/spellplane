<!--
  A sheet of the kit (docs/design/m8/contracts.md Part B; visual.md 2.8): the shell's large surface, labelled, with an
  optional header and footer; `onclose` adds a close button and Esc. Plain markup by M8-C; M8-P1 gives it its look.
-->
<script lang="ts">
  import type { Snippet } from 'svelte';

  let {
    label,
    width = 'full',
    onclose = undefined,
    header = undefined,
    footer = undefined,
    children,
    ...rest
  }: {
    label: string;
    width?: 'full' | 'narrow';
    onclose?: (() => void) | undefined;
    header?: Snippet | undefined;
    footer?: Snippet | undefined;
    children?: Snippet;
    [attr: string]: unknown;
  } = $props();
</script>

<section
  class="ds-sheet"
  class:ds-sheet--narrow={width === 'narrow'}
  aria-label={label}
  onkeydown={(e) => {
    if (e.key === 'Escape' && onclose) {
      e.stopPropagation();
      onclose();
    }
  }}
  {...rest}
>
  {#if header || onclose}
    <div class="ds-sheet__head">
      {#if header}{@render header()}{/if}
      {#if onclose}<button type="button" class="ds-btn ds-btn--quiet ds-btn--sm ds-icon-btn ds-icon-only" aria-label="Close" title="Close" onclick={onclose}>×</button>{/if}
    </div>
  {/if}
  {@render children?.()}
  {#if footer}<div class="ds-sheet__foot">{@render footer()}</div>{/if}
</section>
