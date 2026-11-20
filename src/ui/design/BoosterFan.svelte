<!--
  Closed boosters fanned (docs/design/m8/contracts.md Part B; visual.md 2.8): the Draft Night hero and the booster
  setup's preview; at most three are drawn. Plain markup by M8-C; M8-P1 gives it its look.
-->
<script lang="ts">
  import BoosterPack from './BoosterPack.svelte';

  let { sets, count = undefined, width = 188, label, ...rest }: { sets: string[]; count?: number | undefined; width?: number; label: string; [attr: string]: unknown } = $props();
  const shown = $derived(sets.slice(0, 3));
</script>

<div class="ds-boosters" role="img" aria-label={label} data-count={count ?? sets.length} {...rest}>
  {#each shown as set, i (i)}<BoosterPack {set} index={i} {width} />{/each}
</div>
