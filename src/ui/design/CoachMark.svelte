<!--
  A coach mark of the kit (docs/design/m8/contracts.md Part B; visual.md 2.8): a small bubble pointing at `anchor`, a
  title and a line; any press dismisses it. Plain markup by M8-C; M8-P1 gives it its look and placement.
-->
<script lang="ts">
  let {
    anchor,
    title,
    text = undefined,
    placement = 'above',
    ondismiss,
    ...rest
  }: { anchor: HTMLElement | null; title: string; text?: string | undefined; placement?: 'above' | 'below'; ondismiss: () => void; [attr: string]: unknown } = $props();
  const pos = $derived.by(() => {
    const r = anchor?.getBoundingClientRect();
    if (!r) return null;
    return placement === 'above' ? { left: r.left, top: r.top - 8, shift: '-100%' } : { left: r.left, top: r.bottom + 8, shift: '0' };
  });
  $effect(() => {
    const off = (): void => ondismiss();
    window.addEventListener('pointerdown', off, true);
    return () => window.removeEventListener('pointerdown', off, true);
  });
</script>

{#if pos}
  <div class="ds-coach ds-coach--{placement}" role="note" style:position="fixed" style:left="{pos.left}px" style:top="{pos.top}px" style:transform="translateY({pos.shift})" {...rest}>
    <b class="ds-coach__title">{title}</b>
    {#if text}<span class="ds-coach__text">{text}</span>{/if}
  </div>
{/if}
