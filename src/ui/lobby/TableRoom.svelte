<!--
  A networked table (`#/t/<room>/<key>`): the stage switch (ui/flow/Stage.svelte, M2-P7: lobby, draft, builder, match;
  DESIGN "Specification: card data, packs and draft formats", Evening stages; PLAN M1-P5). In every stage the recovery
  panel (ui/recovery, PLAN M1-P7) offers the lost-save recovery to a player whose browser lacks its hidden cards.
-->
<script lang="ts">
  import type { CardDataSource, FaceSource, SetDataSource } from '../../data/types';
  import type { CreateTableScene } from '../../scene/types';
  import type { SettingsStore } from '../../store/types';
  import { parsePlainList } from '../deck';
  import Stage from '../flow/Stage.svelte';
  import RecoveryPanel from '../recovery/RecoveryPanel.svelte';
  import type { LobbyProps } from '../types';

  let props: LobbyProps & { createScene: CreateTableScene; faces: FaceSource; cardData: CardDataSource; settings?: SettingsStore | undefined; sets?: SetDataSource | undefined } = $props();
</script>

<Stage {...props} />

<RecoveryPanel session={props.session} cardData={props.cardData} parse={props.parseDecklist ?? parsePlainList} />
