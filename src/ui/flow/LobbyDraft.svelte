<!--
  The draft side of the lobby (DESIGN "Pre-game: draft, sealed and deck building", Lobby settings; "Specification:
  card data, packs and draft formats", Evening stages: the host advances from the lobby): the lobby settings panel
  (ui/draft, M2-P4) and, when the host chose a draft or sealed, the button that starts it for everyone at once. The
  M1 lobby beside it keeps the constructed path (decks, Ready, "Start the game").
-->
<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import type { TableState } from '../../core/types';
  import type { SetDataSource } from '../../data/types';
  import type { EveningControls, TableSession } from '../../session/types';
  import { LobbySettingsPanel } from '../draft/index';
  import { draftStart } from './model';

  let { session, evening, sets }: { session: TableSession; evening: EveningControls; sets: SetDataSource } = $props();

  let st = $state.raw<TableState>(untrack(() => session.getState()));
  onMount(() => session.subscribe((s) => (st = s)));
  const start = $derived(draftStart(st, session.seat));
</script>

<aside class="draft-side" aria-label="Draft" data-testid="lobby-draft">
  <LobbySettingsPanel {session} {evening} {sets} />
  {#if start}
    <div class="start" data-testid="draft-start-bar">
      {#if start.problem}
        <p class="muted" data-testid="draft-start-blocked">{start.problem}</p>
      {:else}
        <button type="button" class="primary" data-testid="start-draft" onclick={() => evening.start()}>{start.label}</button>
      {/if}
    </div>
  {/if}
</aside>

<style>
  .draft-side {
    display: grid;
    gap: var(--sp-space-lg, 16px);
    align-content: start;
    min-width: 0;
  }
  .start {
    padding: var(--sp-space-lg, 16px);
    border: 1px solid var(--sp-border, #ccc);
    border-radius: var(--sp-radius-lg, 8px);
    background: var(--sp-surface, #fff);
    font-family: var(--sp-font);
  }
  .muted {
    margin: 0;
    color: var(--sp-muted, #555);
  }
  button.primary {
    font: inherit;
    padding: 8px 16px;
    border-radius: var(--sp-radius-md, 4px);
    border: 1px solid var(--sp-accent, #2b6cb0);
    background: var(--sp-accent, #2b6cb0);
    color: var(--sp-accent-fg, #fff);
    cursor: pointer;
  }
  button:focus-visible {
    outline: 2px solid var(--sp-focus, #2b6cb0);
    outline-offset: 2px;
  }
</style>
