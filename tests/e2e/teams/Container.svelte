<!--
  The Two-Headed Giant team view of a real networked session on a test page: the teammate's hand fan
  (src/ui/hand/TeamHands.svelte) over the session's table state, as the HUD mounts it. Test page only.
-->
<script lang="ts">
  import type { TableState } from '../../../src/core/types';
  import type { FaceSource } from '../../../src/data/types';
  import type { TableSession } from '../../../src/session/types';
  import TeamHands from '../../../src/ui/hand/TeamHands.svelte';

  let { session, faces }: { session: TableSession; faces: FaceSource } = $props();
  let table = $state.raw<TableState | null>(null);
  $effect(() => {
    table = session.getState();
    return session.subscribe((s) => (table = s));
  });
  let vw = $state(window.innerWidth);
  let vh = $state(window.innerHeight);
</script>

<svelte:window onresize={() => ((vw = window.innerWidth), (vh = window.innerHeight))} />

{#if table && session.team}
  <TeamHands team={session.team} state={table} {faces} {vw} {vh} />
{/if}
