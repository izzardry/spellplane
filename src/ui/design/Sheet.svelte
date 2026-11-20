<!--
  A sheet (docs/design/m8/contracts.md Part B; visual.md 2.8): paper (`panel`) with grain, the `sheet` elevation,
  radius `sheet`, padding 24; it rises 16 px and fades in. `width: 'narrow'` is the 336 px side sheet. A round close
  button when `onclose` is given; Escape closes it too. Added by M8-P1.
-->
<script lang="ts">
  import './kit';
  import type { Snippet } from 'svelte';
  import IconButton from './IconButton.svelte';

  let {
    label,
    width = 'full',
    onclose = undefined,
    header = undefined,
    footer = undefined,
    children,
    class: extra = '',
    ...rest
  }: {
    label: string;
    width?: 'full' | 'narrow';
    onclose?: (() => void) | undefined;
    header?: Snippet | undefined;
    footer?: Snippet | undefined;
    children?: Snippet;
    /** Extra classes on the root (placement in a parent's grid). */ // [M8-P1]
    class?: string;
    [attr: string]: unknown;
  } = $props();
</script>

<section
  class="ds-sheet ds-root {extra}"
  class:ds-sheet--narrow={width === 'narrow'}
  aria-label={label}
  data-ds-layer="sheet"
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
      <div class="ds-sheet__title">{#if header}{@render header()}{/if}</div>
      {#if onclose}<IconButton label="Close" icon="close" size="sm" variant="quiet" onclick={onclose} />{/if}
    </div>
  {/if}
  {@render children?.()}
  {#if footer}<div class="ds-sheet__foot ds-row">{@render footer()}</div>{/if}
</section>
