<!--
  A fan of whole cards (docs/design/m8/contracts.md Part B; visual.md 2.8 "Deck hero"): front card first, at most
  five; a missing face shows a card back. Faces keep 63:88 and are never cropped, dimmed or recoloured. Plain markup by
  M8-C; M8-P1 gives it its look.
-->
<script lang="ts">
  let { cards, width = 200, label, ...rest }: { cards: { src: string | null; alt: string }[]; width?: number; label: string; [attr: string]: unknown } = $props();
  // The front card is drawn last so it lies on top.
  const shown = $derived(cards.slice(0, 5).reverse());
</script>

<div class="ds-fan" role="img" aria-label={label} style:--w="{width}px" {...rest}>
  {#each shown as c, i (i)}
    {#if c.src}
      <img class="ds-card" src={c.src} alt={c.alt} width={width} height={Math.round((width * 88) / 63)} draggable="false" />
    {:else}
      <span class="ds-card ds-card--back" style:width="{width}px" style:height="{Math.round((width * 88) / 63)}px" aria-hidden="true"></span>
    {/if}
  {/each}
</div>
