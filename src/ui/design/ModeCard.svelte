<!-- Kit stub (contracts.md Part B) written by M8-P2 because M8-C's UI commit did not land; M8-P1's file replaces it. -->
<script lang="ts">
  import type { Snippet } from 'svelte';
  let { value, name, meta = undefined, selected, locked = false, onselect, icon = undefined, ...rest }: { value: string; name: string; meta?: string | undefined; selected: boolean; locked?: boolean; onselect: () => void; icon?: Snippet | undefined; [key: string]: unknown } = $props();
</script>

<button type="button" role="radio" class="ds-mode" class:sel={selected} class:locked aria-checked={selected} data-value={value} disabled={locked} tabindex={selected ? 0 : -1} onclick={onselect} {...rest}>
  <span class="ds-mode__ic" aria-hidden="true">{@render icon?.()}</span>
  <span class="ds-mode__txt"><b>{name}</b>{#if meta}<span class="ds-mode__meta">{meta}</span>{/if}</span>
</button>

<style>
  .ds-mode { display: flex; align-items: center; gap: 12px; box-sizing: border-box; width: 204px; height: 72px; padding: 12px; border: 0; border-radius: 16px; background: var(--ds-panel-raised); color: var(--ds-ink); box-shadow: var(--ds-elevation-raised); font: inherit; text-align: left; cursor: pointer; }
  .ds-mode.sel { box-shadow: 0 0 0 2px var(--ds-ink), var(--ds-elevation-raised); }
  .ds-mode.locked { opacity: 0.45; cursor: default; }
  .ds-mode__ic { display: grid; place-items: center; width: 44px; height: 44px; flex: none; border-radius: 50%; background: var(--ds-chip); }
  .sel .ds-mode__ic { background: var(--ds-ink); color: var(--ds-panel); }
  .ds-mode__txt { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
  .ds-mode__txt b { font-size: 12px; letter-spacing: 0.08em; text-transform: uppercase; }
  .ds-mode__meta { font-size: 11px; color: var(--ds-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
</style>
