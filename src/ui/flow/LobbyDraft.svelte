<!--
  The draft side of the lobby (DESIGN "Pre-game: draft, sealed and deck building", Lobby settings): the lobby settings
  panel (ui/draft, M2-P4). The start belongs to the waiting room (ui/lobby/WaitingRoom.svelte: START THE DRAFT, START
  WITH n PLAYERS), so a draft night has one start and one filled button (decision M8-P8).
-->
<script lang="ts">
  import type { SetDataSource } from '../../data/types';
  import type { EveningControls, TableSession } from '../../session/types';
  import { LobbySettingsPanel } from '../draft/index';

  let { session, evening, sets }: { session: TableSession; evening: EveningControls; sets: SetDataSource } = $props();
</script>

<aside class="draft-side" aria-label="Draft" data-testid="lobby-draft">
  <LobbySettingsPanel {session} {evening} {sets} />
</aside>

<style>
  .draft-side {
    display: grid;
    gap: var(--ds-space-md);
    align-content: start;
    min-width: 0;
  }
</style>
