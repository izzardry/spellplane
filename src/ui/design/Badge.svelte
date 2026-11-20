<!--
  A badge of the kit (docs/design/m8/contracts.md Part B; visual.md 2.8): an ink pill, at least 20 px; on a card 28 px
  with a ring. Plain markup by M8-C; M8-P1 gives it its look.
-->
<script lang="ts">
  import type { Snippet } from 'svelte';

  let { tone = 'ink', onCard = false, children, ...rest }: { tone?: 'ink' | 'muted' | 'danger' | 'success'; onCard?: boolean; children?: Snippet; [attr: string]: unknown } = $props();
</script>

<span class="ds-badge{tone === 'ink' ? '' : ` ds-badge--${tone}`}" class:ds-badge--on-card={onCard} {...rest}>{@render children?.()}</span>
