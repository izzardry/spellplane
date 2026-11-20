<!--
  A schematic of a saved table (docs/design/m8/contracts.md Part B; visual.md V19, 2.8 "Table still"; ruling: named
  TableThumb): the mat with dots, a centre line, one outlined rectangle per public battlefield card of
  `GameSummary.thumb` (rotated when tapped), and one disc per seat at its edge in the seat colour with its life total
  (the own disc ringed, an away disc hollow). No faces, no hands, no pile contents: it takes a GameThumb only. Always
  16:9 (128 × 72 by default, `width` × width·9/16): the frame, whatever its aspect, is centred in a 16:9 box of mat
  (`thumbBox`). Added by M8-P1.
-->
<script lang="ts">
  import './kit';
  import type { GameThumb } from '../../store/types';
  import { thumbBox, thumbDiscs, thumbRects } from './thumb';

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
  const box = $derived(thumbBox(thumb ?? { w: 1280, h: 720 }));
  const rects = $derived(thumb ? thumbRects(thumb) : []);
  const discs = $derived(thumbDiscs(box, seats.length).map((d) => ({ ...d, cx: d.cx + box.x, cy: d.cy + box.y })));
  const r = $derived(box.h * 0.09);
  const height = $derived(Math.round((width * 9) / 16));
  const pid = $props.id();
  const uid = `th${pid}`;
</script>

<svg class="ds-thumb" role="img" aria-label={label ?? `Table with ${rects.length} cards in play`} {width} {height} viewBox="{box.x} {box.y} {box.w} {box.h}" preserveAspectRatio="xMidYMid meet" data-cards={rects.length} data-seats={seats.length} {...rest}>
  <defs><pattern id="{uid}-dots" x={box.x} y={box.y} width={box.w / 20} height={box.w / 20} patternUnits="userSpaceOnUse"><circle cx={box.w / 40} cy={box.w / 40} r={box.w / 300} style:fill="var(--ds-ink)" opacity="0.08" /></pattern></defs>
  <rect x={box.x} y={box.y} width={box.w} height={box.h} style:fill="var(--ds-mat)" />
  <rect x={box.x} y={box.y} width={box.w} height={box.h} fill="url(#{uid}-dots)" />
  <line x1={box.x + box.w * 0.06} x2={box.x + box.w * 0.94} y1={box.y + box.h / 2} y2={box.y + box.h / 2} style:stroke="var(--ds-ink)" stroke-opacity="0.18" stroke-width={box.w / 300} />
  {#each rects as c, i (i)}
    <rect data-part="card" data-tapped={c.tapped ? 1 : 0} x={c.x} y={c.y} width={c.w} height={c.h} rx={c.w * 0.08} transform={c.tapped ? `rotate(90 ${c.x + c.w / 2} ${c.y + c.h / 2})` : undefined} style:fill="var(--ds-panel-raised)" style:stroke="var(--ds-ink)" stroke-width={box.w / 220} />
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
