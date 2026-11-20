<!--
  The status line (docs/design/m8/contracts.md Part B; visual.md 2.8): a 24 px row, 10 px capitals tracked 0.1 em,
  muted, one icon or dot. One per screen; a polite live region. Added by M8-P1.
-->
<script lang="ts">
  import './kit';
  import type { Snippet } from 'svelte';

  let { tone = 'muted', icon = undefined, children, ...rest }: { tone?: 'muted' | 'danger' | 'success'; icon?: Snippet | undefined; children?: Snippet; [attr: string]: unknown } = $props();
</script>

<p class="ds-status ds-status--{tone}" role="status" style:margin="0" {...rest}>{#if icon}{@render icon()}{/if}<span>{@render children?.()}</span></p>
