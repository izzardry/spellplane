<!--
  The colour split of a deck (docs/design/m8/contracts.md Part B; visual.md 2.8 "Colour bar"): one bar split by mana
  symbol count, and per colour a pip, the count and the number of sources. Plain markup by M8-C; M8-P1 gives it its look.
-->
<script lang="ts">
  import Pip from './Pip.svelte';

  type C = 'W' | 'U' | 'B' | 'R' | 'G';
  let { symbols, sources = undefined, ...rest }: { symbols: Partial<Record<C, number>>; sources?: Partial<Record<C, number>> | undefined; [attr: string]: unknown } = $props();
  const parts = $derived((['W', 'U', 'B', 'R', 'G'] as const).filter((c) => (symbols[c] ?? 0) > 0).map((c) => ({ c, n: symbols[c] ?? 0, s: sources?.[c] })));
  const total = $derived(parts.reduce((a, p) => a + p.n, 0) || 1);
</script>

<div class="ds-colourbar" {...rest}>
  <div class="ds-cbar" aria-hidden="true">{#each parts as p (p.c)}<i class="ds-cbar__item" style:flex-grow={p.n / total} style:background="var(--ds-mana-{p.c.toLowerCase()})"></i>{/each}</div>
  <ul class="ds-cbar__legend">
    {#each parts as p (p.c)}<li><Pip colour={p.c} /> {p.n}{#if p.s !== undefined} · {p.s} sources{/if}</li>{/each}
  </ul>
</div>
