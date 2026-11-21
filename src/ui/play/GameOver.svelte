<!--
  The game-over overlay (journey.md 4.13), mounted by the table frame when TableState.result is set: the table under a
  flat scrim (never blurred: card faces are on it), VICTORY, DEFEAT or GAME OVER, the reason line, the players with
  their life, the rating change when the MatchRecord has one, the primary by the kind of game (FIND ANOTHER MATCH for a
  matched game, REMATCH = the existing next-game proposal for a private one, NEXT GAME for a draft night), HOME, and
  LOOK AT THE TABLE, which hides the overlay behind a RESULT chip that brings it back. A rematch another player proposed
  is answered here (ACCEPT / NOT NOW), since the overlay covers the HUD's prompt. M8-P4.
-->
<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import type { MatchRecord, TableState } from '../../core/types';
  import type { TableSession } from '../../session/types';
  import { paper } from '../../themes/paper/index';
  import Button from '../design/Button.svelte';
  import SeatGlyph from '../design/SeatGlyph.svelte';
  import StatusLine from '../design/StatusLine.svelte';
  import { openProposal } from '../flow/model';
  import { themeContext } from '../settings/theme';
  import { endKindOf, gameOverView, type EndKind } from '../lobby/waiting';

  let {
    session,
    onhome = undefined,
    kind = undefined,
    record = null,
    onfind = undefined,
  }: {
    session: TableSession;
    onhome?: (() => void) | undefined;
    /** The kind of game; default from the table (matched, draft night, else private). */
    kind?: EndKind | undefined;
    /** The game's MatchRecord, for the rating line. */
    record?: MatchRecord | null;
    /** FIND ANOTHER MATCH (the matchmaker's search with the same setup); default: Home. */
    onfind?: (() => void) | undefined;
  } = $props();

  const themeChoice = themeContext();
  let theme = $state.raw(themeChoice?.current() ?? paper);
  onMount(() => themeChoice?.subscribe((s) => (theme = s.theme)));
  const seatColours = $derived(theme.tokens.colours.seats);

  let st = $state.raw<TableState>(untrack(() => session.getState()));
  onMount(() => session.subscribe((s) => (st = s)));
  const me = untrack(() => session.seat);
  const seated = $derived(session.role !== 'spectator' && st.seats[me] !== undefined && (st.seats[me]!.peer !== undefined || st.seats[me]!.name !== ''));
  const rated = $derived(record?.rated ? { before: record.rated.before, after: record.rated.after } : null);
  // The turn the game ended on: kept from when this result came in, so LOOK AT THE TABLE and later turns leave the
  // reason line as it was (a plain cache, not state: it only follows the result's seq).
  let ended: { at: number; turn: number } | null = null;
  const endTurn = $derived.by(() => {
    const r = st.result;
    if (!r) return undefined;
    if (ended?.at !== r.atSeq) ended = { at: r.atSeq, turn: st.turn.number };
    return ended.turn;
  });
  const endKind = $derived(kind ?? endKindOf(st));
  const view = $derived(gameOverView(st, seated ? me : null, endKind, rated, endTurn));
  const proposal = $derived(openProposal(st));
  const mine = $derived(proposal ? (st.confirm?.responses[me] ?? null) : null);
  /** Who said NOT NOW (the round's holder), for the proposer's line. */
  const holderName = $derived.by(() => {
    const h = st.confirm?.holder;
    return h === undefined ? '' : h === me ? 'You' : st.seats[h]?.name || h;
  });
  let hidden = $state(false);
  let busy = $state(false);
  let note = $state('');

  async function propose(event: 'nextGame' | 'newDraft' = 'nextGame'): Promise<void> {
    if (!session.evening) {
      note = 'This table cannot start another game.';
      return;
    }
    busy = true;
    note = '';
    try {
      const moved = await session.evening.propose(event);
      // A NOT NOW is said by the declined line itself (the proposer may ask again).
      if (!moved && !openProposal(session.getState())?.held) note = 'The rematch did not go ahead.';
    } finally {
      busy = false;
    }
  }
  function primary(): void {
    if (!view) return;
    if (view.primary.id === 'findMatch') {
      if (onfind) onfind();
      else home();
      return;
    }
    void propose();
  }
  function respond(response: 'ok' | 'hold'): void {
    if (!proposal) return;
    try {
      session.dispatch({ type: 'respond', round: proposal.round, seat: me, response });
    } catch (e) {
      note = e instanceof Error ? e.message : String(e);
    }
  }
  function home(): void {
    if (onhome) onhome();
    else location.hash = '#/';
  }
  /** The dialog takes the focus when it opens (aria-modal); Escape hides it as LOOK AT THE TABLE does. */
  function dialog(node: HTMLElement): void {
    node.focus();
  }
</script>

