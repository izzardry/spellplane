<!-- Kit stub (contracts.md Part B) written by M8-P2 because M8-C's UI commit did not land; M8-P1's file replaces it. -->
<script lang="ts">
  let { cards, width = 200, label, ...rest }: { cards: { src: string | null; alt: string }[]; width?: number; label: string; [key: string]: unknown } = $props();
  const shown = $derived(cards.slice(0, 5));
  const angle = [0, -7, 7, -14, 14];
  const drop = [0, 3, 3, 10, 10];
</script>

<div class="ds-fan" role="img" aria-label={label} style:width="{width * 1.6}px" style:height="{Math.round(width * 88 / 63) + 24}px" {...rest}>
  {#each [...shown.keys()].reverse() as i (i)}
    {@const c = shown[i]!}
    <span class="ds-fan__card" style:width="{width}px" style:height="{Math.round(width * 88 / 63)}px" style:transform="translateX(-50%) rotate({angle[i]}deg) translateY({drop[i]}px)" style:z-index={10 - i}>
      {#if c.src}<img src={c.src} alt={c.alt} draggable="false" />{:else}<span class="ds-fan__back"></span>{/if}
    </span>
  {/each}
</div>

<style>
  .ds-fan { position: relative; }
  .ds-fan__card { position: absolute; left: 50%; top: 0; transform-origin: 50% 120%; border-radius: 4.75%/3.4%; overflow: hidden; box-shadow: var(--ds-elevation-card); background: var(--ds-chip); }
  .ds-fan__card img { display: block; width: 100%; height: 100%; object-fit: contain; }
  .ds-fan__back { display: block; width: 100%; height: 100%; background: var(--ds-ink); }
</style>
