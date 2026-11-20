<!-- Kit stub (contracts.md Part B) written by M8-P2 because M8-C's UI commit did not land; M8-P1's file replaces it. -->
<script lang="ts">
  let { band, score = undefined, label = undefined, ...rest }: { band: 1 | 2 | 3 | 4 | 5 | null; score?: number | undefined; label?: string | undefined; [key: string]: unknown } = $props();
</script>

<span class="ds-str" role="img" aria-label={label ?? (band === null ? 'Strength not known yet' : `Strength ${band} of 5${score !== undefined ? `, ${score}` : ''}`)} title="Used to find opponents with comparable decks." {...rest}>
  {#each [1, 2, 3, 4, 5] as k (k)}<b class:o={band === null || k > band}></b>{/each}
</span>

<style>
  .ds-str { display: inline-flex; gap: 3px; align-items: center; }
  .ds-str b { width: 8px; height: 8px; transform: rotate(45deg); background: var(--ds-ink); }
  .ds-str b.o { background: transparent; box-shadow: inset 0 0 0 1px var(--ds-muted); }
</style>
