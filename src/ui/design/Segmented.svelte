<!--
  A segmented control (docs/design/m8/contracts.md Part B; visual.md V3, 2.8): a well with one raised thumb that slides
  200 ms (transform only). A radio group: arrow keys, Home and End move and select, skipping disabled options; one tab
  stop. Used for the nav, filters, formats and option rows. With `onchange` the control is controlled: it reports the
  pick and shows whatever `value` the parent then passes (a parent that refuses a pick keeps its option on the thumb);
  without `onchange` it writes `value` itself (`bind:value`). Added by M8-P1.
-->
<script lang="ts">
  import './kit';
  import { tick } from 'svelte';
  import { stepOption } from './segmented';

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

  let track = $state<HTMLElement | undefined>();
  const buttons: HTMLButtonElement[] = [];
  let thumb = $state<{ x: number; w: number } | null>(null);

  function place(): void {
    const i = options.findIndex((o) => o.value === value);
    const b = buttons[i];
    thumb = b ? { x: b.offsetLeft, w: b.offsetWidth } : null;
  }

  $effect(() => {
    // Re-measure when the value or the options (their labels too) change (never per frame).
    void value;
    for (const o of options) void o.label;
    void tick().then(place);
  });

  $effect(() => {
    if (!track || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => place());
    ro.observe(track);
    return () => ro.disconnect();
  });

  function pick(v: string): void {
    if (v === value) return;
    if (onchange) onchange(v);
    else value = v;
  }

  function key(e: KeyboardEvent, i: number): void {
    const next = stepOption(options, i, e.key);
    if (next === null) return;
    e.preventDefault();
    const o = options[next];
    if (!o) return;
    pick(o.value);
    buttons[next]?.focus();
  }

  const current = $derived(Math.max(0, options.findIndex((o) => o.value === value)));
</script>

<div bind:this={track} class="ds-seg ds-seg--{size}" role="radiogroup" aria-label={label} {...rest}>
  {#if thumb}<span class="ds-seg__thumb" aria-hidden="true" style:width="{thumb.w}px" style:transform="translateX({thumb.x}px)"></span>{/if}
  {#each options as o, i (o.value)}
    <button
      type="button"
      class="ds-seg__opt"
      class:on={o.value === value}
      role="radio"
      aria-checked={o.value === value}
      tabindex={i === current ? 0 : -1}
      disabled={o.disabled || undefined}
      title={o.hint}
      data-value={o.value}
      bind:this={buttons[i]}
      onclick={() => pick(o.value)}
      onkeydown={(e) => key(e, i)}>{o.label}</button
    >
  {/each}
</div>
