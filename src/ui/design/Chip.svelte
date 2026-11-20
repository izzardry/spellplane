<!-- Kit stub (contracts.md Part B) written by M8-P2 because M8-C's UI commit did not land; M8-P1's file replaces it. -->
<script lang="ts">
  import type { Snippet } from 'svelte';
  let { variant = 'fill', size = 'xs', onclick = undefined, pressed = undefined, children, ...rest }: { variant?: 'fill' | 'line' | 'on'; size?: 'xs' | 'sm'; onclick?: ((e: MouseEvent) => void) | undefined; pressed?: boolean | undefined; children?: Snippet; [key: string]: unknown } = $props();
</script>

{#if onclick}
  <button type="button" class="ds-chip ds-chip--{variant} ds-chip--{size}" aria-pressed={pressed} {onclick} {...rest}>{@render children?.()}</button>
{:else}
  <span class="ds-chip ds-chip--{variant} ds-chip--{size}" {...rest}>{@render children?.()}</span>
{/if}

<style>
  .ds-chip { display: inline-flex; align-items: center; gap: 6px; box-sizing: border-box; height: 28px; padding: 0 12px; border: 0; border-radius: 999px; background: var(--ds-chip); color: var(--ds-ink); font: inherit; font-size: 11px; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; white-space: nowrap; }
  .ds-chip--sm { height: 36px; }
  .ds-chip--line { background: transparent; box-shadow: inset 0 0 0 1px var(--ds-line); color: var(--ds-muted); }
  .ds-chip--on { background: var(--ds-ink); color: var(--ds-panel); }
  button.ds-chip { cursor: pointer; }
</style>
