<!--
  The mana curve (docs/design/m8/contracts.md Part B; visual.md V15, 2.8): ink bars for creatures, halftone bars with
  an ink outline for other spells, the count above, the mana value below, a dotted outline of a good curve behind each
  column, and a legend. Height 148 (`full`) or 64 (`small`). Its numbers are also a visually hidden table, so the chart
  is readable without sight. Added by M8-P1.
-->
<script lang="ts">
  import './kit';
  import { curveColumns } from './curve';

  let {
    creatures,
    others,
    target = undefined,
    size = 'full',
    label,
    ...rest
  }: { creatures: number[]; others: number[]; target?: number[] | undefined; size?: 'full' | 'small'; label: string; [attr: string]: unknown } = $props();
  const height = $derived(size === 'full' ? 148 : 64);
  // Room for the count above and the mana value below.
  const cols = $derived(curveColumns(creatures, others, target, height - (size === 'full' ? 40 : 30)));
</script>

<figure class="ds-curve-chart" style:margin="0" {...rest}>
  <div class="ds-curve" class:ds-curve--small={size === 'small'} style:height="{height}px" aria-hidden="true">
    {#each cols as c (c.mv)}
      <div class="ds-curve__col" data-mv={c.mv}>
        <span class="ds-curve__n">{c.creatures + c.others || ''}</span>
        <div class="ds-curve__bars">
          {#if c.tg !== null && c.tg > 0}<span class="ds-curve__tg" data-part="target" style:height="{c.tg}px"></span>{/if}
          {#if c.cr > 0}<span class="ds-curve__cr" data-part="creatures" style:height="{c.cr}px"></span>{/if}
          {#if c.sp > 0}<span class="ds-curve__sp" data-part="others" style:height="{c.sp}px"></span>{/if}
        </div>
        <span class="ds-curve__x">{c.mv}</span>
      </div>
    {/each}
  </div>
  {#if size === 'full'}
    <figcaption class="ds-curve__legend" aria-hidden="true">
      <span><span class="ds-curve__key ds-curve__cr"></span>Creatures</span>
      <span><span class="ds-curve__key ds-curve__sp"></span>Other spells</span>
      {#if target}<span><span class="ds-curve__key" style:border="1.5px dotted var(--ds-muted)"></span>A clear curve</span>{/if}
    </figcaption>
  {/if}
  <table class="ds-sr-only">
    <caption>{label}</caption>
    <thead><tr><th scope="col">Mana value</th><th scope="col">Creatures</th><th scope="col">Other spells</th>{#if target}<th scope="col">Target</th>{/if}</tr></thead>
    <tbody>
      {#each cols as c, i (c.mv)}
        <tr><th scope="row">{c.mv}</th><td>{c.creatures}</td><td>{c.others}</td>{#if target}<td>{Math.round(target[i] ?? 0)}</td>{/if}</tr>
      {/each}
    </tbody>
  </table>
</figure>
