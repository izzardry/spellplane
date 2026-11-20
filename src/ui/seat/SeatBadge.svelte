<!--
  Badges on a player plate (journey.md 4.10: RE-INVITE, NOT SAVING, SEAT MOVED; persistence.md section 6). Stub by
  M8-C: renders nothing. M8-P5 owns the file.
-->
<script lang="ts">
  import type { SeatId, TableState } from '../../core/types';

  let { table: _table, seat: _seat, me: _me }: { table: TableState; seat: SeatId; me: SeatId | null } = $props();
</script>
