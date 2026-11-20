<!-- Kit stub (contracts.md Part B) written by M8-P2 because M8-C's UI commit did not land; M8-P1's file replaces it. -->
<script lang="ts">
  import type { Snippet } from 'svelte';
  let {
    label,
    size = 'md',
    variant = 'secondary',
    pressed = undefined,
    disabled = false,
    onclick = undefined,
    children,
    ...rest
  }: {
    label: string;
    size?: 'xs' | 'sm' | 'md' | 'lg';
    variant?: 'primary' | 'secondary' | 'ghost' | 'quiet' | 'danger';
    pressed?: boolean | undefined;
    disabled?: boolean;
    onclick?: ((e: MouseEvent) => void) | undefined;
    children?: Snippet;
    [key: string]: unknown;
  } = $props();
</script>

<button type="button" class="ds-ib ds-ib--{size} ds-ib--{variant}" aria-label={label} title={label} aria-pressed={pressed} {disabled} {onclick} {...rest}>{@render children?.()}</button>

<style>
  .ds-ib { display: inline-grid; place-items: center; box-sizing: border-box; border: 0; border-radius: 50%; padding: 0; cursor: pointer; background: var(--ds-panel-raised); color: var(--ds-ink); box-shadow: var(--ds-elevation-raised); font: inherit; transition: transform 150ms; }
  .ds-ib:disabled { background: var(--ds-chip); color: var(--ds-muted); box-shadow: none; cursor: default; }
  .ds-ib:focus-visible { outline: 2px solid var(--ds-focus); outline-offset: 2px; }
  .ds-ib--xs { width: 28px; height: 28px; }
  .ds-ib--sm { width: 36px; height: 36px; }
  .ds-ib--md { width: 44px; height: 44px; }
  .ds-ib--lg { width: 56px; height: 56px; }
  .ds-ib--ghost { background: transparent; box-shadow: inset 0 0 0 1px var(--ds-line); }
  .ds-ib--quiet { background: transparent; box-shadow: none; }
</style>
