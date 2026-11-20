<!--
  The seal band of a booster deck (docs/design/m8/contracts.md Part B; visual.md V14; Part G Decks 5): an ink band with
  a lock and the packs (`M19 × 6`) and dashed lines to both edges. Its parent places it below the cover card's lower
  edge (in a deck tile: the bottom of the well), so it never crosses a card face. Added by M8-P1.
-->
<script lang="ts">
  import './kit';
  import Icon from './Icon.svelte';

  let { packs, label = undefined, ...rest }: { packs: string; label?: string | undefined; [attr: string]: unknown } = $props();
</script>

<div class="ds-seal" role="img" aria-label={label ?? `Sealed booster deck: ${packs}`} {...rest}><Icon name="lock" size={12} /><span>{packs}</span></div>
