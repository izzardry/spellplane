<!--
  The evening bar (DESIGN "Specification: card data, packs and draft formats", Evening stages): what the table waits
  for, and the proposals that leave a match ("next game", the rematch that returns to the builder to sideboard, or a
  "new draft" back to the lobby on the same link), confirmed by the others in a confirmation round. In a match the
  HUD's confirmation prompt answers the round; elsewhere (`answer`) the bar offers OK and Hold itself. Not modal.
-->
<script lang="ts">
  import Button from '../design/Button.svelte';
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
        <Button size="xs" data-testid="evening-release" onclick={() => respond('release')}>Release</Button>
      {:else if mine !== 'ok'}
        <Button variant="secondary" size="xs" data-testid="evening-ok" onclick={() => respond('ok')}>OK</Button>
        <Button size="xs" data-testid="evening-hold" onclick={() => respond('hold')}>Hold</Button>
      {/if}
    </span>
  {/if}
  {#each offers as event (event)}
    <Button size="xs" data-testid="propose-{event}" disabled={busy} onclick={() => propose(event)}>{PROPOSAL_LABELS[event]}</Button>
  {/each}
</div>

<style>
  /* Swept to the kit (contracts.md Part G "Visual" item 4): kit buttons at 28 px, the kit's surface and type. */
  .bar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--ds-space-sm, 8px);
    padding: var(--ds-space-xs, 4px) var(--ds-space-sm, 8px) var(--ds-space-xs, 4px) var(--ds-space-md, 12px);
    border-radius: var(--ds-radius-card, 12px);
    background: var(--ds-panel, var(--sp-surface));
    color: var(--ds-ink, var(--sp-fg));
    font-family: var(--ds-font-body, var(--sp-font));
    font-size: var(--ds-type-small, 12px);
    box-shadow: var(--ds-elevation-raised, none);
    max-width: min(560px, calc(100vw - 32px));
  }
  .status {
    margin: 0;
  }
  .ask {
    display: inline-flex;
    gap: var(--ds-space-xs, 4px);
  }
</style>
