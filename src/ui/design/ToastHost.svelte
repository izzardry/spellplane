<!--
  Where the page's toasts show (docs/design/m8/contracts.md Part B; visual.md 2.8): bottom centre in the shell, above
  the primary button in a table. Reads `toasts` of ui/design/toasts.ts. Plain markup by M8-C; M8-P1 gives it its look.
-->
<script lang="ts">
  import Toast from './Toast.svelte';
  import { toasts, type ToastEntry } from './toasts';

  let { place = 'bottom-centre', ...rest }: { place?: 'bottom-centre' | 'above-primary'; [attr: string]: unknown } = $props();
  let list = $state.raw<readonly ToastEntry[]>([]);
  $effect(() => toasts.subscribe((l) => (list = l)));
</script>

<div class="ds-toast-host ds-toast-host--{place}" aria-live="polite" {...rest}>
  {#each list as t (t.id)}
    <Toast kind={t.kind} text={t.text} detail={t.detail} actions={t.actions} onclose={() => toasts.dismiss(t.id)} data-testid="toast" data-kind={t.kind} />
  {/each}
</div>
