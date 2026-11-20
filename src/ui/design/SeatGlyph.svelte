<!--
  A seat glyph of the kit (docs/design/m8/contracts.md Part B; visual.md 2.7): a ring in the seat colour with the
  seat's letter; a hexagon for the computer. Plain markup by M8-C; M8-P1 gives it its look.
-->
<script lang="ts">
  let {
    seat,
    colour,
    size = 28,
    computer = false,
    label = undefined,
    ...rest
  }: { seat: number; colour: string; size?: number; computer?: boolean; label?: string | undefined; [attr: string]: unknown } = $props();
  const letter = $derived('ABCD'[seat] ?? '?');
</script>

<span
  class="ds-seat"
  class:ds-seat--computer={computer}
  style:color={colour}
  style:width="{size}px"
  style:height="{size}px"
  role="img"
  aria-label={label ?? `Seat ${seat + 1}`}
  {...rest}>{letter}</span
>
