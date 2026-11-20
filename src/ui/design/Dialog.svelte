<!--
  A dialog of the kit (docs/design/m8/contracts.md Part B; visual.md 2.8 "Dialog and scrim"): a card over a flat scrim
  (never a blur), labelled, closed by Esc or a press on the scrim; focus moves into it and back. `open` is bindable.
  The seed's `title` (alias of `label`), `actions` (alias of `footer`), `testid` and `describedby` stay optional.
  Plain markup by M8-C; M8-P1 gives it its look.
-->
<script lang="ts">
  import { onMount, type Snippet } from 'svelte';

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
  const id = `ds-dialog-${Math.random().toString(36).slice(2, 8)}`;
  const heading = $derived(label ?? title ?? '');
  const foot = $derived(footer ?? actions);
  let el = $state<HTMLElement | undefined>();
  function close(): void {
    open = false;
    onclose?.();
  }
  onMount(() => {
    const before = document.activeElement as HTMLElement | null;
    const first = el?.querySelector<HTMLElement>('[data-autofocus], button, [href], input, select, textarea');
    first?.focus({ preventScroll: true });
    return () => before?.focus?.({ preventScroll: true });
  });
</script>

{#if open}
  <div class="ds-scrim" role="presentation" onpointerdown={(e) => e.target === e.currentTarget && close()}>
    <div
      bind:this={el}
      class="ds-pop ds-dialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby={id}
      aria-describedby={describedby}
      data-testid={testid}
      tabindex="-1"
      onkeydown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          close();
        }
      }}
    >
      <h2 class="ds-heading" {id}>{heading}</h2>
      {@render children?.()}
      {#if foot}<div class="ds-dialog-actions">{@render foot()}</div>{/if}
    </div>
  </div>
{/if}

<style>
  h2 {
    font-size: var(--ds-type-heading);
  }
</style>
