<!--
  KEEP and MULLIGAN over the opening hand (docs/design/m8/m7-adjustments.md, M7-P2 "Above the hand"; journey 4.10): two
  sm chips, shown from the first hand until KEEP is pressed or a card leaves the hand (ui/hud/opening.ts). MULLIGAN
  runs the existing mulligan command. Neither is filled: the primary button stays the one filled control.
-->
<script lang="ts">
  let { onkeep, onmulligan }: { onkeep: () => void; onmulligan: () => void } = $props();
</script>

<div class="opening" role="group" aria-label="Opening hand" data-testid="opening-hand">
  <button type="button" class="ds-btn sp-h-sm sp-pill chip" data-testid="opening-keep" title="Keep this hand" onclick={onkeep}>Keep</button>
  <button type="button" class="ds-btn ds-btn--quiet sp-h-sm sp-pill chip" data-testid="opening-mulligan" title="Shuffle this hand away and draw a new one" onclick={onmulligan}>Mulligan</button>
</div>

<style>
  .opening {
    display: flex;
    gap: var(--ds-space-sm);
    pointer-events: auto;
  }
  .chip {
    text-transform: uppercase;
    letter-spacing: 0.08em;
    font-size: var(--ds-type-small);
  }
</style>
