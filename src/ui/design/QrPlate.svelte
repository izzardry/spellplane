<!--
  A QR plate (docs/design/m8/contracts.md Part B; visual.md 2.7): black modules on a white plate with a 10 px quiet
  margin and 8 px corners, in every look (a scanner needs dark on light). `matrix` comes from `ui/qr.ts` qrMatrix;
  `null` (text too long, or still loading) shows the empty plate. Added by M8-P1.
-->
<script lang="ts">
  import './kit';

  let { matrix, size = 184, label, ...rest }: { matrix: boolean[][] | null; size?: number; label: string; [attr: string]: unknown } = $props();
  const n = $derived(matrix?.length ?? 0);
  const d = $derived.by(() => {
    if (!matrix) return '';
    let p = '';
    matrix.forEach((row, y) => row.forEach((on, x) => (p += on ? `M${x} ${y}h1v1h-1z` : '')));
    return p;
  });
</script>

<div class="ds-qr" role="img" aria-label={label} style:width="{size}px" style:height="{size}px" {...rest}>
  {#if matrix && n}
    <svg width={size} height={size} viewBox="0 0 {n} {n}" shape-rendering="crispEdges" aria-hidden="true"><path d={d} fill="#000" /></svg>
  {/if}
</div>
