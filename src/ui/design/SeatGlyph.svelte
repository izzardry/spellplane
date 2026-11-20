<!--
  A seat glyph (docs/design/m8/contracts.md Part B; visual.md 2.7): a ring in the seat colour around the seat's shape
  (● ◆ ▲ ■), so a seat never depends on hue; a computer seat is a hexagon. Added by M8-P1.
-->
<script lang="ts">
  import './kit';

  let { seat, colour, size = 28, computer = false, label = undefined, ...rest }: { seat: number; colour: string; size?: number; computer?: boolean; label?: string | undefined; [attr: string]: unknown } = $props();
  const SHAPES = ['circle', 'diamond', 'triangle', 'square'] as const;
  const shape = $derived(SHAPES[((seat % 4) + 4) % 4] ?? 'circle');
  const hex = '12,1.5 21.1,6.75 21.1,17.25 12,22.5 2.9,17.25 2.9,6.75';
</script>

<span class="ds-seat" class:ds-seat--computer={computer} role="img" aria-label={label ?? `Seat ${seat + 1}`} data-shape={computer ? 'hexagon' : shape} style:width="{size}px" style:height="{size}px" style:color={colour} style:border-radius={computer ? '0' : '50%'} style:background={computer ? 'transparent' : undefined} style:box-shadow={computer ? 'none' : 'inset 0 0 0 2px currentColor'} {...rest}>
  <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
    {#if computer}<polygon points={hex} fill="var(--ds-panel-raised)" stroke="currentColor" stroke-width="2" />{/if}
    {#if shape === 'circle'}<circle cx="12" cy="12" r="4" fill="currentColor" />
    {:else if shape === 'diamond'}<polygon points="12,7 17,12 12,17 7,12" fill="currentColor" />
    {:else if shape === 'triangle'}<polygon points="12,7.5 16.5,15.5 7.5,15.5" fill="currentColor" />
    {:else}<rect x="8" y="8" width="8" height="8" fill="currentColor" />{/if}
  </svg>
</span>
