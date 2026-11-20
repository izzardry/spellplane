<!--
  The badge on a player plate (journey.md 4.10; persistence.md sections 2 and 7; contracts.md Part C `plateBadge`):
  `NOT SAVING` on the own plate when this browser cannot save (the session's save state), `RE-INVITE` on an away seat
  this viewer may bring back (a click opens the plate menu, where the link is made), `SEAT MOVED` on a seat a new
  browser took over. Nothing otherwise. Implementer: M8-P5.
-->
<script lang="ts">
  import { onDestroy } from 'svelte';
  import type { SeatId, TableState } from '../../core/types';
  import type { SaveState } from '../../session/types';
  import { activeMuster, onActiveMuster } from '../gather/active';
  import { seatMenuModel } from './presence';

  let {
    table,
    seat,
    me,
    saveState = undefined,
    onopen = undefined,
  }: {
    table: TableState;
    seat: SeatId;
    me: SeatId | null;
    /** This browser's save state; by default the table on screen's (Gathering registers it). */
    saveState?: SaveState | undefined;
    onopen?: (() => void) | undefined;
  } = $props();

  let tick = $state(0);
  const off = onActiveMuster(() => tick++);
  onDestroy(off);

  const saving = $derived.by((): SaveState => {
    void tick;
    void table;
    return saveState ?? activeMuster()?.saveState() ?? 'saved';
  });

  const kind = $derived.by((): 'notSaving' | 'reinvite' | 'moved' | null => {
    if (seat === me) return saving === 'notSaving' ? 'notSaving' : null;
    const m = seatMenuModel(table, seat, me, { now: 0 });
    if (m?.kind === 'away' && m.canBring) return 'reinvite';
    if (m?.kind === 'here' && (table.seats[seat]?.takeovers ?? 0) > 0) return 'moved';
    return null;
  });
</script>

{#if kind === 'notSaving'}
  <span class="ds-badge badge danger" data-testid="seat-badge" data-kind="notSaving" title="This browser is not saving. If you leave, your hand is lost.">NOT SAVING</span>
{:else if kind === 'reinvite'}
  {#if onopen}
    <button type="button" class="ds-btn ds-btn--ghost ds-btn--xs" data-testid="seat-badge" data-kind="reinvite" onclick={() => onopen?.()}>RE-INVITE</button>
  {:else}
    <span class="ds-badge badge" data-testid="seat-badge" data-kind="reinvite">RE-INVITE</span>
  {/if}
{:else if kind === 'moved'}
  <span class="ds-badge badge" data-testid="seat-badge" data-kind="moved" title="A new browser took this seat over.">SEAT MOVED</span>
{/if}

<style>
  .badge {
    display: inline-flex;
    align-items: center;
    min-height: 20px;
    padding: 0 var(--ds-space-sm);
    border-radius: var(--ds-radius-pill);
    font: var(--ds-type-label);
    letter-spacing: var(--ds-label-spacing);
    background: var(--ds-badge);
    color: var(--ds-badge-ink);
  }
  .danger {
    background: var(--ds-danger);
    color: var(--ds-on-ink);
  }
</style>
