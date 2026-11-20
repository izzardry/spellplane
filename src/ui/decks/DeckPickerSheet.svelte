<!--
  The deck picker sheet (decks.md D29; journey.md 4.1): pick a deck from the library; `allow` says which may be picked
  and why not. Stub by M8-C: renders nothing. M8-P3 owns the file.
-->
<script lang="ts">
  import type { DeckRecord } from '../../store/types';

  let {
    allow: _allow = undefined,
    onpick: _onpick,
    onclose: _onclose = undefined,
  }: { allow?: ((deck: DeckRecord) => true | string) | undefined; onpick: (deck: DeckRecord) => void; onclose?: (() => void) | undefined } = $props();
</script>
