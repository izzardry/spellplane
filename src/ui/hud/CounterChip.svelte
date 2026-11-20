<!--
  A player or card counter as a chip (docs/design/m7-hud-proposal.md, My plate: "Poison, energy, commander damage and
  other counters appear as chips only when not zero"). − and + show on hover or focus.
-->
<script lang="ts">
  let { kind, value, readonly = false, onchange }: { kind: string; value: number; readonly?: boolean; onchange: (delta: number) => void } = $props();
</script>

<span class="ds-chip counter" data-testid="counter-chip" data-kind={kind}>
  {#if !readonly}<button type="button" class="step" aria-label="Remove one {kind}" onclick={() => onchange(-1)}>−</button>{/if}
  <span class="kind">{kind}</span>
  <b class="n">{value}</b>
  {#if !readonly}<button type="button" class="step" aria-label="Add one {kind}" onclick={() => onchange(1)}>+</button>{/if}
</span>

<style>
  .counter {
    gap: 4px;
  }
  .kind {
    text-transform: var(--ds-label-case);
    letter-spacing: var(--ds-label-spacing);
    font-size: var(--ds-type-label);
  }
  .n {
    font-variant-numeric: tabular-nums;
  }
  .step {
    width: 18px;
    height: 18px;
    padding: 0;
    border: 0;
    border-radius: 50%;
    background: transparent;
    color: inherit;
    font: inherit;
    cursor: pointer;
    opacity: 0;
    pointer-events: auto;
  }
  .counter:hover .step,
  .counter:focus-within .step {
    opacity: 1;
  }
  @media (hover: none) {
    .step {
      opacity: 1;
    }
  }
</style>
