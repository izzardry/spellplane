<!-- Kit stub (contracts.md Part B) written by M8-P2 because M8-C's UI commit did not land; M8-P1's file replaces it. -->
<script lang="ts">
  import type { Snippet } from 'svelte';
  let { count = 6, children, ...rest }: { count?: number; children?: Snippet; [key: string]: unknown } = $props();
  const edges = $derived(Math.max(0, Math.min(60, count)));
</script>

<div class="ds-pile" style:--edges={Math.min(edges, 8)} {...rest}>
  {#each Array.from({ length: Math.min(edges, 8) }) as _, i (i)}<span class="ds-pile__edge" style:transform="translate({(i + 1) * 1}px, {(i + 1) * 2}px)"></span>{/each}
  <div class="ds-pile__top">{@render children?.()}</div>
</div>

<style>
  .ds-pile { position: relative; display: inline-block; }
  .ds-pile__edge { position: absolute; inset: 0; border-radius: 10px; background: var(--ds-panel); box-shadow: inset 0 0 0 1px var(--ds-line); }
  .ds-pile__top { position: relative; }
</style>
