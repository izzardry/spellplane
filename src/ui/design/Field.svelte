<!-- Kit stub (contracts.md Part B) written by M8-P2 because M8-C's UI commit did not land; M8-P1's file replaces it. -->
<script lang="ts">
  import type { Snippet } from 'svelte';
  let { value = $bindable(), label, placeholder = undefined, readonly = false, square = false, icon = undefined, trailing = undefined, oninput = undefined, onenter = undefined, ...rest }: { value: string; label: string; placeholder?: string | undefined; readonly?: boolean; square?: boolean; icon?: Snippet | undefined; trailing?: Snippet | undefined; oninput?: ((v: string) => void) | undefined; onenter?: ((v: string) => void) | undefined; [key: string]: unknown } = $props();
</script>

<label class="ds-field" class:square>
  {@render icon?.()}
  <input aria-label={label} {placeholder} {readonly} bind:value oninput={() => oninput?.(value)} onkeydown={(e) => e.key === 'Enter' && onenter?.(value)} {...rest} />
  {@render trailing?.()}
</label>

<style>
  .ds-field { display: flex; align-items: center; gap: 8px; box-sizing: border-box; height: 44px; padding: 0 16px; border-radius: 999px; background: var(--ds-chip); box-shadow: inset 0 1px 2px var(--ds-line); }
  .ds-field.square { border-radius: 12px; }
  .ds-field input { flex: 1; min-width: 0; height: 100%; border: 0; background: transparent; color: var(--ds-ink); font: inherit; font-size: 14px; outline: none; }
  .ds-field:focus-within { box-shadow: 0 0 0 2px var(--ds-focus); }
</style>
