<!--
  A dialog (docs/design/m8/contracts.md Part B; visual.md 2.8 "Dialog and scrim"): a white card, radius `sheet`,
  `dialog` elevation, centred, at most 448 px, over a flat scrim (the page colour at 82 %, never a blur). Escape, the
  close path or a press on the scrim close it; focus moves in on open and back on close; Tab stays inside. `open` is
  bindable (default true, so the seed's mount-to-open use keeps working); the seed's `title`, `actions` and `testid`
  stay as aliases of `label`, `footer` and `data-testid`. Rewritten by M8-P1.
-->
<script lang="ts">
  import './kit';
  import type { Snippet } from 'svelte';

  let {
    open = $bindable(true),
    label = undefined,
    title = undefined,
    onclose = undefined,
    footer = undefined,
    actions = undefined,
    children,
    testid = null,
    describedby = undefined,
  }: {
    open?: boolean;
    label?: string | undefined;
    /** Seed alias of `label`. */
    title?: string | undefined;
    onclose?: (() => void) | undefined;
    footer?: Snippet | undefined;
    /** Seed alias of `footer`. */
    actions?: Snippet | undefined;
    children?: Snippet;
    testid?: string | null;
    describedby?: string | undefined;
  } = $props();
  const pid = $props.id();
  const id = `ds-dialog-${pid}`;
  let el = $state<HTMLElement | undefined>();
  const heading = $derived(label ?? title ?? '');
  const foot = $derived(footer ?? actions);

  function close(): void {
    open = false;
    onclose?.();
  }

  $effect(() => {
    if (!open || !el) return;
    const before = document.activeElement as HTMLElement | null;
    const first = el.querySelector<HTMLElement>('[data-autofocus], button, [href], input, select, textarea');
    (first ?? el).focus({ preventScroll: true });
    return () => before?.focus?.({ preventScroll: true });
  });

  function key(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      close();
    } else if (e.key === 'Tab' && el) {
      const all = [...el.querySelectorAll<HTMLElement>('button:not(:disabled), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')];
      if (!all.length) return;
      const at = all.indexOf(document.activeElement as HTMLElement);
      e.preventDefault();
      all[(at + (e.shiftKey ? -1 : 1) + all.length) % all.length]?.focus();
    }
  }
</script>

{#if open}
  <div class="ds-scrim ds-root" role="presentation" onpointerdown={(e) => e.target === e.currentTarget && close()}>
    <div bind:this={el} class="ds-dialog" role="dialog" aria-modal="true" aria-labelledby={id} aria-describedby={describedby} data-testid={testid} data-ds-layer="dialog" tabindex="-1" onkeydown={key}>
      <h2 class="ds-t-heading" {id}>{heading}</h2>
      {@render children?.()}
      {#if foot}<div class="ds-dialog-actions ds-row">{@render foot()}</div>{/if}
    </div>
  </div>
{/if}
