<!-- Kit stub (contracts.md Part B) written by M8-P2 because M8-C's UI commit did not land; M8-P1's file replaces it. -->
<script lang="ts">
  import type { Snippet } from 'svelte';
  let {
    variant = 'secondary',
    size = 'md',
    pressed = undefined,
    waiting = false,
    disabled = false,
    type = 'button',
    href = undefined,
    onclick = undefined,
    icon = undefined,
    trailing = undefined,
    children,
    ...rest
  }: {
    variant?: 'primary' | 'secondary' | 'ghost' | 'quiet' | 'danger';
    size?: 'xs' | 'sm' | 'md' | 'lg';
    pressed?: boolean | undefined;
    waiting?: boolean;
    disabled?: boolean;
    type?: 'button' | 'submit';
    href?: string | undefined;
    onclick?: ((e: MouseEvent) => void) | undefined;
    icon?: Snippet | undefined;
    trailing?: Snippet | undefined;
    children?: Snippet;
    [key: string]: unknown;
  } = $props();
</script>

{#if href}
  <a {href} class="ds-btn ds-btn--{variant} ds-btn--{size}" class:is-waiting={waiting} {...rest}>{@render icon?.()}<span class="ds-btn__label">{@render children?.()}</span>{@render trailing?.()}</a>
{:else}
  <button {type} class="ds-btn ds-btn--{variant} ds-btn--{size}" class:is-waiting={waiting} aria-pressed={pressed} {disabled} {onclick} {...rest}>{@render icon?.()}<span class="ds-btn__label">{@render children?.()}</span>{@render trailing?.()}</button>
{/if}

<style>
  .ds-btn { display: inline-flex; align-items: center; justify-content: center; gap: 8px; box-sizing: border-box; border: 0; border-radius: 999px; padding: 0 20px; font: inherit; font-size: 12px; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; cursor: pointer; text-decoration: none; background: var(--ds-panel-raised); color: var(--ds-ink); box-shadow: var(--ds-elevation-raised); white-space: nowrap; transition: transform 150ms; }
  .ds-btn:active:not(:disabled) { transform: translateY(1px); }
  .ds-btn:disabled { background: var(--ds-chip); color: var(--ds-muted); box-shadow: none; cursor: default; }
  .ds-btn:focus-visible { outline: 2px solid var(--ds-focus); outline-offset: 2px; }
  .ds-btn--xs { height: 28px; padding: 0 12px; font-size: 11px; }
  .ds-btn--sm { height: 36px; padding: 0 16px; }
  .ds-btn--md { height: 44px; }
  .ds-btn--lg { height: 56px; padding: 0 32px; font-size: 14px; min-width: 240px; }
  .ds-btn--primary { background: var(--ds-accent); color: var(--ds-accent-ink); box-shadow: var(--ds-elevation-primary); }
  .ds-btn--ghost { background: transparent; box-shadow: inset 0 0 0 1px var(--ds-line); }
  .ds-btn--quiet { background: transparent; box-shadow: none; color: var(--ds-muted); }
  .ds-btn--danger { background: transparent; box-shadow: inset 0 0 0 1px var(--ds-line); color: var(--ds-danger); }
  .is-waiting { background: var(--ds-chip); color: var(--ds-ink); box-shadow: inset 0 1px 3px var(--ds-line); justify-content: space-between; }
</style>
