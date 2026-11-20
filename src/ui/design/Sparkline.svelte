<!--
  A sparkline of the kit (docs/design/m8/contracts.md Part B; visual.md 2.8): six to eight small bars, up to 20 px.
  Plain markup by M8-C; M8-P1 gives it its look.
-->
<script lang="ts">
  let { values, label, ...rest }: { values: number[]; label: string; [attr: string]: unknown } = $props();
  const max = $derived(Math.max(1, ...values));
</script>

<span class="ds-spark" role="img" aria-label={label} {...rest}>{#each values as v, i (i)}<i class="ds-spark__bar" style:height="{Math.round((v / max) * 20)}px"></i>{/each}</span>
