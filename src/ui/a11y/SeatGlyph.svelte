<!--
  A seat's glyph in its seat colour, drawn beside the colour wherever a seat colour carries meaning in the HUD (DESIGN
  "Input and interaction design", Accessibility: "Seat colours are paired with a shape or pattern (line dash, avatar
  glyph), so nothing depends on hue alone"; PLAN M5-P4). The same shapes as the avatar's and the lobby's glyphs.
  Decorative for screen readers: the seat's name is always written next to it.
-->
<script lang="ts">
  import { seatGlyph } from './seats';

  let { colour, size = 9, tint = null }: { colour: number | null; size?: number; /** A colour to draw it in instead of the seat colour (on a seat-coloured chip: its ink). */ tint?: string | null } = $props();
  const glyph = $derived(colour === null ? null : seatGlyph(colour));
</script>

{#if glyph !== null}
  <span class="seat-glyph {glyph}" data-testid="seat-glyph" data-glyph={glyph} aria-hidden="true" style:--size="{size}px" style:--glyph-colour={tint ?? `var(--sp-seat-${colour}, currentColor)`}></span>
{/if}

<style>
  .seat-glyph {
    display: inline-block;
    width: var(--size);
    height: var(--size);
    margin-right: 0.3em;
    vertical-align: baseline;
    background: var(--glyph-colour);
    flex: none;
  }
  .circle {
    border-radius: 50%;
  }
  .triangle {
    clip-path: polygon(50% 0, 100% 100%, 0 100%);
  }
  .diamond {
    clip-path: polygon(50% 0, 100% 50%, 50% 100%, 0 50%);
  }
  .star {
    clip-path: polygon(50% 0, 61% 35%, 98% 35%, 68% 57%, 79% 91%, 50% 70%, 21% 91%, 32% 57%, 2% 35%, 39% 35%);
  }
  .hexagon {
    clip-path: polygon(25% 0, 75% 0, 100% 50%, 75% 100%, 25% 100%, 0 50%);
  }
  .cross {
    clip-path: polygon(35% 0, 65% 0, 65% 35%, 100% 35%, 100% 65%, 65% 65%, 65% 100%, 35% 100%, 35% 65%, 0 65%, 0 35%, 35% 35%);
  }
  .ring {
    background: none;
    border: 2px solid var(--glyph-colour);
    border-radius: 50%;
    box-sizing: border-box;
  }
  /* Forced colours (Windows contrast themes) would drop the background: keep the glyph's shape and colour. */
  @media (forced-colors: active) {
    .seat-glyph {
      forced-color-adjust: none;
    }
  }
</style>
