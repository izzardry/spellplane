<!-- Kit stub (contracts.md Part B) written by M8-P2 because M8-C's UI commit did not land; M8-P1's file replaces it. -->
<script lang="ts">
  import type { GameThumb } from '../../store/types';
  let { thumb, seats, width = 128, ...rest }: { thumb: GameThumb | null; seats: { colour: string; life?: number; computer?: boolean }[]; width?: number; [key: string]: unknown } = $props();
  const W = 128;
  const H = 72;
  const sx = $derived(thumb ? (W - 16) / Math.max(1, thumb.w) : 1);
  const sy = $derived(thumb ? (H - 16) / Math.max(1, thumb.h) : 1);
  const spots: [number, number][] = [[64, 62], [64, 10], [10, 36], [118, 36]];
</script>

<svg class="ds-thumb" width={width} height={Math.round((width * H) / W)} viewBox="0 0 {W} {H}" aria-hidden="true" {...rest}>
  <rect x="1" y="1" width={W - 2} height={H - 2} rx="8" class="mat" />
  <line x1="8" y1={H / 2} x2={W - 8} y2={H / 2} class="mid" />
  {#if thumb}
    {#each thumb.cards as c, i (i)}
      {@const x = c[0]}
      {@const y = c[1]}
      {@const t = c[2]}
      <rect x={8 + x * sx - 3} y={8 + y * sy - 4} width="6" height="8" rx="1" class="card" transform={t ? `rotate(90 ${8 + x * sx} ${8 + y * sy})` : undefined} />
    {/each}
  {/if}
  {#each seats.slice(0, 4) as s, i (i)}
    <circle cx={spots[i]![0]} cy={spots[i]![1]} r="7" style:fill={s.colour} class="seat" />
    {#if s.life !== undefined}<text x={spots[i]![0]} y={spots[i]![1] + 3} class="life">{s.life}</text>{/if}
  {/each}
</svg>

<style>
  .ds-thumb { display: block; flex: none; }
  .mat { fill: var(--ds-mat); stroke: var(--ds-line); }
  .mid { stroke: var(--ds-line); stroke-dasharray: 2 3; }
  .card { fill: none; stroke: var(--ds-ink); stroke-width: 0.8; }
  .seat { stroke: var(--ds-panel); stroke-width: 1.5; }
  .life { font-size: 7px; text-anchor: middle; fill: var(--ds-panel); font-weight: 700; }
</style>
