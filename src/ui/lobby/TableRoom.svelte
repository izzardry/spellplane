<!--
  A networked table (`#/t/<room>/<key>`): the lobby while the stage is 'lobby', the table HUD after the host started
  the game (DESIGN "Specification: card data, packs and draft formats", Evening stages; PLAN M1-P5). The HUD mounts
  once the stage leaves the lobby, so it sees the chair the player finally chose. In both stages the recovery panel
  (ui/recovery, PLAN M1-P7) offers the lost-save recovery to a player whose browser lacks its hidden cards.
-->
<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import type { CardDataSource, FaceSource } from '../../data/types';
  import type { CreateTableScene } from '../../scene/types';
  import type { SettingsStore } from '../../store/types';
  import { paper } from '../../themes/paper/index';
  import Hud from '../Hud.svelte';
  import { parsePlainList } from '../deck';
  import RecoveryPanel from '../recovery/RecoveryPanel.svelte';
  import type { LobbyProps } from '../types';
  import Lobby from './Lobby.svelte';

  let props: LobbyProps & { createScene: CreateTableScene; faces: FaceSource; cardData: CardDataSource; settings?: SettingsStore | undefined } = $props();

  let stage = $state(untrack(() => props.session.getState().stage));
  onMount(() => props.session.subscribe((s) => (stage = s.stage)));
</script>

{#if stage === 'lobby'}
  <Lobby session={props.session} game={props.game} link={props.link} identity={props.identity} decks={props.decks} cardData={props.cardData} parseDecklist={props.parseDecklist} />
{:else}
  <Hud session={props.session} createScene={props.createScene} faces={props.faces} cardData={props.cardData} game={props.game} theme={paper} settings={props.settings} parseDecklist={props.parseDecklist} />
{/if}

<RecoveryPanel session={props.session} cardData={props.cardData} parse={props.parseDecklist ?? parsePlainList} />
