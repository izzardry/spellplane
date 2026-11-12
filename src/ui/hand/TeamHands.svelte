<!--
  Every teammate's hand fan of a Two-Headed Giant table (DESIGN "Players, seats and formats", Two-Headed Giant), kept
  live from the session's team view (session/types.ts TeamControls): it re-reads the hands whenever the team view
  reports a change or the table changes (a card that left a hand disappears at once). M3-P2.
-->
<script lang="ts">
  import type { CardRef, InstanceId, TableState } from '../../core/types';
  import type { FaceSource } from '../../data/types';
  import type { TeamControls, TeammateHandCard } from '../../session/types';
  import TeamHand from './TeamHand.svelte';

  let {
    team,
    state: table,
    faces,
    vw,
    vh,
    oninspect,
  }: { team: TeamControls; state: TableState; faces: FaceSource; vw: number; vh: number; oninspect?: (id: InstanceId, ref: CardRef) => void } = $props();

  let version = $state(0);
  $effect(() => team.subscribe(() => version++));

  const hands = $derived.by((): { seat: string; cards: TeammateHandCard[] }[] => {
    void version;
    void table;
    return team.teammates().map((seat) => ({ seat, cards: team.hand(seat) }));
  });
</script>

{#each hands as h (h.seat)}
  <TeamHand
    seat={h.seat}
    state={table}
    cards={h.cards}
    {faces}
    {vw}
    {vh}
    inspect={(ref) => {
      const c = h.cards.find((x) => x.ref === ref);
      if (c) oninspect?.(c.id, ref);
    }}
  />
{/each}
