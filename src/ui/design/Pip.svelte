<!--
  A mana pip (docs/design/m8/contracts.md Part B; visual.md 2.7): a disc in the colour's identity token with its letter,
  so it never depends on hue. Our own drawing; no official mana symbol. Added by M8-P1.
-->
<script lang="ts">
  import './kit';
  import type { ManaLetter } from './types';

  const NAMES: Record<ManaLetter, string> = { W: 'white', U: 'blue', B: 'black', R: 'red', G: 'green', C: 'colourless' };
  let { colour, size = 16, ...rest }: { colour: ManaLetter; size?: number; [attr: string]: unknown } = $props();
</script>

<span class="ds-pip ds-pip--{colour.toLowerCase()}" role="img" aria-label={NAMES[colour]} style:width="{size}px" style:height="{size}px" style:font-size="{Math.round(size * 0.58)}px" {...rest}>{colour}</span>
