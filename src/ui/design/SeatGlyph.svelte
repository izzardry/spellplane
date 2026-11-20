<!-- Kit stub (contracts.md Part B) written by M8-P2 because M8-C's UI commit did not land; M8-P1's file replaces it. -->
<script lang="ts">
  let { seat, colour, size = 28, computer = false, label = undefined, ...rest }: { seat: number; colour: string; size?: number; computer?: boolean; label?: string | undefined; [key: string]: unknown } = $props();
  const glyph = $derived(['●', '◆', '▲', '■'][seat % 4]);
</script>

<span class="ds-glyph" class:computer style:width="{size}px" style:height="{size}px" style:color={colour} role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : 'true'} {...rest}>{glyph}</span>

<style>
  .ds-glyph { display: inline-grid; place-items: center; border-radius: 50%; background: var(--ds-panel-raised); box-shadow: inset 0 0 0 1px var(--ds-line); font-size: 14px; line-height: 1; }
  .computer { border-radius: 30%; }
</style>
