<!--
  A coach mark (docs/design/m8/contracts.md Part B; visual.md 2.8): one white bubble anchored to what it explains, a
  bold 12 px title and a muted 11 px line, a rotated square as pointer. A press anywhere dismisses it. Placed once on
  mount and on resize; nothing follows the anchor per frame. Added by M8-P1.
-->
<script lang="ts">
  import './kit';
  import { tick } from 'svelte';

  let {
    anchor,
    title,
    text = undefined,
    placement = 'below',
    ondismiss,
    ...rest
  }: { anchor: HTMLElement | null; title: string; text?: string | undefined; placement?: 'above' | 'below'; ondismiss: () => void; [attr: string]: unknown } = $props();
  let el = $state<HTMLElement | undefined>();
  let pos = $state<{ left: number; top: number } | null>(null);

  function place(): void {
    if (!el || !anchor) return;
    const r = anchor.getBoundingClientRect();
    const h = el.offsetHeight;
    const w = el.offsetWidth;
    const left = Math.max(8, Math.min(r.left + r.width / 2 - 34, window.innerWidth - w - 8));
    const top = placement === 'below' ? r.bottom + 12 : r.top - 12 - h;
    pos = { left, top: Math.max(8, top) };
  }

  $effect(() => {
    if (!el) return;
    void tick().then(place);
    const away = (): void => ondismiss();
    const resize = (): void => place();
    // A press anywhere dismisses; registered after this tick so the press that opened it does not.
    const t = setTimeout(() => window.addEventListener('pointerdown', away, true), 0);
    window.addEventListener('resize', resize);
    return () => {
      clearTimeout(t);
      window.removeEventListener('pointerdown', away, true);
      window.removeEventListener('resize', resize);
    };
  });
</script>

<div bind:this={el} class="ds-coach ds-coach--{placement} ds-root" role="note" data-ds-layer="coach" style:left={pos ? `${pos.left}px` : undefined} style:top={pos ? `${pos.top}px` : undefined} style:visibility={pos ? undefined : 'hidden'} {...rest}>
  <span class="ds-coach__title">{title}</span>
  {#if text}<span class="ds-coach__text">{text}</span>{/if}
</div>
