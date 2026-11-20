<!--
  A stepper (docs/design/m8/contracts.md Part B; visual.md 2.8, Ztyle): a chevron, the eyebrow over the value, a
  chevron. Phones only (the mode picker). Added by M8-P1.
-->
<script lang="ts">
  import './kit';
  import IconButton from './IconButton.svelte';

  let {
    eyebrow = undefined,
    value,
    onprev,
    onnext,
    prevLabel,
    nextLabel,
    ...rest
  }: { eyebrow?: string | undefined; value: string; onprev: () => void; onnext: () => void; prevLabel: string; nextLabel: string; [attr: string]: unknown } = $props();
</script>

<div class="ds-stepper ds-row" {...rest}>
  <IconButton label={prevLabel} icon="chevronLeft" onclick={onprev} />
  <div class="ds-stepper__value" aria-live="polite">
    {#if eyebrow}<span class="ds-t-eyebrow">{eyebrow}</span>{/if}
    <span class="ds-t-list">{value}</span>
  </div>
  <IconButton label={nextLabel} icon="chevronRight" onclick={onnext} />
</div>
