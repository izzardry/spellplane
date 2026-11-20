<!--
  The toast host (docs/design/m8/contracts.md Part B; visual.md 2.8): renders `toasts.ts` bottom centre in the shell or
  above the primary, right-aligned, in a table. A polite live region; a request toast is an alert. Added by M8-P1.
-->
<script lang="ts">
  import './kit';
  import Toast from './Toast.svelte';
  import { toasts as pageToasts, type ToastEntry, type ToastStore } from './toasts';

  let { place = 'bottom-centre', store = pageToasts, ...rest }: { place?: 'bottom-centre' | 'above-primary'; /** [M8-P1] another store (tests, harness) */ store?: ToastStore; [attr: string]: unknown } = $props();
  let list = $state<readonly ToastEntry[]>([]);
  $effect(() => store.subscribe((l) => (list = l)));
</script>

<div class="ds-toast-host ds-toast-host--{place} ds-root" aria-live="polite" data-testid="toast-host" {...rest}>
  {#each list as t (t.id)}
    <Toast kind={t.kind} text={t.text} detail={t.detail} actions={t.actions} onclose={t.kind === 'request' ? undefined : () => store.dismiss(t.id)} data-toast={t.id} />
  {/each}
</div>
