<!--
  A status line of the kit (docs/design/m8/contracts.md Part B; visual.md 2.8): one 24 px row, small caps, muted, one
  icon or dot. One line per screen. Plain markup by M8-C; M8-P1 gives it its look.
-->
<script lang="ts">
  import type { Snippet } from 'svelte';

  let { tone = 'muted', icon = undefined, children, ...rest }: { tone?: 'muted' | 'danger' | 'success'; icon?: Snippet | undefined; children?: Snippet; [attr: string]: unknown } = $props();
</script>

<p class="ds-status{tone === 'muted' ? '' : ` ds-status--${tone}`}" role="status" {...rest}>{#if icon}{@render icon()}{/if}{@render children?.()}</p>
