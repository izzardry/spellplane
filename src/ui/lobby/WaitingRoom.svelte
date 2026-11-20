<!--
  The waiting room of a private table or a draft night (journey.md 4.8; matchmaking.md 2.12): seats, the deck slot,
  READY and the self-pressing START. Stub by M8-C: today's lobby (ui/lobby/Lobby.svelte), so every M1 lobby scenario
  keeps working. M8-P4 owns the file.
-->
<script lang="ts">
  import type { SettingsStore } from '../../store/types';
  import type { LobbyProps } from '../types';
  import Lobby from './Lobby.svelte';

  let { session, game, link, identity, decks, cardData, parseDecklist, settings: _settings = undefined }: LobbyProps & { settings?: SettingsStore | undefined } = $props();
</script>

<Lobby {session} {game} {link} {identity} {decks} {cardData} {parseDecklist} />
