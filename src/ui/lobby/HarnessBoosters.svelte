<!--
  A stand-in for M8-P3's BoosterSetupSheet on `?harness=lobby`: shows the mode and value the waiting room passes and
  offers one change (two packs), so the draft night's setup path is checked without M8-P3's code. M8-P4.
-->
<script lang="ts">
  import type { BoosterSetup } from '../../store/types';
  import Button from '../design/Button.svelte';
  import Sheet from '../design/Sheet.svelte';

  let { value, mode, onchange = undefined, onclose = undefined }: { value: BoosterSetup; mode: 'deck' | 'draft'; onchange?: ((value: BoosterSetup) => void) | undefined; onclose?: (() => void) | undefined } = $props();
</script>

<Sheet label="Boosters" width="narrow" {onclose} data-testid="booster-setup" data-mode={mode}>
  {#snippet header()}<h2 class="ds-t-title">Boosters</h2>{/snippet}
  <p class="ds-t-meta" data-testid="booster-setup-value">{value.how} · {value.packs} × {value.sets.join(', ')}</p>
  <Button data-testid="booster-setup-two" onclick={() => onchange?.({ ...value, packs: 2 })}>TWO PACKS</Button>
</Sheet>
