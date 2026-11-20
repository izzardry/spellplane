<!--
  A closed booster pack, drawn (docs/design/m8/contracts.md Part B; visual.md 2.8 "Booster pack"): a foil gradient, the
  sigil of packArt(set, index) and the set code. No image and no external reference. Plain markup by M8-C; M8-P1
  gives it its look.
-->
<script lang="ts">
  import { packArt } from './pack-art';

  let { set, index = 0, width = 80, ...rest }: { set: string; index?: number; width?: number; [attr: string]: unknown } = $props();
  const art = $derived(packArt(set, index));
  const star = $derived.by(() => {
    const pts: string[] = [];
    for (let i = 0; i < art.points * 2; i++) {
      const r = i % 2 === 0 ? 30 : 13;
      const a = ((art.turnDeg + (i * 180) / art.points) * Math.PI) / 180;
      pts.push(`${(50 + r * Math.sin(a)).toFixed(1)},${(80 - r * Math.cos(a)).toFixed(1)}`);
    }
    return pts.join(' ');
  });
</script>

<svg class="ds-booster" viewBox="0 0 100 174" width={width} height={(width * 174) / 100} role="img" aria-label="{set} booster" {...rest}>
  <rect x="0" y="0" width="100" height="174" rx="4" fill="currentColor" opacity="0.9" />
  {#each Array.from({ length: art.rings }, (_, i) => i) as i (i)}
    <circle cx="50" cy="80" r={34 + i * 6} fill="none" stroke="#fff" stroke-width="0.6" opacity="0.6" />
  {/each}
  <polygon points={star} fill="none" stroke="#fff" stroke-width="0.8" />
  <text x="50" y="140" text-anchor="middle" font-size="12" fill="#fff" letter-spacing="2">{set.toUpperCase()}</text>
  <text x="50" y="156" text-anchor="middle" font-size="5" fill="#fff" letter-spacing="1">15 CARDS · BOOSTER</text>
</svg>
