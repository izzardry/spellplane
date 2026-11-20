<!--
  A pile (docs/design/m8/contracts.md Part B; visual.md 2.4 rule 5): what lies on top, with the `stack` elevation's
  alternating edges under it when the pile has cards (`count`, 0 to 60). Added by M8-P1.
-->
<script lang="ts">
  import './kit';
  import type { Snippet } from 'svelte';

  let { count = 40, children, ...rest }: { count?: number; children?: Snippet; [attr: string]: unknown } = $props();
  const n = $derived(Math.max(0, Math.min(60, Math.round(count))));
</script>

<span class="ds-pilestack" class:ds-pile={n > 1} data-count={n} {...rest}>{@render children?.()}</span>
