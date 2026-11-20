<!--
  The versus screen while the automatic setup runs (journey.md 4.7). Stub by M8-C: renders nothing (the table shows
  through). M8-P4 owns the file.
-->
<script lang="ts">
  import type { TableSession } from '../../session/types';

  let { session: _session, creator: _creator = false, label: _label = '', ondone: _ondone = undefined, onhome: _onhome = undefined }: { session: TableSession; creator?: boolean; label?: string; ondone?: (() => void) | undefined; onhome?: (() => void) | undefined } = $props();
</script>
