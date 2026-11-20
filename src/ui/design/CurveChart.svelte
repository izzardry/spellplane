<!--
  A mana curve (docs/design/m8/contracts.md Part B; visual.md 2.8 "Curve chart"): eight columns 0 to 7+, creatures and
  other spells stacked, an optional target outline; a text alternative lists the curve. Plain markup by M8-C; M8-P1
  gives it its look.
-->
<script lang="ts">
  let {
    creatures,
    others,
    target = undefined,
    size = 'full',
    label,
    ...rest
  }: { creatures: number[]; others: number[]; target?: number[] | undefined; size?: 'full' | 'small'; label: string; [attr: string]: unknown } = $props();
  const cols = $derived(Array.from({ length: 8 }, (_, i) => ({ mv: i === 7 ? '7+' : String(i), cr: creatures[i] ?? 0, sp: others[i] ?? 0, tg: target?.[i] ?? null })));
  const text = $derived(cols.map((c) => `${c.mv}: ${c.cr + c.sp}`).join(', '));
  const unit = $derived(size === 'small' ? 4 : 9);
</script>

<figure class="ds-curve-chart" aria-label={label} {...rest}>
  <div class="ds-curve" class:ds-curve--small={size === 'small'} aria-hidden="true">
    {#each cols as c (c.mv)}
      <div class="ds-curve__col">
        {#if c.tg !== null}<span class="ds-curve__tg" style:height="{c.tg * unit}px"></span>{/if}
        <span class="ds-curve__n">{c.cr + c.sp}</span>
        <div class="ds-curve__bars"><i class="ds-curve__sp" style:height="{c.sp * unit}px"></i><i class="ds-curve__cr" style:height="{c.cr * unit}px"></i></div>
        <span class="ds-curve__x">{c.mv}</span>
      </div>
    {/each}
  </div>
  <figcaption class="ds-sr-only">{label}: {text}</figcaption>
</figure>
