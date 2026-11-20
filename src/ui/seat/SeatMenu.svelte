<!--
  The connection section of a plate's "⋯" menu (journey.md 4.10, 4.11; persistence.md section 7): connection state,
  `Bring … back…`, `Leave table`. Stub by M8-C: renders nothing. M8-P5 owns the file.
-->
<script lang="ts">
  import type { SeatId, TableState } from '../../core/types';
  import type { SessionMuster } from '../../session/types';

  let { table: _table, seat: _seat, me: _me, muster: _muster, onleave: _onleave = undefined }: { table: TableState; seat: SeatId; me: SeatId | null; muster: SessionMuster; onleave?: (() => void) | undefined } = $props();
</script>
