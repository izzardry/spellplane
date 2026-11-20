<!--
  A mode card of Home (docs/design/m8/contracts.md Part B; visual.md 2.8 "Mode card"): a radio inside the parent's
  `role="radiogroup"`, an icon well, the name and one meta line; `locked` while a search runs. Plain markup by M8-C;
  M8-P1 gives it its look.
-->
<script lang="ts">
  import type { Snippet } from 'svelte';

  let {
    value,
    name,
    meta = undefined,
    selected,
    locked = false,
    onselect,
    icon = undefined,
    ...rest
  }: { value: string; name: string; meta?: string | undefined; selected: boolean; locked?: boolean; onselect: () => void; icon?: Snippet | undefined; [attr: string]: unknown } = $props();
</script>

<button type="button" class="ds-mode" class:sel={selected} class:locked role="radio" aria-checked={selected} aria-disabled={locked || undefined} tabindex={selected ? 0 : -1} data-value={value} onclick={() => !locked && onselect()} {...rest}>
  <span class="ds-mode__icon" aria-hidden="true">{#if icon}{@render icon()}{/if}</span>
  <span><b class="ds-mode__name">{name}</b>{#if meta}<span class="ds-mode__meta">{meta}</span>{/if}</span>
</button>
