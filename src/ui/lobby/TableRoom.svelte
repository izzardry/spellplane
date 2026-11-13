<!--
  A networked table (`#/t/<room>/<key>`): the stage switch (ui/flow/Stage.svelte, M2-P7: lobby, draft, builder, match;
  DESIGN "Specification: card data, packs and draft formats", Evening stages; PLAN M1-P5). In every stage the recovery
  panel (ui/recovery, PLAN M1-P7) offers the lost-save recovery to a player whose browser lacks its hidden cards.
  A spectator's session (`#/t/<room>/<key>/watch`, M3-P5) gets the spectator view instead; a player sees who watches
  and may show them the hand (DESIGN "Players, seats and formats", Spectators).
-->
<script lang="ts">
  import { untrack } from 'svelte';
  import type { CardDataSource, FaceSource, SetDataSource } from '../../data/types';
  import type { CreateTableScene } from '../../scene/types';
  import type { SettingsStore } from '../../store/types';
  import { parsePlainList } from '../deck';
  import Stage from '../flow/Stage.svelte';
  import RecoveryPanel from '../recovery/RecoveryPanel.svelte';
  import type { LobbyProps } from '../types';
  import SpectatorPanel from './SpectatorPanel.svelte';
  import SpectatorView from './SpectatorView.svelte';
  import VersionNotice from '../version/VersionNotice.svelte';

  let props: LobbyProps & { createScene: CreateTableScene; faces: FaceSource; cardData: CardDataSource; settings?: SettingsStore | undefined; sets?: SetDataSource | undefined } = $props();
  let stage = $state(untrack(() => props.session.getState().stage));
  $effect(() => props.session.subscribe((s) => (stage = s.stage)));
</script>

{#if props.session.role === 'spectator'}
  <SpectatorView {...props} />
{:else}
  <Stage {...props} />

  <RecoveryPanel session={props.session} cardData={props.cardData} parse={props.parseDecklist ?? parsePlainList} />

  {#if stage !== 'lobby'}<SpectatorPanel session={props.session} />{/if}
{/if}

<VersionNotice session={props.session} />
