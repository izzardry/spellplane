<!--
  Bringing a player back (journey.md 4.11; persistence.md section 7): makes the re-invite link (the `seatInvite`
  action; the log says `Ann made a link to bring Ben back.`) and shows it through the invite sheet (M8-P4's
  InviteSheet: QR code and link; plain while that component is a stub) with the state row, the footer `This link works
  once, for 24 hours, and only for Ben's seat.`, `MAKE A NEW LINK` and `Take the invite back`. Reopening shows the same
  link while it is open. When the player is back the row reads `Ben is here`, a toast says `Ben is back` and the sheet
  closes after 1.5 s. Used by the Gathering card and the seat menu. Implementer: M8-P5.
-->
<script lang="ts">
  import { onDestroy, onMount, untrack } from 'svelte';
  import type { SeatId, TableState } from '../../core/types';
  import type { SessionMuster } from '../../session/types';
  import InviteSheet from '../lobby/InviteSheet.svelte';
  import { notices } from '../table/notices';

  let {
    muster,
    table,
    seat,
    link: given = null,
    onclose = undefined,
  }: {
    muster: SessionMuster;
    table: TableState;
    seat: SeatId;
    /** A link this page already made for the seat; without one the component makes it when it opens. */
    link?: string | null;
    onclose?: (() => void) | undefined;
  } = $props();

  let link = $state<string | null>(untrack(() => given ?? muster.inviteLink?.(seat) ?? null));
  let busy = $state(false);
  let failure = $state('');
  let closing: ReturnType<typeof setTimeout> | null = null;

  const name = $derived(table.seats[seat]?.name || seat);
  const back = $derived(table.seats[seat]?.away !== true && link !== null);

  async function make(): Promise<void> {
    if (busy) return;
    busy = true;
    failure = '';
    try {
      link = await muster.invite(seat);
    } catch (e) {
      failure = (e instanceof Error ? e.message : String(e)).replace(/^refused: /, '').replace(/^\[[^\]]*\]\s*/, '');
    } finally {
      busy = false;
    }
  }

  async function takeBack(): Promise<void> {
    if (busy) return;
    busy = true;
    try {
      await muster.takeInviteBack(seat);
      link = null;
      onclose?.();
    } catch (e) {
      failure = (e instanceof Error ? e.message : String(e)).replace(/^refused: /, '').replace(/^\[[^\]]*\]\s*/, '');
    } finally {
      busy = false;
    }
  }

  onMount(() => {
    if (link === null) void make();
  });

  $effect(() => {
    if (!back || closing !== null) return;
    untrack(() => {
      notices.show(`${name} is back`);
      closing = setTimeout(() => onclose?.(), 1500);
    });
  });

  onDestroy(() => {
    if (closing !== null) clearTimeout(closing);
  });
</script>

<div class="bring" data-testid="seat-invite" data-seat={seat} data-link={link ?? ''}>
  {#if link}
    <InviteSheet
      title="Bring {name} back"
      text="Send {name} this link, or let them scan the code. It opens this game at their seat. If their browser still has the game, they get their hand back. If not, they sit down again and rebuild their library from their deck list."
      {link}
      status={back ? `● ${name} is here` : `○ Waiting for ${name}`}
    >
      {#snippet footer()}
        <p class="meta" data-testid="seat-invite-footer">This link works once, for 24 hours, and only for {name}'s seat.</p>
        <div class="row">
          <button type="button" class="ds-btn ds-btn--ghost ds-btn--xs" data-testid="seat-invite-new" disabled={busy} onclick={make}>MAKE A NEW LINK</button>
          <button type="button" class="ds-btn ds-btn--quiet ds-btn--xs" data-testid="seat-invite-back" disabled={busy} onclick={takeBack}>Take the invite back</button>
          {#if onclose}<button type="button" class="ds-btn ds-btn--quiet ds-btn--xs" data-testid="seat-invite-close" onclick={() => onclose?.()}>Close</button>{/if}
        </div>
      {/snippet}
    </InviteSheet>
  {:else}
    <p class="meta" role="status">{busy ? `Making a link for ${name}…` : ''}</p>
  {/if}
  {#if failure}
    <p class="meta danger" role="alert" data-testid="seat-menu-failure">{failure}</p>
    {#if !link && onclose}<button type="button" class="ds-btn ds-btn--quiet ds-btn--xs" onclick={() => onclose?.()}>Close</button>{/if}
  {/if}
</div>

<style>
  .bring {
    display: flex;
    flex-direction: column;
    gap: var(--ds-space-sm);
    min-width: 0;
    max-width: 420px;
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
  .row {
    display: flex;
    gap: var(--ds-space-sm);
    flex-wrap: wrap;
  }
</style>
