<!--
  The `#/diag` and `#/diag/<room>/<key>` routes (PLAN M1 connection check): the check with the props main.ts hands in,
  the dev transports in dev and test builds, or a plain "not wired" failure. Rendered inside the app shell's page frame.
-->
<script lang="ts">
  import type { DiagProps } from '../types';
  import Diag from './Diag.svelte';

  let { diag: given, room }: { diag?: DiagProps | undefined; room: { roomId: string; roomKey: string } | null } = $props();

  let diag = $state.raw<DiagProps | null>(null);
  $effect(() => {
    const r = room;
    if (given) {
      diag = { ...given, room: r };
      return;
    }
    if (__SPELLPLANE_DEBUG__) {
      void import('../lobby/dev-room').then((m) => (diag = m.devDiagProps(r)));
      return;
    }
    diag = {
      createTransport: () => {
        throw new Error('the peer-to-peer transport is not wired into this build yet');
      },
      room: r,
      now: () => Date.now(),
    };
  });
</script>

{#if diag}
  {#key diag}
    <Diag {...diag} />
  {/key}
{:else}
  <h1>Connection check</h1>
{/if}
