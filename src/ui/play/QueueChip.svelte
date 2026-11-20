<!--
  The queue bar's content while a search runs (journey.md 4.5; matchmaking.md 2.13). Stub by M8-C: renders nothing (the
  stub matchmaker is off). M8-P7 owns the file.
-->
<script lang="ts">
  import type { Matchmaker } from '../../session/types';

  let { matchmaker: _matchmaker, onhome: _onhome = undefined }: { matchmaker: Matchmaker; onhome?: (() => void) | undefined } = $props();
</script>
