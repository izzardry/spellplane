<!--
  A dialog (PLAN Milestone 7, A1 and A8: one place for dialogs): a panel over a plain scrim (never a blur, PLAN
  Milestone 7, A0), titled, closed by Esc, the close button or a press on the scrim. Focus moves into it on open and
  back to where it was on close.
-->
<script lang="ts">
  import { onMount, type Snippet } from 'svelte';

  let { title, onclose, children, actions, testid = null, describedby = undefined }: { title: string; onclose: () => void; children?: Snippet; actions?: Snippet; testid?: string | null; describedby?: string | undefined } = $props();
  const id = `ds-dialog-${Math.random().toString(36).slice(2, 8)}`;
  let el = $state<HTMLElement | undefined>();
  onMount(() => {
    const before = document.activeElement as HTMLElement | null;
    const first = el?.querySelector<HTMLElement>('[data-autofocus], button, [href], input, select, textarea');
    first?.focus({ preventScroll: true });
    return () => before?.focus?.({ preventScroll: true });
  });
</script>

<div class="ds-scrim" role="presentation" onpointerdown={(e) => e.target === e.currentTarget && onclose()}>
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
        onclose();
      }
    }}
  >
    <h2 class="ds-heading" {id}>{title}</h2>
    {@render children?.()}
    {#if actions}<div class="ds-dialog-actions">{@render actions()}</div>{/if}
  </div>
</div>

<style>
  h2 {
    font-size: var(--ds-type-heading);
  }
</style>
