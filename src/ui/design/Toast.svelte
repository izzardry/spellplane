<!--
  A toast (PLAN Milestone 7, A1 and A8: one pattern for notices): a short line that arrives above the hand and leaves
  by itself; a status for screen readers.
-->
<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { HTMLAttributes } from 'svelte/elements';

  let { children, class: extra = '', ...rest }: HTMLAttributes<HTMLParagraphElement> & { children?: Snippet } = $props();
</script>

<p class="ds-toast {extra}" role="status" {...rest}>{@render children?.()}</p>
