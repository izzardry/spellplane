<!--
  A QR code on a white plate (docs/design/m8/contracts.md Part B; visual.md 2.7): draws `matrix` (src/ui/qr.ts
  qrMatrix) as SVG rectangles; null shows an empty plate. Plain markup by M8-C; M8-P1 gives it its look.
-->
<script lang="ts">
  let { matrix, size = 184, label, ...rest }: { matrix: boolean[][] | null; size?: number; label: string; [attr: string]: unknown } = $props();
  const n = $derived(matrix?.length ?? 0);
  const path = $derived.by(() => {
    if (!matrix) return '';
    let d = '';
    matrix.forEach((row, y) => row.forEach((on, x) => (d += on ? `M${x} ${y}h1v1h-1z` : '')));
    return d;
  });
</script>

<div class="ds-qr" role="img" aria-label={label} style:width="{size}px" style:height="{size}px" {...rest}>
  {#if matrix}
    <svg viewBox="-2 -2 {n + 4} {n + 4}" width="100%" height="100%" shape-rendering="crispEdges" aria-hidden="true"><rect x="-2" y="-2" width={n + 4} height={n + 4} fill="#fff" /><path d={path} fill="#000" /></svg>
  {/if}
</div>
