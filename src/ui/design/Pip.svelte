<!-- Kit stub (contracts.md Part B) written by M8-P2 because M8-C's UI commit did not land; M8-P1's file replaces it. -->
<script lang="ts">
  let { colour, size = 16, ...rest }: { colour: 'W' | 'U' | 'B' | 'R' | 'G' | 'C'; size?: number; [key: string]: unknown } = $props();
</script>

<span class="ds-pip" style:width="{size}px" style:height="{size}px" style:font-size="{Math.round(size * 0.6)}px" {...rest}>{colour}</span>

<style>
  .ds-pip { display: inline-grid; place-items: center; border-radius: 50%; background: var(--ds-chip); color: var(--ds-ink); box-shadow: inset 0 0 0 1px var(--ds-ink); font-weight: 700; }
</style>
