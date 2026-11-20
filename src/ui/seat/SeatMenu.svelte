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
  import type { SeatId, TableState } from '../../core/types';
  import type { SessionMuster } from '../../session/types';
  import { seatMenuModel, type Presence } from './presence';

  let {
    table,
    seat,
    me,
    muster,
    now = () => Date.now(),
    awaySince = null,
    savedAt = null,
    presence,
    link: initialLink = null,
    onleave,
  }: {
    table: TableState;
    seat: SeatId;
    me: SeatId | null;
    muster: SessionMuster;
    now?: () => number;
    awaySince?: number | null;
    savedAt?: number | null;
    presence?: Presence;
    /** The link of an invite this page already made for the seat (it keeps the token in memory). */
    link?: string | null;
    onleave?: () => void;
  } = $props();

  let made = $state<string | null>(null);
  let busy = $state(false);
  let failure = $state('');
  const link = $derived(made ?? initialLink);
  const model = $derived(seatMenuModel(table, seat, me, { now: now(), awaySince, savedAt, notSaving: muster.saveState() === 'notSaving', ...(presence ? { presence } : {}) }));

  async function bring(): Promise<void> {
    if (busy) return;
    busy = true;
    failure = '';
    try {
      made = await muster.invite(seat);
    } catch (e) {
      failure = (e instanceof Error ? e.message : String(e)).replace(/^\[[^\]]*\]\s*/, '').replace(/^refused: (\[[^\]]*\]\s*)?/, '');
    } finally {
      busy = false;
    }
  }

  async function takeBack(): Promise<void> {
    busy = true;
    try {
      await muster.takeInviteBack(seat);
      made = null;
    } catch (e) {
      failure = e instanceof Error ? e.message : String(e);
    } finally {
      busy = false;
    }
  }
</script>

{#if model}
  <div class="seat-menu" data-testid="seat-menu" data-seat={seat}>
    {#if model.kind === 'own'}
      <p class="line" class:danger={model.notSaving} data-testid="seat-menu-saved">{model.saved}</p>
      <button type="button" class="ds-btn ds-btn--quiet ds-btn--sm" data-testid="seat-menu-leave" onclick={() => onleave?.()}>Leave table</button>
    {:else if model.kind === 'here'}
      <p class="line" data-testid="seat-menu-here"><span class="dot here" aria-hidden="true"></span>Here</p>
    {:else}
      <p class="line" data-testid="seat-menu-away"><span class="dot away" aria-hidden="true"></span>{model.since ? `Away for ${model.since}` : 'Away'}</p>
      {#if model.why}
        <p class="meta" data-testid="seat-menu-why">{model.why}</p>
      {:else if model.canBring}
        {#if link}
          <div class="invite" data-testid="seat-invite">
            <p class="eyebrow">Bring {model.name} back</p>
            <p class="meta">Send {model.name} this link, or let them scan the code. It opens this game at their seat.</p>
            <p class="link" data-testid="seat-invite-link">{link}</p>
            <p class="meta" data-testid="seat-invite-footer">This link works once, for 24 hours, and only for {model.name}'s seat.</p>
            <div class="row">
              <button type="button" class="ds-btn ds-btn--ghost ds-btn--xs" data-testid="seat-invite-new" disabled={busy} onclick={bring}>MAKE A NEW LINK</button>
              <button type="button" class="ds-btn ds-btn--quiet ds-btn--xs" data-testid="seat-invite-back" disabled={busy} onclick={takeBack}>Take the invite back</button>
            </div>
          </div>
        {:else}
          {#if model.invite}<p class="meta" data-testid="seat-menu-open">Invite open · made by {model.invite.by}</p>{/if}
          <button type="button" class="ds-btn ds-btn--primary ds-btn--sm full" data-testid="seat-menu-bring" disabled={busy} onclick={bring}>BRING {model.name.toUpperCase()} BACK</button>
        {/if}
      {/if}
      {#if failure}<p class="meta danger" role="alert" data-testid="seat-menu-failure">{failure}</p>{/if}
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
    font: var(--ds-type-body);
    color: var(--ds-ink);
  }
  .meta {
    margin: 0;
    font: var(--ds-type-small);
    color: var(--ds-muted);
  }
  .eyebrow {
    margin: 0;
    font: var(--ds-type-label);
    letter-spacing: var(--ds-label-spacing);
    text-transform: var(--ds-label-case);
    color: var(--ds-ink);
  }
  .danger {
    color: var(--ds-danger);
  }
  .dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    flex: none;
  }
  .dot.here {
    background: var(--ds-ink);
  }
  .dot.away {
    box-shadow: inset 0 0 0 1.5px var(--ds-muted);
  }
  .invite {
    display: flex;
    flex-direction: column;
    gap: var(--ds-space-xs);
  }
  .link {
    margin: 0;
    font: var(--ds-type-small);
    font-family: var(--ds-font-mono);
    color: var(--ds-ink);
    overflow-wrap: anywhere;
    user-select: all;
  }
  .row {
    display: flex;
    gap: var(--ds-space-sm);
    flex-wrap: wrap;
  }
  .full {
    width: 100%;
  }
</style>
