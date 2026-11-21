<!--
  A table in this browser alone: the practice table `#/p/<room>` and the sandbox `#/solo` (docs/design/m8/contracts.md
  Part C). Opens its session through `open` and renders the table frame; a practice session is released when the route
  goes away (the sandbox's lives for the page). By M8-C; M8-P8 finishes it.
-->
<script lang="ts">
  import type { TableSession } from '../../session/types';
  import type { GameStore } from '../../store/types';
  import TableFrame from '../table/TableFrame.svelte';
  import { leaveTable } from './leave';

  let {
    kind,
    code,
    open,
    release = undefined,
    games = null,
    go = (h: string) => (location.hash = h),
  }: {
    kind: 'practice' | 'sandbox';
    /** The room id; null in the sandbox. */
    code: string | null;
    open: () => Promise<TableSession>;
    /** Called with the session when the route goes away (a practice table disposes it). */
    release?: ((session: TableSession) => void) | undefined;
    games?: GameStore | null;
    go?: (hash: string) => void;
  } = $props();

  let session = $state.raw<TableSession | null>(null);
  let error = $state('');
  $effect(() => {
    let cancelled = false;
    let got: TableSession | null = null;
    open().then(
      (s) => {
        got = s;
        if (cancelled) release?.(s);
        else session = s;
      },
      (e: unknown) => {
        if (!cancelled) error = e instanceof Error ? e.message : String(e);
      },
    );
    return () => {
      cancelled = true;
      session = null;
      if (got) release?.(got);
    };
  });
</script>

{#if session}
  {@const s = session}
  <TableFrame session={s} {kind} {code} {games} gather={false} onleave={(c) => leaveTable({ session: s, kind, code, games, go, checkpointer: c?.checkpointer ?? null })} />
{:else if error}
  <main class="sp-page" data-testid="route-{kind}">
    <p role="alert">This table could not be opened: {error}</p>
    <p><a href="#/">Home</a></p>
  </main>
{/if}
