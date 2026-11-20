<!--
  A toast (docs/design/m8/contracts.md Part B; visual.md 2.8): white, radius `card`, `pop`, at least 52 px: the text
  (its first part bold), a muted detail, `xs` actions (the primary in ink) and a close icon. A request toast leads with
  a presence dot. The seed's children-only form stays. Rewritten by M8-P1.
-->
<script lang="ts">
  import './kit';
  import type { Snippet } from 'svelte';
  import Button from './Button.svelte';
  import IconButton from './IconButton.svelte';
  import type { ToastAction, ToastKind } from './toasts';

  let {
    kind = 'info',
    text = undefined,
    detail = undefined,
    actions = [],
    onclose = undefined,
    children,
    class: extra = '',
    ...rest
  }: { kind?: ToastKind; text?: string | undefined; detail?: string | undefined; actions?: ToastAction[]; onclose?: (() => void) | undefined; children?: Snippet; class?: string; [attr: string]: unknown } = $props();
</script>

<div class="ds-toast ds-toast--{kind} {extra}" role={kind === 'request' ? 'alert' : 'status'} data-ds-layer="toast" data-kind={kind} {...rest}>
  {#if kind === 'request'}<span class="ds-dot ds-dot--here" aria-hidden="true"></span>{/if}
  <span class="ds-toast__text">{#if text !== undefined}<b>{text}</b>{#if detail}<span class="ds-toast__detail"> {detail}</span>{/if}{:else}{@render children?.()}{/if}</span>
  {#each actions as a (a.label)}
    <Button size="xs" variant={a.primary ? 'primary' : kind === 'request' ? 'ghost' : 'secondary'} onclick={() => a.run()}>{a.label}</Button>
  {/each}
  {#if onclose}<IconButton label="Close" icon="close" size="xs" variant="quiet" onclick={onclose} />{/if}
</div>
