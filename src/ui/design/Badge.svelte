<!--
  A badge (docs/design/m8/contracts.md Part B; visual.md 2.8): an ink pill, min 20 px, 11 px bold; on a card 28 px with
  a 2 px ring in the surface colour. Added by M8-P1.
-->
<script lang="ts">
  import './kit';
  import type { Snippet } from 'svelte';

  let { tone = 'ink', onCard = false, children, ...rest }: { tone?: 'ink' | 'muted' | 'danger' | 'success'; onCard?: boolean; children?: Snippet; [attr: string]: unknown } = $props();
</script>

<span class="ds-badge ds-badge--{tone}" class:ds-badge--on-card={onCard} {...rest}>{@render children?.()}</span>
