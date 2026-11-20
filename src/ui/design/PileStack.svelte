<!--
  A pile of cards (docs/design/m8/contracts.md Part B; visual.md 2.3 `stack`): what lies on top, with an edge as thick
  as `count` (0 to 60). Plain markup by M8-C; M8-P1 gives it its look.
-->
<script lang="ts">
  import type { Snippet } from 'svelte';

  let { count = 0, children, ...rest }: { count?: number; children?: Snippet; [attr: string]: unknown } = $props();
  const depth = $derived(Math.max(0, Math.min(60, Math.round(count))));
</script>

<div class="ds-pilestack" class:ds-pile={depth > 0} data-count={depth} {...rest}>{@render children?.()}</div>
