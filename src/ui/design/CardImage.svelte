<!--
  One card in the kit (visual.md V13): a whole face at 63:88, `object-fit: contain`, never cropped, tinted, dimmed or
  distorted; `src: null` draws our own neutral back (no official card back). `width` in px. Added by M8-P1.
-->
<script lang="ts">
  import './kit';

  let { src, alt, width = 96, slot = undefined, pile = false, ...rest }: { src: string | null; alt: string; width?: number; slot?: number | undefined; pile?: boolean; [attr: string]: unknown } = $props();
</script>

{#if src}
  <span class="ds-card" class:ds-pile={pile} data-slot={slot} style:--w="{width}px" {...rest}><img {src} {alt} draggable="false" decoding="async" /></span>
{:else}
  <span class="ds-card ds-card--back" class:ds-pile={pile} data-slot={slot} role="img" aria-label={alt} style:--w="{width}px" {...rest}></span>
{/if}
