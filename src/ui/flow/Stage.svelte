<!--
  The stage switch of a networked table (DESIGN "Pre-game: draft, sealed and deck building": "an evening moves through
  four stages on one link: lobby, card acquisition (draft or sealed), deck building, match"; "Specification: card data,
  packs and draft formats", Evening stages). Every browser shows the stage of the shared state, so a stage change moves
  everyone at once, and a reload shows the stage the table is in:
  - lobby: the M1 lobby (chairs, constructed decks, "Start the game") beside the lobby settings and the draft start;
  - draft: the draft HUD (ui/draft, M2-P4) over the session's DraftControls;
  - build: the builder (ui/builder, M2-P5 and M2-P6), with the evening bar (who is not Ready yet, a new draft);
  - match: the table HUD, with the evening bar (next game, new draft).
  In every stage the audit panel (ui/audit, M5-P2) shows the verdicts of the games that ended.
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
  import Lobby from '../lobby/Lobby.svelte';
  import type { LobbyProps } from '../types';
  import EveningBar from './EveningBar.svelte';
  import AuditPanel from '../audit/AuditPanel.svelte';
  import { sessionAudit } from '../../session/audit';
  import LobbyDraft from './LobbyDraft.svelte';

  let props: LobbyProps & { createScene: CreateTableScene; faces: FaceSource; cardData: CardDataSource; settings?: SettingsStore | undefined; sets?: SetDataSource | undefined } = $props();

  let st = $state.raw<TableState>(untrack(() => props.session.getState()));
  onMount(() => props.session.subscribe((s) => (st = s)));
  const stage = $derived<StageId>(st.stage);
  const evening = $derived(props.session.evening);
  const draft = $derived(props.session.draft);
  // The post-game audit of a networked session (M5-P2, session/audit.ts); none in solo play or for a spectator.
  const audit = $derived(sessionAudit(props.session));
  // The viewer's theme (PLAN M4-P6), switchable mid-evening; Paper where no app shell provides the choice.
  const themeChoice = themeContext();
  let theme = $state.raw(themeChoice?.current() ?? paper);
  onMount(() => themeChoice?.subscribe((s) => (theme = s.theme)));
</script>

<div class="stage" data-testid="stage" data-stage={stage}>
  {#if stage === 'lobby'}
    <div class="lobby-stage" class:with-draft={!!(evening && props.sets)}>
      <div class="lobby-main">
        <Lobby session={props.session} game={props.game} link={props.link} identity={props.identity} decks={props.decks} cardData={props.cardData} parseDecklist={props.parseDecklist} />
      </div>
      {#if evening && props.sets}
        <div class="lobby-side">
          <LobbyDraft session={props.session} {evening} sets={props.sets} />
        </div>
      {/if}
    </div>
  {:else if stage === 'draft'}
    {#if draft}
      <DraftView session={props.session} {draft} createSurface={createDraftSurface} faces={props.faces} cardData={props.cardData} {theme} />
    {:else}
      <p class="unavailable" role="alert" data-testid="stage-unavailable">This browser has no set data, so it cannot draft.</p>
    {/if}
  {:else if stage === 'build'}
    {#if draft}
      {#key st.draft?.startSeq ?? -1}
        <BuilderView session={props.session} {draft} createSurface={createBuilderSurface} faces={props.faces} cardData={props.cardData} {theme} decks={props.decks} sets={props.sets} />
      {/key}
    {:else}
      <p class="unavailable" role="alert" data-testid="stage-unavailable">This browser has no set data, so it cannot build a deck here.</p>
    {/if}
  {:else}
    {#key st.games ?? 0}
      <Hud session={props.session} createScene={props.createScene} faces={props.faces} cardData={props.cardData} game={props.game} {theme} settings={props.settings} parseDecklist={props.parseDecklist} />
    {/key}
  {/if}
  {#if evening && (stage === 'build' || stage === 'match')}
    <div class="evening" class:in-match={stage === 'match'}>
      <EveningBar session={props.session} {evening} state={st} answer={stage !== 'match'} />
    </div>
  {/if}
  {#if audit}
    <!-- The post-game audit (M5-P2): opens by itself when a game ends, in whatever stage follows. -->
    <AuditPanel {audit} playing={stage === 'match'} />
  {/if}
</div>

<style>
  .stage {
    position: relative;
    height: 100%;
  }
  .lobby-stage {
    height: 100%;
    display: grid;
    grid-template-columns: minmax(0, 1fr);
  }
  .lobby-stage.with-draft {
    grid-template-columns: minmax(0, 1fr) minmax(300px, 380px);
  }
  .lobby-main {
    min-height: 0;
    height: 100%;
  }
  .lobby-side {
    min-height: 0;
    overflow-y: auto;
    padding: 24px 16px 48px 0;
    background: var(--sp-bg, #fff);
  }
  @media (max-width: 900px) {
    .lobby-stage.with-draft {
      grid-template-columns: minmax(0, 1fr);
      grid-template-rows: auto auto;
      height: auto;
      max-height: 100%;
      overflow-y: auto;
    }
    .lobby-main {
      height: auto;
    }
    .lobby-side {
      padding: 0 16px 48px;
    }
  }
  .evening {
    position: absolute;
    z-index: 20;
    left: 50%;
    transform: translateX(-50%);
    bottom: 12px;
  }
  /* In a match the bar sits in the bottom-left corner, below the own avatar, within the avatars' column (ui/hand.ts
     FIT_INSET.avatars, 190 px) so it stays clear of the hand fan: its buttons wrap rather than reach the fan (M5 gate). */
  .evening.in-match {
    left: 12px;
    transform: none;
    bottom: 12px;
    max-width: 166px;
  }
  .evening.in-match :global([data-testid='evening-bar']) {
    max-width: 166px;
    box-sizing: border-box;
  }
  .unavailable {
    margin: 48px auto;
    max-width: 40em;
    font-family: var(--sp-font);
  }
</style>
