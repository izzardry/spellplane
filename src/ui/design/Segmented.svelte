<!-- Kit stub (contracts.md Part B) written by M8-P2 because M8-C's UI commit did not land; M8-P1's file replaces it. A radio group; arrow keys move. -->
<script lang="ts">
  let {
    options,
    value = $bindable(),
    size = 'md',
    label,
    onchange = undefined,
    disabled = false,
    ...rest
  }: {
    options: { value: string; label: string; disabled?: boolean; hint?: string }[];
    value: string;
    size?: 'sm' | 'md';
    label: string;
    onchange?: ((value: string) => void) | undefined;
    disabled?: boolean;
    [key: string]: unknown;
  } = $props();

  function choose(v: string): void {
    if (disabled || v === value) return;
    value = v;
    onchange?.(v);
  }
  function key(e: KeyboardEvent, i: number): void {
    const d = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (!d) return;
    e.preventDefault();
    const n = options.length;
    for (let k = 1; k <= n; k++) {
      const o = options[(i + d * k + n * k) % n];
      if (o && !o.disabled) {
        choose(o.value);
        ((e.currentTarget as HTMLElement).parentElement?.children[options.indexOf(o)] as HTMLElement | undefined)?.focus();
        return;
      }
    }
  }
</script>

<div class="ds-seg ds-seg--{size}" role="radiogroup" aria-label={label} aria-disabled={disabled || undefined} {...rest}>
  {#each options as o, i (o.value)}
    <button type="button" role="radio" class="ds-seg__opt" class:on={o.value === value} aria-checked={o.value === value} tabindex={o.value === value ? 0 : -1} disabled={disabled || o.disabled} title={o.hint} onclick={() => choose(o.value)} onkeydown={(e) => key(e, i)}>{o.label}</button>
  {/each}
</div>

<style>
  .ds-seg { display: inline-flex; box-sizing: border-box; padding: 4px; gap: 2px; border-radius: 999px; background: var(--ds-chip); height: 44px; }
  .ds-seg--sm { height: 36px; padding: 3px; }
  .ds-seg__opt { border: 0; border-radius: 999px; padding: 0 16px; background: transparent; color: var(--ds-muted); font: inherit; font-size: 12px; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; cursor: pointer; white-space: nowrap; }
  .ds-seg__opt.on { background: var(--ds-panel-raised); color: var(--ds-ink); box-shadow: var(--ds-elevation-raised); }
  .ds-seg__opt:disabled { cursor: default; opacity: 0.5; }
  .ds-seg__opt:focus-visible { outline: 2px solid var(--ds-focus); outline-offset: 1px; }
</style>