{#if view}
  {#if hidden}
    <div class="chip-place ds-root">
      <Button size="sm" data-testid="result-chip" onclick={() => (hidden = false)}>RESULT</Button>
    </div>
  {:else}
    <div class="scrim ds-root" data-testid="game-over" data-headline={view.headline}>
      <div class="card" role="dialog" aria-modal="true" aria-labelledby="game-over-title" data-ds-layer="dialog" tabindex="-1" use:dialog onkeydown={(e) => e.key === 'Escape' && ((hidden = true), e.stopPropagation())}>
        <h1 id="game-over-title" class="headline" data-testid="game-over-headline">{view.headline}</h1>
        <p class="reason" data-testid="game-over-reason">{view.reason}</p>
        <ul class="players">
          {#each view.players as p (p.seat)}
            <li data-won={p.won}>
              <SeatGlyph seat={p.index} colour={seatColours[p.colour]?.colour ?? 'currentColor'} size={24} label="Seat colour of {p.name}" />
              <span class="ds-t-eyebrow">{p.name}</span>
              <span class="life">{p.life}</span>
            </li>
          {/each}
        </ul>
        {#if view.rating}<p class="ds-t-eyebrow" data-testid="game-over-rating">{view.rating}</p>{/if}
        {#if proposal && proposal.by !== me && !proposal.passed && mine !== 'ok' && seated}
          {#if mine === 'hold'}
            <!-- NOT NOW said: the proposer sees it and may ask again; ACCEPT still takes the rematch. -->
            <p class="reason" data-testid="rematch-ask">You said not now to {proposal.byName}'s {proposal.event === 'nextGame' ? 'rematch' : 'new draft'}.</p>
            <Button variant="primary" size="lg" data-testid="rematch-accept" onclick={() => respond('ok')}>ACCEPT</Button>
          {:else}
            <p class="reason" data-testid="rematch-ask">{proposal.byName} proposes {proposal.event === 'nextGame' ? 'a rematch' : 'a new draft'}.</p>
            <div class="row">
              <Button variant="primary" size="lg" data-testid="rematch-accept" onclick={() => respond('ok')}>ACCEPT</Button>
              {#if !proposal.held}<Button variant="quiet" size="lg" data-testid="rematch-decline" onclick={() => respond('hold')}>NOT NOW</Button>{/if}
            </div>
          {/if}
        {:else if proposal && !proposal.passed && proposal.held && proposal.by === me && seated}
          <!-- The proposer's round was declined: say so, and offer the primary again (a new ask replaces the round). -->
          <StatusLine data-testid="rematch-declined">{holderName} said not now.</StatusLine>
          <Button variant="primary" size="lg" waiting={busy} disabled={busy} data-testid="game-over-primary" data-action={view.primary.id} onclick={primary}>{view.primary.label}</Button>
        {:else if proposal && !proposal.passed}
          <StatusLine data-testid="rematch-waiting">{proposal.held ? 'Someone is holding the rematch.' : `Waiting for ${proposal.waiting.map((s) => (s === me ? 'you' : st.seats[s]?.name || s)).join(', ') || 'the others'} to answer.`}</StatusLine>
        {:else if seated}
          <Button variant="primary" size="lg" waiting={busy} disabled={busy} data-testid="game-over-primary" data-action={view.primary.id} onclick={primary}>{view.primary.label}</Button>
        {/if}
        <div class="row">
          {#if view.primary.id === 'findMatch' && seated}<Button variant="ghost" size="sm" data-testid="game-over-rematch" onclick={() => void propose()}>REMATCH</Button>{/if}
          {#if endKind === 'draft' && seated && !(proposal && !proposal.passed)}<Button variant="ghost" size="sm" data-testid="game-over-new-draft" onclick={() => void propose('newDraft')}>NEW DRAFT</Button>{/if}
          <Button variant="ghost" size="sm" data-testid="game-over-home" onclick={home}>HOME</Button>
          <Button variant="ghost" size="sm" data-testid="game-over-look" onclick={() => (hidden = true)}>LOOK AT THE TABLE</Button>
        </div>
        {#if note}<StatusLine data-testid="game-over-note">{note}</StatusLine>{/if}
      </div>
    </div>
  {/if}
{/if}

<style>
  /* A flat scrim: no blur and no filter; the table and its card faces stay as they are underneath. */
  .scrim {
    position: fixed;
    inset: 0;
    z-index: 90;
    display: grid;
    place-items: center;
    padding: var(--ds-space-lg);
    background: var(--ds-overlay);
    font-family: var(--ds-font-body);
    color: var(--ds-ink);
  }
  .card {
    display: grid;
    justify-items: center;
    gap: var(--ds-space-lg);
    padding: var(--ds-space-xxl);
    border-radius: var(--ds-radius-sheet);
    background: var(--ds-panel);
    box-shadow: var(--ds-elevation-dialog);
    max-width: 520px;
    text-align: center;
  }
  .headline {
    margin: 0;
    font-family: var(--ds-font-heading);
    font-size: var(--ds-type-display);
    font-weight: var(--ds-weight-regular);
    letter-spacing: 0.4em;
    padding-left: 0.4em;
  }
  .reason {
    margin: 0;
    font-size: var(--ds-type-body);
  }
  .players {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    gap: var(--ds-space-xl);
    flex-wrap: wrap;
    justify-content: center;
  }
  .players li {
    display: inline-flex;
    align-items: center;
    gap: var(--ds-space-sm);
  }
  .life {
    font-family: var(--ds-font-numeral);
    font-size: var(--ds-type-heading);
    font-variant-numeric: var(--ds-numeric);
  }
  .row {
    display: flex;
    gap: var(--ds-space-sm);
    flex-wrap: wrap;
    justify-content: center;
  }
  .chip-place {
    position: fixed;
    top: var(--ds-space-lg);
    left: 50%;
    transform: translateX(-50%);
    z-index: 90;
    font-family: var(--ds-font-body);
  }
</style>
