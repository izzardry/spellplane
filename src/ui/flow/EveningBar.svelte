<!--
  The evening bar (DESIGN "Specification: card data, packs and draft formats", Evening stages): what the table waits
  for, and the proposals that leave a match ("next game", the rematch that returns to the builder to sideboard, or a
  "new draft" back to the lobby on the same link), confirmed by the others in a confirmation round. In a match the
  HUD's confirmation prompt answers the round; elsewhere (`answer`) the bar offers OK and Hold itself. Not modal.
-->
<script lang="ts">
  import type { FlowProps } from '../types';
  import { openProposal, PROPOSAL_LABELS, proposals, stageStatus } from './model';

  let { session, evening, state: table, answer = false }: FlowProps & { answer?: boolean } = $props();

  const me = $derived(session.seat);
  const status = $derived(stageStatus(table, me));
  const offers = $derived(proposals(table, me));
  const open = $derived(openProposal(table));
  const mine = $derived(open !== null && open.round === table.confirm?.id ? (table.confirm?.responses[me] ?? null) : null);
  const holding = $derived(table.confirm?.holder === me);
  let busy = $state(false);
  let note = $state('');

  async function propose(event: 'nextGame' | 'newDraft'): Promise<void> {
    busy = true;
    note = '';
    try {
      const moved = await evening.propose(event);
      if (!moved) note = event === 'nextGame' ? 'The next game did not go ahead.' : 'The new draft did not go ahead.';
    } finally {
      busy = false;
    }
  }

  function respond(response: 'ok' | 'hold' | 'release'): void {
    if (!open) return;
    session.dispatch({ type: 'respond', round: open.round, seat: me, response });
  }
</script>

<div class="bar" role="region" aria-label="Evening" data-testid="evening-bar" data-stage={table.stage}>
  {#if status}<p class="status" role="status" data-testid="evening-status">{status}</p>{/if}
  {#if note}<p class="status" role="status" data-testid="evening-note">{note}</p>{/if}
  {#if answer && open && open.by !== me && !open.passed}
    <span class="ask" data-testid="evening-answer">
      {#if holding}
        <button type="button" data-testid="evening-release" onclick={() => respond('release')}>Release</button>
      {:else if mine !== 'ok'}
        <button type="button" class="primary" data-testid="evening-ok" onclick={() => respond('ok')}>OK</button>
        <button type="button" data-testid="evening-hold" onclick={() => respond('hold')}>Hold</button>
      {/if}
    </span>
  {/if}
  {#each offers as event (event)}
    <button type="button" data-testid="propose-{event}" disabled={busy} onclick={() => propose(event)}>{PROPOSAL_LABELS[event]}</button>
  {/each}
</div>

<style>
  .bar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
    padding: 6px 10px;
    border: 1px solid var(--sp-border, #ccc);
    border-radius: var(--sp-radius-lg, 8px);
    background: var(--sp-surface, #fff);
    color: var(--sp-fg, #111);
    font-family: var(--sp-font);
    font-size: var(--sp-font-size, 14px);
    box-shadow: 0 1px 4px rgb(0 0 0 / 0.15);
    max-width: min(560px, calc(100vw - 32px));
  }
  .status {
    margin: 0;
  }
  .ask {
    display: inline-flex;
    gap: 6px;
  }
  button {
    font: inherit;
    padding: 4px 10px;
    border: 1px solid var(--sp-border, #ccc);
    border-radius: var(--sp-radius-md, 4px);
    background: var(--sp-bg, #fff);
    color: inherit;
    cursor: pointer;
  }
  button.primary {
    background: var(--sp-accent, #2b6cb0);
    border-color: var(--sp-accent, #2b6cb0);
    color: var(--sp-accent-fg, #fff);
  }
  button:disabled {
    opacity: 0.6;
    cursor: default;
  }
  button:focus-visible {
    outline: 2px solid var(--sp-focus, #2b6cb0);
    outline-offset: 2px;
  }
</style>
