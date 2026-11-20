<!--
  The booster setup sheet (journey.md 4.4): how, packs, picks, sets and the pick timer, for a booster deck or a draft
  night. Stub by M8-C: renders nothing. M8-P3 owns the file.
-->
<script lang="ts">
  import type { BoosterSetup } from '../../store/types';

  let {
    value: _value,
    mode: _mode,
    onchange: _onchange = undefined,
    onclose: _onclose = undefined,
  }: { value: BoosterSetup; mode: 'deck' | 'draft'; onchange?: ((value: BoosterSetup) => void) | undefined; onclose?: (() => void) | undefined } = $props();
</script>
