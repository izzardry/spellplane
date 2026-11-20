<!--
  A toast of the kit (docs/design/m8/contracts.md Part B; visual.md 2.8): `undo`, `request`, `status` or `info`, a text,
  an optional detail and actions. The seed's children-only form stays (a status line). Plain markup by M8-C; M8-P1
  gives it its look.
-->
<script lang="ts">
  import type { Snippet } from 'svelte';

  let {
    kind = 'info',
    text = undefined,
    detail = undefined,
    actions = [],
    onclose = undefined,
    children,
    class: extra = '',
    ...rest
  }: {
    kind?: 'undo' | 'request' | 'status' | 'info';
    text?: string | undefined;
    detail?: string | undefined;
    actions?: { label: string; primary?: boolean; run(): void }[];
    onclose?: (() => void) | undefined;
    children?: Snippet;
    class?: string;
    [attr: string]: unknown;
  } = $props();
</script>

<div class="ds-toast ds-toast--{kind} {extra}" role="status" {...rest}>
  {#if text !== undefined}<span class="ds-toast__text">{text}</span>{/if}
  {#if detail}<span class="ds-toast__detail">{detail}</span>{/if}
  {@render children?.()}
  {#each actions as a (a.label)}
    <button type="button" class="ds-btn ds-btn--xs {a.primary ? 'ds-btn--primary' : 'ds-btn--ghost'}" onclick={() => a.run()}>{a.label}</button>
  {/each}
  {#if onclose}<button type="button" class="ds-btn ds-btn--quiet ds-btn--xs ds-icon-btn ds-icon-only" aria-label="Close" onclick={() => onclose?.()}>×</button>{/if}
</div>
