<!--
  A networked table (`#/t/<room>/<key>`): the table frame (ui/table/TableFrame.svelte, contracts.md Part C) with
  `kind: 'room'` (the frame finds a MatchRecord itself and becomes a matched table), the room's link and the page's
  stores; leaving goes through ui/play/leave.ts. M8-C replaced the body with the frame (the stage switch, the recovery
  panel, the spectator parts and the notices moved into it); M8-P8 owns the file.
-->
<script lang="ts">
  import type { CardDataSource, FaceSource, SetDataSource } from '../../data/types';
  import type { CreateTableScene } from '../../scene/types';
  import type { GameStore, MatchStore, RatingStore, SettingsStore } from '../../store/types';
  import { leaveTable } from '../play/leave';
  import TableFrame from '../table/TableFrame.svelte';
  import type { LobbyProps } from '../types';
  import type { AppUpdate } from '../update';

  let props: LobbyProps & {
    createScene: CreateTableScene;
    faces: FaceSource;
    cardData: CardDataSource;
    settings?: SettingsStore | undefined;
    sets?: SetDataSource | undefined;
    update?: AppUpdate | undefined;
    games?: GameStore | null | undefined;
    matches?: MatchStore | null | undefined;
    ratings?: RatingStore | null | undefined;
    go?: ((hash: string) => void) | undefined;
  } = $props();
  const go = (h: string): void => (props.go ? props.go(h) : void (location.hash = h));
  const games = $derived(props.games ?? null);
</script>

<TableFrame
  session={props.session}
  kind="room"
  code={props.link.roomId}
  {games}
  link={props.link}
  deps={{
    createScene: props.createScene,
    faces: props.faces,
    cardData: props.cardData,
    game: props.game,
    settings: props.settings,
    parseDecklist: props.parseDecklist,
    sets: props.sets,
    update: props.update,
    identity: props.identity,
    decks: props.decks,
    matches: props.matches ?? null,
    ratings: props.ratings ?? null,
  }}
  onleave={(c) => leaveTable({ session: props.session, kind: 'room', code: props.link.roomId, key: props.link.roomKey, games, go, checkpointer: c?.checkpointer ?? null })}
/>
