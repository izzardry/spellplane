<!-- Kit stub (contracts.md Part B) written by M8-P2 because M8-C's UI commit did not land; M8-P1's file replaces it. -->
<script lang="ts">
  import type { Snippet } from 'svelte';
  let { tone = 'muted', icon = undefined, children, ...rest }: { tone?: 'muted' | 'danger' | 'success'; icon?: Snippet | undefined; children?: Snippet; [key: string]: unknown } = $props();
</script>

<p class="ds-status ds-status--{tone}" {...rest}>{@render icon?.()}{@render children?.()}</p>

<style>
  .ds-status { display: flex; align-items: center; justify-content: center; gap: 6px; min-height: 24px; margin: 0; font-size: 10px; letter-spacing: 0.1em; text-transform: uppercase; color: var(--ds-muted); text-align: center; }
  .ds-status--danger { color: var(--ds-danger); }
  .ds-status--success { color: var(--ds-success); }
</style>
