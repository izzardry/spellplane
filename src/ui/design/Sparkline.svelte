<!--
  A sparkline (docs/design/m8/contracts.md Part B; visual.md 2.8): six to eight 5 px ink bars, up to 20 px high.
  Added by M8-P1.
-->
<script lang="ts">
  import './kit';
  import { sparkHeights } from './curve';

  let { values, label, ...rest }: { values: number[]; label: string; [attr: string]: unknown } = $props();
  const hs = $derived(sparkHeights(values));
</script>

<span class="ds-spark" role="img" aria-label="{label}: {values.join(', ')}" {...rest}>{#each hs as h, i (i)}<span class="ds-spark__bar" style:height="{Math.max(1, h)}px"></span>{/each}</span>
