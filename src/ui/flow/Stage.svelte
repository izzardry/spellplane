<!--
  The stage switch of a networked table (DESIGN "Pre-game: draft, sealed and deck building": "an evening moves through
  four stages on one link: lobby, card acquisition (draft or sealed), deck building, match"; "Specification: card data,
  packs and draft formats", Evening stages). Every browser shows the stage of the shared state, so a stage change moves
  everyone at once, and a reload shows the stage the table is in:
  - lobby: the M1 lobby (chairs, constructed decks, "Start the game") beside the lobby settings and the draft start;
  - draft: the draft HUD (ui/draft, M2-P4) over the session's DraftControls;
  - build: the builder (ui/builder, M2-P5 and M2-P6), with the evening bar (who is not Ready yet, a new draft);
  - match: the table HUD; the evening's "Next game" and "New draft" are in its Menu's "This game" group (journey.md
    4.10, gate M8 finding F6) and on the game-over overlay (journey.md 4.13), not in a bar over the table.
  In every stage the audit panel (ui/audit, M5-P2) shows the verdicts of the games that ended.
  M8-C: the lobby stage mounts the waiting room (ui/lobby/WaitingRoom.svelte, M8-P4) and the HUD gets the table frame's
  shell props (`shell`, contracts.md Part C).
-->
<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import type { Stage as StageId, TableState } from '../../core/types';
  import type { CardDataSource, FaceSource, SetDataSource } from '../../data/types';
  import { createBuilderSurface, createDraftSurface } from '../../scene/index';
  import type { CreateTableScene } from '../../scene/types';
  import type { SettingsStore } from '../../store/types';
  import { paper } from '../../themes/paper/index';
  import { themeContext } from '../settings/theme';
  import Hud from '../Hud.svelte';
  import { BuilderView } from '../builder/index';
  import { DraftView } from '../draft/index';
  import WaitingRoom from '../lobby/WaitingRoom.svelte';
  import { roomStarter, roomStarterPool } from '../lobby/starter';
  import type { HudShellProps } from '../props';
  import type { LobbyProps } from '../types';
  import EveningBar from './EveningBar.svelte';
  import AuditPanel from '../audit/AuditPanel.svelte';
  import { sessionAudit } from '../../session/audit';
  import LobbyDraft from './LobbyDraft.svelte';

  let props: LobbyProps & {
    createScene: CreateTableScene;
    faces: FaceSource;
    cardData: CardDataSource;
    settings?: SettingsStore | undefined;
    sets?: SetDataSource | undefined;
    /** What the table frame tells the HUD (M8-C; contracts.md Part C). */
    shell?: HudShellProps | undefined;
  } = $props();

  let st = $state.raw<TableState>(untrack(() => props.session.getState()));
  onMount(() => props.session.subscribe((s) => (st = s)));
  // USE A STARTER DECK in the waiting room: M8-P6's generator over the table's card source (M8-P4 fix).
  const starter = $derived(roomStarter(roomStarterPool(props.cardData)));
  const stage = $derived<StageId>(st.stage);
  // The viewer's seat, read again with every state (K1, gate M8 round 4): the draft, the builder and the HUD (its hand
  // fan, plates and scene camera) are mounted per seat, so a claim or a take-over mounts them again for the new seat.
  const viewer = $derived.by(() => {
    void st;
    return props.session.seat;
  });
  const evening = $derived(props.session.evening);
  const draft = $derived(props.session.draft);
  // The post-game audit of a networked session (M5-P2, session/audit.ts); none in solo play or for a spectator.
  const audit = $derived(sessionAudit(props.session));
  // The viewer's theme (PLAN M4-P6), switchable mid-evening; Paper where no app shell provides the choice.
  const themeChoice = themeContext();
  let theme = $state.raw(themeChoice?.current() ?? paper);
  onMount(() => themeChoice?.subscribe((s) => (theme = s.theme)));
</script>

{#snippet draftRules()}
  {#if evening && props.sets}<LobbyDraft session={props.session} {evening} sets={props.sets} />{/if}
{/snippet}

<div class="stage" data-testid="stage" data-stage={stage}>
  {#if stage === 'lobby'}
    <!-- The table's rules (draft mode, packs, sets, timers) are the waiting room's side column, under the invitation
         (board 5; gate M8 finding F5), not a separate strip beside the room. -->
    <div class="lobby-stage">
      <WaitingRoom session={props.session} game={props.game} link={props.link} identity={props.identity} decks={props.decks} cardData={props.cardData} parseDecklist={props.parseDecklist} settings={props.settings} faces={props.faces} onleave={props.shell?.onleave} {starter} rules={evening && props.sets ? draftRules : undefined} />
    </div>
  {:else if stage === 'draft'}
    {#if draft}
      {#key viewer}
        <DraftView session={props.session} {draft} createSurface={createDraftSurface} faces={props.faces} cardData={props.cardData} {theme} />
      {/key}
    {:else}
      <p class="unavailable" role="alert" data-testid="stage-unavailable">This browser has no set data, so it cannot draft.</p>
    {/if}
  {:else if stage === 'build'}
    {#if draft}
      {#key `${st.draft?.startSeq ?? -1}:${viewer}`}
        <BuilderView session={props.session} {draft} createSurface={createBuilderSurface} faces={props.faces} cardData={props.cardData} {theme} decks={props.decks} sets={props.sets} />
      {/key}
    {:else}
      <p class="unavailable" role="alert" data-testid="stage-unavailable">This browser has no set data, so it cannot build a deck here.</p>
    {/if}
  {:else}
    {#key `${st.games ?? 0}:${viewer}`}
      <Hud session={props.session} createScene={props.createScene} faces={props.faces} cardData={props.cardData} game={props.game} {theme} settings={props.settings} parseDecklist={props.parseDecklist} {evening} {...props.shell ?? {}} />
    {/key}
  {/if}
  {#if evening && stage === 'build'}
    <div class="evening">
      <EveningBar session={props.session} {evening} state={st} answer />
    </div>
  {/if}
  {#if audit}
    <!-- The post-game audit (M5-P2): opens by itself when a game ends, in whatever stage follows. -->
    <AuditPanel {audit} playing={stage === 'match'} lobby={stage === 'lobby'} />
  {/if}
</div>

<style>
  .stage {
    position: relative;
    height: 100%;
  }
  .lobby-stage {
    height: 100%;
  }
  .evening {
    position: absolute;
    z-index: 20;
    left: 50%;
    transform: translateX(-50%);
    bottom: 12px;
  }
  .unavailable {
    margin: 48px auto;
    max-width: 40em;
    font-family: var(--sp-font);
  }
</style>
