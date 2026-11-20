<!--
  The seal band of a booster deck (docs/design/m8/contracts.md Part B; visual.md 2.8; decks.md the seal): an ink band
  with a lock and the packs. It sits in the well below the cover card and never crosses a face. Plain markup by M8-C;
  M8-P1 gives it its look.
-->
<script lang="ts">
  let { packs, label = undefined, ...rest }: { packs: string; label?: string | undefined; [attr: string]: unknown } = $props();
</script>

<div class="ds-seal" role="img" aria-label={label ?? `Sealed: ${packs}`} {...rest}><span class="ds-seal__lock" aria-hidden="true"></span><span>{packs}</span></div>
