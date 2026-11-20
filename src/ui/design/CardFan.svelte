<!--
  A fan of whole cards (docs/design/m8/contracts.md Part B; visual.md V13, 2.8 "Deck hero"): the front card upright on
  a pile, two cards at ±7° (3 px lower) and two at ±14° (10 px lower), on one pivot 20 % below the cards. Faces are
  only scaled and rotated, never cropped. At most five; a missing face is our own back. Added by M8-P1.
-->
<script lang="ts">
  import './kit';
  import CardImage from './CardImage.svelte';

  let { cards, width = 200, label, ...rest }: { cards: { src: string | null; alt: string }[]; width?: number; label: string; [attr: string]: unknown } = $props();
  const shown = $derived(cards.slice(0, 5));
  const h = $derived((width * 88) / 63);
  // Back cards first in the DOM, so the front card paints on top.
  const order = $derived(shown.map((c, i) => ({ c, i })).reverse());
</script>

<div class="ds-fan" role="img" aria-label={label} style:width="{Math.round(width * 2.4)}px" style:height="{Math.round(h + 40)}px" {...rest}>
  {#each order as { c, i } (i)}
    <CardImage src={c.src} alt={c.alt} {width} slot={i} />
  {/each}
</div>
