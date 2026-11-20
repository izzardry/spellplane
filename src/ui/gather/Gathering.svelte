<!--
  Gathering (journey.md 4.12; persistence.md section 5): the card over a table that waits for its players under the
  muster rule, around the HUD. Stub by M8-C: the table as it is (the stub muster is always live). M8-P5 owns the file.
-->
<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { TableState } from '../../core/types';
  import type { SessionMuster } from '../../session/types';

  let {
    muster: _muster,
    table: _table,
    code: _code = null,
    onhome: _onhome,
    onreadonly: _onreadonly = undefined,
    children,
  }: {
    muster: SessionMuster;
    table: TableState;
    code?: string | null;
    onhome: () => void;
    /** Called with true while the table must not take actions (standby), false once live. */
    onreadonly?: ((readOnly: boolean) => void) | undefined;
    children?: Snippet;
  } = $props();
</script>

{@render children?.()}
