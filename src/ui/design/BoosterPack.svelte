<!--
  A closed booster (docs/design/m8/contracts.md Part B; visual.md V16, 2.8): our own foil wrap drawn from
  `packArt(set, index)`: a five-stop foil gradient on a diagonal, a 5 px halftone over it, crimped ends (18 teeth,
  7 px deep) with bands of fine vertical lines, a centre seam, the sigil, the set code and `15 CARDS · BOOSTER`. The
  foil follows the look (--ds-foil-*). No <image>, no external reference, no filter; the shadow is a drawn ellipse.
  Drawn at 188 × 327 (the Draft Night hero); `width` defaults to 80 as in the seed (80 × 139 elsewhere, visual.md
  ruling). Added by M8-P1.
-->
<script lang="ts">
  import './kit';
  import { packArt, packOutline, starPoints } from './pack-art';

  let { set, index = 0, width = 80, ...rest }: { set: string; index?: number; width?: number; [attr: string]: unknown } = $props();
  const W = 188;
  const H = 327;
  const art = $derived(packArt(set, index));
  const pid = $props.id();
  const uid = `pk${pid}`;
  const rings = $derived(Array.from({ length: art.rings }, (_, i) => 22 + i * 9));
  const rays = $derived(Array.from({ length: art.points }, (_, i) => art.turnDeg + (i * 360) / art.points));
</script>

<svg class="ds-booster" role="img" aria-label="{art.code} booster" width={width} height={(width * (H + 14)) / W} viewBox="0 0 {W} {H + 14}" data-set={art.code} data-hash={art.hash} {...rest}>
  <defs>
    <linearGradient id="{uid}-foil" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" style:stop-color="var(--ds-foil-0)" />
      <stop offset="0.28" style:stop-color="var(--ds-foil-1)" />
      <stop offset="0.5" style:stop-color="var(--ds-foil-2)" />
      <stop offset="0.72" style:stop-color="var(--ds-foil-3)" />
      <stop offset="1" style:stop-color="var(--ds-foil-4)" />
    </linearGradient>
    <pattern id="{uid}-dots" width="5" height="5" patternUnits="userSpaceOnUse"><circle cx="2.5" cy="2.5" r="0.7" style:fill="var(--ds-foil-line)" opacity="0.18" /></pattern>
    <pattern id="{uid}-lines" width="3" height="24" patternUnits="userSpaceOnUse"><rect width="1" height="24" style:fill="var(--ds-foil-line)" opacity="0.35" /></pattern>
  </defs>
  <ellipse cx={W / 2} cy={H + 6} rx={W * 0.42} ry="6" fill="#000" opacity="0.18" />
  <g>
    <path d={packOutline(W, H)} fill="url(#{uid}-foil)" />
    <rect x="0" y="7" width={W} height={H - 14} fill="url(#{uid}-dots)" />
    <rect x="0" y="7" width={W} height="24" fill="url(#{uid}-lines)" />
    <rect x="0" y={H - 31} width={W} height="24" fill="url(#{uid}-lines)" />
    <line x1={W / 2} y1="31" x2={W / 2} y2={H - 31} style:stroke="var(--ds-foil-line)" stroke-width="0.6" opacity="0.4" />
    <g transform="translate({W / 2} {H * 0.42})" fill="none" style:stroke="var(--ds-foil-line)" stroke-width="0.8">
      {#each rings as r (r)}<circle {r} opacity="0.7" />{/each}
      {#each rays as a (a)}<line x1="0" y1="-14" x2="0" y2={-(rings[rings.length - 1] ?? 40) - 6} transform="rotate({a})" opacity="0.6" />{/each}
      <polygon points={starPoints(art.points, 18, art.turnDeg)} stroke-width="1" />
    </g>
    <text x={W / 2} y={H * 0.68} text-anchor="middle" style:fill="var(--ds-foil-line)" style:font-family="var(--ds-font-body)" font-size="26" font-weight="300" letter-spacing="6">{art.code}</text>
    <text x={W / 2} y={H * 0.68 + 22} text-anchor="middle" style:fill="var(--ds-foil-line)" style:font-family="var(--ds-font-body)" font-size="8" letter-spacing="1.6" opacity="0.8">15 CARDS · BOOSTER</text>
  </g>
</svg>
