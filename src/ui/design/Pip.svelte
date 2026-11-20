<!--
  A mana pip of the kit (docs/design/m8/contracts.md Part B; visual.md 2.7): a circle in the mana colour with its letter.
  Plain markup by M8-C; M8-P1 gives it its look.
-->
<script lang="ts">
  let { colour, size = 16, ...rest }: { colour: 'W' | 'U' | 'B' | 'R' | 'G' | 'C'; size?: number; [attr: string]: unknown } = $props();
</script>

<span class="ds-pip ds-pip--{colour.toLowerCase()}" style:width="{size}px" style:height="{size}px" role="img" aria-label={colour} {...rest}>{colour}</span>
