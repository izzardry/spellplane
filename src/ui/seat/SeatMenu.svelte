<!--
  The connection section at the top of a seat's plate menu (persistence.md section 7, "The seat menu"; journey.md
  4.11; contracts.md Part G "Rejoin"). Rendered by the frame into the HUD's `plateMenuTop`. Implementer: M8-P5.

  - Own seat: `Saved · 4 s ago` (or `Not saving`) and `Leave table`.
  - Another seat, here: `Here`.
  - Another seat, away: `Away for 3 min` and `BRING BEN BACK`, which sequences the invite and then shows the link in
    place (the QR code and sheet are M8-P4's InviteSheet; plain link text while it is a stub), with the footer
    `This link works once, for 24 hours, and only for Ben's seat.`, `MAKE A NEW LINK` and `Take the invite back`.
  - A team seat seen by an opponent: `Only Ben's teammate can bring Ben back.` A matched game: no bring-back at all.
-->
<script lang="ts">
  import { untrack } from 'svelte';
  import type { SeatId, TableState } from '../../core/types';
  import type { SessionMuster } from '../../session/types';
  import PresenceDot from '../design/PresenceDot.svelte';
  import BringBack from '../gather/BringBack.svelte';
  import { seatMenuModel, type Presence } from './presence';

  let {
    table,
    seat,
    me,
    muster,
    now = () => Date.now(),
    awaySince = null,
    savedAt = null,
    presence = undefined,
    onleave = undefined,
  }: {
    table: TableState;
    seat: SeatId;
    me: SeatId | null;
    muster: SessionMuster;
    now?: () => number;
    /** When this browser saw the seat away (ms epoch); null when unknown. */
    awaySince?: number | null;
    /** When this browser last saved (ms epoch). */
    savedAt?: number | null;
    presence?: Presence | undefined;
    onleave?: (() => void) | undefined;
  } = $props();

  // The link is shown in place once BRING … BACK was pressed, or at once when this page made an open one.
  let showing = $state(untrack(() => muster.inviteLink?.(seat) != null));
  // The menu opens fresh each time, so the times are read when it renders.
  const model = $derived(
    seatMenuModel(table, seat, me, {
      now: now(),
      awaySince: awaySince ?? muster.awaySince?.(seat) ?? null,
      savedAt: savedAt ?? muster.savedAt?.() ?? null,
      notSaving: muster.saveState() === 'notSaving',
      ...(presence ? { presence } : {}),
    }),
  );
</script>

{#if model}
  <div class="seat-menu" data-testid="seat-menu" data-seat={seat}>
    {#if model.kind === 'own'}
      <p class="line" class:danger={model.notSaving} data-testid="seat-menu-saved">{model.saved}</p>
      {#if onleave}<button type="button" class="ds-btn ds-btn--quiet ds-btn--sm" data-testid="seat-menu-leave" onclick={() => onleave?.()}>Leave table</button>{/if}
    {:else if model.kind === 'here'}
      <p class="line" data-testid="seat-menu-here"><PresenceDot state="here" label="Here" /></p>
    {:else}
      <p class="line" data-testid="seat-menu-away"><PresenceDot state="away" label={model.since ? `Away for ${model.since}` : 'Away'} /></p>
      {#if model.why}
        <p class="meta" data-testid="seat-menu-why">{model.why}</p>
      {:else if model.canBring}
        {#if showing}
          <BringBack {muster} {table} {seat} onclose={() => (showing = false)} />
        {:else}
          {#if model.invite}<p class="meta" data-testid="seat-menu-open">Invite open · made by {model.invite.by}</p>{/if}
          <button type="button" class="ds-btn ds-btn--primary ds-btn--sm full" data-testid="seat-menu-bring" onclick={() => (showing = true)}>BRING {model.name.toUpperCase()} BACK</button>
          {#if model.invite}
            <button type="button" class="ds-btn ds-btn--quiet ds-btn--sm" data-testid="seat-menu-take-back" onclick={() => void muster.takeInviteBack(seat).catch(() => undefined)}>Take the invite back</button>
          {/if}
        {/if}
      {/if}
    {/if}
  </div>
{/if}

<style>
  .seat-menu {
    display: flex;
    flex-direction: column;
    gap: var(--ds-space-sm);
    padding: var(--ds-space-sm) var(--ds-space-md);
    min-width: 0;
  }
  .line {
    margin: 0;
    display: flex;
    align-items: center;
    gap: var(--ds-space-sm);
    font-family: var(--ds-font-body);
    font-size: var(--ds-type-body);
    color: var(--ds-ink);
  }
  .meta {
    margin: 0;
    font-family: var(--ds-font-body);
    font-size: var(--ds-type-small);
    color: var(--ds-muted);
  }
  .danger {
    color: var(--ds-danger);
  }
  .full {
    width: 100%;
  }
</style>
