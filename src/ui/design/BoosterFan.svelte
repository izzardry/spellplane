<!-- Kit stub (contracts.md Part B) written by M8-P2 because M8-C's UI commit did not land; M8-P1's file replaces it. -->
<script lang="ts">
  let { sets, count = undefined, width = 120, label, ...rest }: { sets: string[]; count?: number | undefined; width?: number; label: string; [key: string]: unknown } = $props();
  const shown = $derived(sets.slice(0, 3));
  const turn = [-9, 0, 9];
</script>

<div class="ds-boosters" role="img" aria-label={label} data-count={count ?? sets.length} {...rest}>
  {#each shown as code, i (i)}
    <svg class="ds-pack" data-set={code} width={width} height={Math.round(width * 1.74)} viewBox="0 0 120 209" style:transform="rotate({turn[shown.length === 3 ? i : 1]}deg)">
      <rect x="0" y="0" width="120" height="209" rx="6" class="foil" />
      <path d="M0 24h120M0 185h120" class="crimp" />
      <circle cx="60" cy="92" r="30" class="sigil" />
      <text x="60" y="100" class="q">?</text>
      <text x="60" y="160" class="code">{code}</text>
    </svg>
  {/each}
</div>

<style>
  .ds-boosters { display: inline-flex; align-items: flex-end; }
  .ds-pack { margin: 0 -14px; }
  .foil { fill: var(--ds-ink); }
  .crimp { stroke: var(--ds-panel); stroke-opacity: 0.4; }
  .sigil { fill: none; stroke: var(--ds-panel); stroke-width: 1.2; }
  .q { fill: var(--ds-panel); font-size: 26px; text-anchor: middle; }
  .code { fill: var(--ds-panel); font-size: 18px; letter-spacing: 3px; text-anchor: middle; }
</style>
