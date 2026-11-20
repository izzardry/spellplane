<!--
  The colour bar (docs/design/m8/contracts.md Part B; visual.md 2.8): one 8 px bar split by mana symbol count in the
  identity colours, and under it per colour a lettered pip, the symbol count and the number of sources. Added by M8-P1.
-->
<script lang="ts">
  import './kit';
  import Pip from './Pip.svelte';
  import type { ManaColour } from './types';

  const ORDER: ManaColour[] = ['W', 'U', 'B', 'R', 'G'];
  let { symbols, sources = undefined, ...rest }: { symbols: Partial<Record<ManaColour, number>>; sources?: Partial<Record<ManaColour, number>> | undefined; [attr: string]: unknown } = $props();
  const parts = $derived(ORDER.filter((c) => (symbols[c] ?? 0) > 0));
  const total = $derived(parts.reduce((s, c) => s + (symbols[c] ?? 0), 0));
</script>

<div class="ds-colourbar" {...rest}>
  <div class="ds-cbar" aria-hidden="true">
    {#each parts as c (c)}<span style:flex-grow={symbols[c] ?? 0} style:background="var(--ds-mana-{c.toLowerCase()})"></span>{/each}
  </div>
  <div class="ds-cbar__legend">
    {#each parts as c (c)}
      <span class="ds-cbar__item" data-colour={c}><Pip colour={c} size={14} /><span>{symbols[c]} {(symbols[c] ?? 0) === 1 ? 'symbol' : 'symbols'}{#if sources} · {sources[c] ?? 0} {(sources[c] ?? 0) === 1 ? 'source' : 'sources'}{/if}</span></span>
    {/each}
    {#if total === 0}<span>No coloured symbols</span>{/if}
  </div>
</div>
