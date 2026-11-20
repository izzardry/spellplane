<!--
  A mode card (docs/design/m8/contracts.md Part B; visual.md V17, 2.8): 204 × 72, an icon in a round well, the name and
  one live line. A radio inside a `role="radiogroup"` the parent provides: one tab stop (the selected card), arrow
  keys move to the next card and select it. Selected: a 2 px ink ring and the icon well in ink. Locked while searching:
  disabled, its content at 45 %. Added by M8-P1.
-->
<script lang="ts">
  import './kit';
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

  function key(e: KeyboardEvent): void {
    const forward = e.key === 'ArrowRight' || e.key === 'ArrowDown';
    const back = e.key === 'ArrowLeft' || e.key === 'ArrowUp';
    if (!forward && !back) return;
    const me = e.currentTarget as HTMLElement;
    const group = me.closest('[role="radiogroup"]');
    if (!group) return;
    const all = [...group.querySelectorAll<HTMLButtonElement>('.ds-mode[role="radio"]:not(:disabled)')];
    const at = all.indexOf(me as HTMLButtonElement);
    if (at < 0 || all.length < 2) return;
    e.preventDefault();
    const next = all[(at + (forward ? 1 : -1) + all.length) % all.length];
    next?.focus();
    next?.click();
  }
</script>

<button
  type="button"
  class="ds-mode"
  role="radio"
  aria-checked={selected}
  tabindex={selected ? 0 : -1}
  disabled={locked || undefined}
  data-value={value}
  onclick={() => {
    if (!selected) onselect();
  }}
  onkeydown={key}
  {...rest}
>
  <span class="ds-mode__icon" aria-hidden="true">{#if icon}{@render icon()}{/if}</span>
  <span><span class="ds-mode__name">{name}</span>{#if meta}<span class="ds-mode__meta">{meta}</span>{/if}</span>
</button>
