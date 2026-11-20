<!--
  Closed boosters, fanned (docs/design/m8/contracts.md Part B; visual.md 2.8): at most three drawn (−9°, 0°, +9°,
  overlapping 28 px), one per set given; `count` says how many each player opens. Added by M8-P1.
-->
<script lang="ts">
  import './kit';
  import BoosterPack from './BoosterPack.svelte';

  let { sets, count = undefined, width = 188, label, ...rest }: { sets: string[]; count?: number | undefined; width?: number; label: string; [attr: string]: unknown } = $props();
  const shown = $derived(sets.slice(0, 3));
  const turn = (i: number, n: number): number => (n === 1 ? 0 : n === 2 ? (i === 0 ? -5 : 5) : (i - 1) * 9);
</script>

<div class="ds-boosters" role="img" aria-label={count !== undefined ? `${label}: ${count} boosters` : label} data-count={count} {...rest}>
  {#each shown as s, i (`${s}:${i}`)}
    <span style:display="block" style:transform="rotate({turn(i, shown.length)}deg) translateY({shown.length === 3 && i !== 1 ? 8 : 0}px)" style:transform-origin="50% 100%" style:z-index={i === 1 ? 2 : 1} style:margin-left={i ? '-28px' : undefined}>
      <BoosterPack set={s} index={i} {width} aria-hidden="true" />
    </span>
  {/each}
</div>
