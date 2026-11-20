<!--
  A stepper of the kit (docs/design/m8/contracts.md Part B; visual.md 2.8): chevron, eyebrow over value, chevron (the
  phone's mode picker). Plain markup by M8-C; M8-P1 gives it its look.
-->
<script lang="ts">
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

<div class="ds-stepper" {...rest}>
  <button type="button" class="ds-btn ds-btn--ghost ds-btn--md ds-icon-btn ds-icon-only" aria-label={prevLabel} title={prevLabel} onclick={onprev}>‹</button>
  <div class="ds-stepper__value">
    {#if eyebrow}<span class="ds-t-eyebrow">{eyebrow}</span>{/if}
    <span class="ds-t-list">{value}</span>
  </div>
  <button type="button" class="ds-btn ds-btn--ghost ds-btn--md ds-icon-btn ds-icon-only" aria-label={nextLabel} title={nextLabel} onclick={onnext}>›</button>
</div>
