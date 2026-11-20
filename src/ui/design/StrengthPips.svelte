<!--
  Deck strength as five bars (docs/design/m8/contracts.md Part B; decks.md section 5): `band` 1 to 5 filled, null for a
  deck too small to judge. Plain markup by M8-C; M8-P1 gives it its look.
-->
<script lang="ts">
  let { band, score = undefined, label = undefined, ...rest }: { band: 1 | 2 | 3 | 4 | 5 | null; score?: number | undefined; label?: string | undefined; [attr: string]: unknown } = $props();
  const name = $derived(label ?? (band === null ? 'Strength not rated' : `Strength ${band} of 5${score !== undefined ? ` (${score})` : ''}`));
</script>

<span class="ds-strength" role="img" aria-label={name} {...rest}
  ><span class="ds-str">{#each [1, 2, 3, 4, 5] as i (i)}<b class="ds-str__bar" class:ds-str__bar--off={band === null || i > band}></b>{/each}</span></span
>
