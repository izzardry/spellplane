<!--
  The match-found card (matchmaking.md 2.8; journey.md 4.6), page-wide. Stub by M8-C: renders nothing (the stub
  matchmaker never finds a match). M8-P7 owns the file.
-->
<script lang="ts">
  import type { Matchmaker } from '../../session/types';

  let { matchmaker: _matchmaker, chime: _chime = undefined }: { matchmaker: Matchmaker; chime?: (() => void) | undefined } = $props();
</script>
