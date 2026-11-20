<!-- Kit stub (contracts.md Part B) written by M8-P2 because M8-C's UI commit did not land; M8-P1's file replaces it. -->
<script lang="ts">
  import type { Snippet } from 'svelte';
  let { label, width = 'full', onclose = undefined, header = undefined, footer = undefined, children, ...rest }: { label: string; width?: 'full' | 'narrow'; onclose?: (() => void) | undefined; header?: Snippet | undefined; footer?: Snippet | undefined; children?: Snippet; [key: string]: unknown } = $props();
  function key(e: KeyboardEvent): void {
    if (e.key === 'Escape' && onclose) {
      e.stopPropagation();
      onclose();
    }
  }
</script>

<section class="ds-sheet ds-sheet--{width}" role="region" aria-label={label} onkeydown={key} {...rest}>
  {#if header}<header class="ds-sheet__head">{@render header()}</header>{/if}
  <div class="ds-sheet__body">{@render children?.()}</div>
  {#if footer}<footer class="ds-sheet__foot">{@render footer()}</footer>{/if}
</section>

<style>
  .ds-sheet { box-sizing: border-box; width: 100%; max-width: 1248px; margin: 0 auto; padding: 24px; border-radius: 20px; background: var(--ds-panel); color: var(--ds-ink); box-shadow: var(--ds-elevation-pop); display: flex; flex-direction: column; gap: 16px; }
  .ds-sheet--narrow { max-width: 448px; }
  .ds-sheet__head, .ds-sheet__foot { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
  .ds-sheet__foot { justify-content: flex-end; }
</style>
