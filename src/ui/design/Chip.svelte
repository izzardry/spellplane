<!--
  A chip (PLAN Milestone 7, A1): a small label with an optional icon, for states and counts that show only when they
  matter.
-->
<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { HTMLAttributes } from 'svelte/elements';
  import Icon from './Icon.svelte';
  import type { IconName } from './icons';

  let { icon = null, children, class: extra = '', ...rest }: HTMLAttributes<HTMLSpanElement> & { icon?: IconName | null; children?: Snippet } = $props();
</script>

<span class="ds-chip {extra}" {...rest}>{#if icon}<Icon name={icon} size={14} />{/if}{@render children?.()}</span>
