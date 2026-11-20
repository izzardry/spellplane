<!--
  A schematic of a saved table (docs/design/m8/contracts.md Part B; visual.md V19, 2.8 "Table still"; ruling: named
  TableThumb): the mat with dots, a centre line, one outlined rectangle per public battlefield card of
  `GameSummary.thumb` (rotated when tapped), and one disc per seat at its edge in the seat colour with its life total
  (the own disc ringed, an away disc hollow). No faces, no hands, no pile contents: it takes a GameThumb only. 128 × 72
  by default. Added by M8-P1.
-->
<script lang="ts">
  import './kit';
  import type { GameThumb } from '../../store/types';
  import { thumbDiscs, thumbRects } from './thumb';

  let {
    thumb,
    seats,
    width = 128,
    label = undefined,
    ...rest
  }: {
    thumb: GameThumb | null;
    seats: { colour: string; life?: number; computer?: boolean; /** [M8-P1] */ away?: boolean; /** [M8-P1] */ me?: boolean }[];
    width?: number;
    /** [M8-P1] accessible name */
    label?: string | undefined;
    [attr: string]: unknown;
  } = $props();
  const frame = $derived(thumb ?? { w: 1280, h: 720, cards: [] });
  const rects = $derived(thumb ? thumbRects(thumb) : []);
  const discs = $derived(thumbDiscs(frame, seats.length));
  const r = $derived(Math.min(frame.w, frame.h) * 0.09);
  const height = $derived(Math.round((width * frame.h) / frame.w));
  const pid = $props.id();
  const uid = `th${pid}`;
</script>

<svg class="ds-thumb" role="img" aria-label={label ?? `Table with ${rects.length} cards in play`} width={width} height={height} viewBox="0 0 {frame.w} {frame.h}" data-cards={rects.length} data-seats={seats.length} {...rest}>
  <defs><pattern id="{uid}-dots" width={frame.w / 20} height={frame.w / 20} patternUnits="userSpaceOnUse"><circle cx={frame.w / 40} cy={frame.w / 40} r={frame.w / 300} style:fill="var(--ds-ink)" opacity="0.08" /></pattern></defs>
  <rect width={frame.w} height={frame.h} style:fill="var(--ds-mat)" />
  <rect width={frame.w} height={frame.h} fill="url(#{uid}-dots)" />
  <line x1={frame.w * 0.06} x2={frame.w * 0.94} y1={frame.h / 2} y2={frame.h / 2} style:stroke="var(--ds-ink)" stroke-opacity="0.18" stroke-width={frame.w / 300} />
  {#each rects as c, i (i)}
    <rect data-part="card" data-tapped={c.tapped ? 1 : 0} x={c.x} y={c.y} width={c.w} height={c.h} rx={c.w * 0.08} transform={c.tapped ? `rotate(90 ${c.x + c.w / 2} ${c.y + c.h / 2})` : undefined} style:fill="var(--ds-panel-raised)" style:stroke="var(--ds-ink)" stroke-width={frame.w / 220} />
  {/each}
  {#each discs as d (d.seat)}
    {@const s = seats[d.seat]}
    {#if s}
      <g data-part="seat" data-seat={d.seat}>
        {#if s.me}<circle cx={d.cx} cy={d.cy} r={r * 1.22} fill="none" style:stroke="var(--ds-ink)" stroke-width={r * 0.14} />{/if}
        <circle cx={d.cx} cy={d.cy} {r} fill={s.away ? 'none' : s.colour} stroke={s.colour} stroke-width={r * 0.18} style:fill={s.away ? 'var(--ds-panel-raised)' : undefined} />
        {#if s.life !== undefined}<text x={d.cx} y={d.cy} dy="0.35em" text-anchor="middle" font-size={r * 1.05} font-weight="600" style:fill={s.away ? s.colour : '#fff'} style:font-family="var(--ds-font-numeral)">{s.life}</text>{/if}
      </g>
    {/if}
  {/each}
</svg>
