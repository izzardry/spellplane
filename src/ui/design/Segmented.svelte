<!--
  A segmented control of the kit (docs/design/m8/contracts.md Part B; visual.md 2.8): a well of options, one on the
  thumb; a radio group (arrow keys move and select, skipping disabled options). Used for the nav, filters, formats and
  option rows. Plain markup by M8-C; M8-P1 gives it its look and the sliding thumb.
-->
<script lang="ts">
  let {
    options,
    value = $bindable(),
    size = 'md',
    label,
    onchange = undefined,
    ...rest
  }: {
    options: { value: string; label: string; disabled?: boolean; hint?: string }[];
    value: string;
    size?: 'sm' | 'md';
    label: string;
    onchange?: ((value: string) => void) | undefined;
    [attr: string]: unknown;
  } = $props();
  const buttons: HTMLButtonElement[] = [];

  function pick(v: string): void {
    if (v === value) return;
    value = v;
    onchange?.(v);
  }
  function key(e: KeyboardEvent, i: number): void {
    const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    for (let k = 1; k <= options.length; k++) {
      const j = (i + step * k + options.length * k) % options.length;
      const o = options[j];
      if (o && !o.disabled) {
        pick(o.value);
        buttons[j]?.focus();
        return;
      }
    }
  }
</script>

<div class="ds-seg{size === 'sm' ? ' ds-seg--sm' : ''}" role="radiogroup" aria-label={label} {...rest}>
  {#each options as o, i (o.value)}
    <button
      type="button"
      role="radio"
      class="ds-seg__opt"
      class:on={o.value === value}
      aria-checked={o.value === value}
      tabindex={o.value === value ? 0 : -1}
      disabled={o.disabled || undefined}
      title={o.hint}
      data-value={o.value}
      bind:this={buttons[i]}
      onclick={() => pick(o.value)}
      onkeydown={(e) => key(e, i)}>{o.label}</button
    >
  {/each}
</div>
