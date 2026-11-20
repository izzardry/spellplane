<!--
  The badge beside a seat's plate (persistence.md sections 2 and 7; contracts.md Part C `plateBadge`): `NOT SAVING` on
  the own plate when this browser cannot save, `RE-INVITE` on an away seat this viewer may bring back (a click opens the
  plate menu, where the link is made). Nothing otherwise. Implementer: M8-P5.
-->
<script lang="ts">
  import type { SeatId, TableState } from '../../core/types';
  import type { SaveState } from '../../session/types';
  import { seatMenuModel } from './presence';

  let { table, seat, me, saveState = 'saved', onopen }: { table: TableState; seat: SeatId; me: SeatId | null; saveState?: SaveState; onopen?: () => void } = $props();

  const kind = $derived.by((): 'notSaving' | 'reinvite' | null => {
    if (seat === me) return saveState === 'notSaving' ? 'notSaving' : null;
    const m = seatMenuModel(table, seat, me, { now: 0 });
    return m?.kind === 'away' && m.canBring ? 'reinvite' : null;
  });
</script>

{#if kind === 'notSaving'}
  <span class="ds-badge badge danger" data-testid="seat-badge" data-kind="notSaving" title="This browser is not saving. If you leave, your hand is lost.">NOT SAVING</span>
{:else if kind === 'reinvite'}
  <button type="button" class="ds-btn ds-btn--ghost ds-btn--xs" data-testid="seat-badge" data-kind="reinvite" onclick={() => onopen?.()}>RE-INVITE</button>
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
