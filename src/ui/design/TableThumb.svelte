<!--
  A table still for History (docs/design/m8/contracts.md Part B; visual.md 2.8 "Table still"): an SVG of the saved
  public battlefield, one outline per card (rotated when tapped); no faces, no hands. Plain markup by M8-C; M8-P1 gives
  it its look.
-->
<script lang="ts">
  import type { GameThumb } from '../../store/types';

  let { thumb, seats, width = 128, ...rest }: { thumb: GameThumb | null; seats: { colour: string; life?: number; computer?: boolean }[]; width?: number; [attr: string]: unknown } = $props();
  const w = $derived(thumb?.w ?? 16);
  const h = $derived(thumb?.h ?? 9);
</script>

<svg class="ds-thumb" viewBox="0 0 {w} {h}" width={width} height={(width * 9) / 16} preserveAspectRatio="xMidYMid meet" role="img" aria-label="Table, {seats.length} players" {...rest}>
  <rect x="0" y="0" width={w} height={h} rx={w * 0.04} fill="var(--ds-mat)" />
  <line x1={w * 0.06} x2={w * 0.94} y1={h / 2} y2={h / 2} stroke="var(--ds-line)" />
  {#each thumb?.cards ?? [] as c, i (i)}
    <rect x={c[0] - w * 0.035} y={c[1] - h * 0.085} width={w * 0.07} height={h * 0.17} fill="var(--ds-panel-raised)" stroke={seats[c[3]]?.colour ?? 'var(--ds-ink)'} stroke-width={w * 0.004} transform={c[2] ? `rotate(90 ${c[0]} ${c[1]})` : undefined} />
  {/each}
</svg>
