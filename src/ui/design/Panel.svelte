<!--
  A panel of the design system (PLAN Milestone 7, A1): a resting surface (`raised`) or a popover above another (`pop`).
-->
<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { HTMLAttributes } from 'svelte/elements';

  let { pop = false, children, class: extra = '', ...rest }: HTMLAttributes<HTMLDivElement> & { pop?: boolean; children?: Snippet } = $props();
</script>

<div class="{pop ? 'ds-pop' : 'ds-panel'} {extra}" {...rest}>{@render children?.()}</div>
