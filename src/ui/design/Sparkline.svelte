<!-- Kit stub (contracts.md Part B) written by M8-P2 because M8-C's UI commit did not land; M8-P1's file replaces it. -->
<script lang="ts">
  let { values, label, ...rest }: { values: number[]; label: string; [key: string]: unknown } = $props();
  const max = $derived(Math.max(1, ...values));
</script>

<span class="ds-spark" role="img" aria-label={label} {...rest}>{#each values as v, i (i)}<i style:height="{Math.max(1, Math.round((v / max) * 20))}px"></i>{/each}</span>

<style>
  .ds-spark { display: inline-flex; align-items: flex-end; gap: 2px; height: 20px; }
  .ds-spark i { display: block; width: 5px; background: var(--ds-ink); border-radius: 1px; }
</style>
