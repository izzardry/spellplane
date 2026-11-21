<!--
  The "my save is lost" entry point (PLAN M1-P7; DESIGN "Multiplayer architecture", Resume and failure handling: "If a
  player loses their local save (cleared storage, different device), their hidden zones are gone. The recovery path is
  public and logged: the player re-imports the deck, the table subtracts every card of theirs that is currently public,
  and the remainder is committed and shuffled as a new library with a fresh hand count agreed by the table").

  Shown only to the player whose browser lacks its own hidden cards, or whose recovery is open: the proposed hand count,
  the deck re-import, and the confirmation round's state (who passed, who holds); after the commit, while the shuffle
  or the draws are still owed (a reload in between), the button that finishes them. The other players answer the round
  in the HUD's ordinary confirmation prompt ("new hand of 7?"). Not modal: the table stays live under it.
-->
<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import type { CardDataSource } from '../../data/types';
  import { canRecover, ownPublishedIds, recoveryProblem, recoveryStatus, type RecoveryStatus } from '../../session/resume';
  import type { DeckImport as Deck, TableSession } from '../../session/types';
  import DeckImport from '../DeckImport.svelte';
  import type { ParseDecklist } from '../deck';
  import { committedText, headline, libraryAfter, lostText, seatAnswers } from './model';

  let { session, cardData, parse }: { session: TableSession; cardData: CardDataSource; parse: ParseDecklist } = $props();

  const recoverable = untrack(() => canRecover(session));
  let st = $state.raw(untrack(() => session.getState()));
  let secrets = $state.raw(untrack(() => session.secrets()));
  let running = $state(false);
  /** A recovery of the session runs (also one the session resumed by itself after a reload). */
  let busy = $state(untrack(() => canRecover(session) && session.recovering()));
  let owed = $state.raw(untrack(() => (canRecover(session) ? session.recoveryOwed() : null)));
  /** Own cards whose identity the log published: holding one of them does not show that the save survived. */
  const publishedNow = (): Set<string> => ownPublishedIds(session.log().flatMap((e) => (e.kind === 'action' ? [e.action] : [])), session.seat);
  let published = $state.raw(untrack(publishedNow));
  let importing = $state(false);
  let failure = $state('');
  let done = $state<{ hand: number; library: number } | null>(null);
  let hand = $state<number | null>(null);

  onMount(() => {
    const follow = (): void => {
      st = session.getState();
      secrets = session.secrets();
      published = publishedNow();
      if (canRecover(session)) {
        busy = session.recovering();
        owed = session.recoveryOwed();
      }
    };
    const off = session.subscribe(follow);
    // A catch-up after a reload changes the state without an own action: follow the network status too.
    const offNet = session.subscribeNet(follow);
    return () => {
      off();
      offNet();
    };
  });

  const status: RecoveryStatus = $derived(recoveryStatus(st, secrets, session.seat, owed, published));
  const title = $derived(headline(status, running || busy));
  const answers = $derived(seatAnswers(status, st.seats));
  const count = $derived(hand ?? status.hand);
  const canStart = $derived(!running && !busy && (status.phase === 'lost' || status.phase === 'agreed' || (status.phase === 'proposed' && status.round !== null && (!status.round.current || status.round.holder !== null || count !== status.hand))));
  const visible = $derived(recoverable && (title !== null || done !== null || failure !== ''));

  async function start(deck: Deck): Promise<void> {
    if (!canRecover(session)) return;
    const n = count;
    // An open proposal of the same count in the current round is finished, not proposed again (session/net.ts).
    const same = st.seats[session.seat]?.recovering?.hand === n && status.round?.current === true;
    if (!same) {
      const problem = recoveryProblem(session.getState(), session.seat, deck.main, n);
      if (problem !== null) throw new Error(problem);
    }
    failure = '';
    done = null;
    running = true;
    session.recover(deck, n).then(
      () => {
        running = false;
        hand = null;
        const s = session.getState();
        done = { hand: s.zones[`hand:${session.seat}`]?.ids.length ?? 0, library: s.zones[`library:${session.seat}`]?.ids.length ?? 0 };
      },
      (e: unknown) => {
        running = false;
        failure = e instanceof Error ? e.message : String(e);
      },
    );
  }

  function finish(): void {
    if (!canRecover(session)) return;
    failure = '';
    done = null;
    running = true;
    session.finishRecovery().then(
      () => {
        running = false;
        const s = session.getState();
        done = { hand: s.zones[`hand:${session.seat}`]?.ids.length ?? 0, library: s.zones[`library:${session.seat}`]?.ids.length ?? 0 };
      },
      (e: unknown) => {
        running = false;
        failure = e instanceof Error ? e.message : String(e);
      },
    );
  }

  function setHand(v: string): void {
    const n = Number(v);
    hand = Number.isInteger(n) ? Math.max(0, Math.min(status.maxHand, n)) : null;
  }
</script>

{#if visible && !importing}
  <aside class="recovery ds-root" data-ds-layer="sheet" data-testid="recovery" data-phase={status.phase} data-running={running || busy} aria-live="polite">
    {#if title}<h2 data-testid="recovery-title">{title}</h2>{/if}

    {#if status.phase === 'lost' && !running}
      <p data-testid="recovery-lost">{lostText(status)}</p>
    {/if}

    {#if status.round && status.round.current && status.phase !== 'none'}
      <ul class="answers" data-testid="recovery-round" data-round={status.round.id} data-agreed={status.round.agreed}>
        {#each answers as a (a.seat)}
          <li data-testid="recovery-answer" data-seat={a.seat} data-state={a.state}>
            <span class="name">{a.name}</span>
            <span class="state">{a.state === 'ok' ? 'OK' : a.state === 'holding' ? 'holds' : 'waiting…'}</span>
          </li>
        {/each}
      </ul>
    {/if}

    {#if canStart}
      <div class="row">
        <label>
          New hand
          <input
            class="ds-input"
            type="number"
            min="0"
            max={status.maxHand}
            value={count}
            data-testid="recovery-hand"
            oninput={(e) => setHand((e.currentTarget as HTMLInputElement).value)}
          />
          cards
        </label>
        <span class="muted" data-testid="recovery-sizes">
          Deck {status.deckSize} − {status.publicCards} on the table − {count} in hand = library {libraryAfter(status, count)}
        </span>
      </div>
      <div class="row">
        <button type="button" class="ds-btn ds-btn--primary ds-btn--sm" data-testid="recovery-start" onclick={() => (importing = true)}>
          {status.phase === 'agreed' && count === status.hand ? 'Re-import deck and finish' : 'Re-import deck and propose'}
        </button>
      </div>
    {/if}

    {#if status.phase === 'committed' && !running && !busy}
      <p data-testid="recovery-committed">{committedText(status)}</p>
      <div class="row">
        <button type="button" class="ds-btn ds-btn--primary ds-btn--sm" data-testid="recovery-finish" onclick={finish}>Finish recovery</button>
      </div>
    {/if}

    {#if failure}<p class="error" data-testid="recovery-error">{failure}</p>{/if}
    {#if done && status.phase === 'none' && !running}
      <p data-testid="recovery-done">
        Recovered: a new library of {done.library} and a hand of {done.hand}.
        <button type="button" class="ds-btn ds-btn--quiet ds-btn--xs" aria-label="Dismiss" onclick={() => (done = null)}>×</button>
      </p>
    {/if}
  </aside>
{/if}

{#if importing}
  <div data-testid="recovery-import">
    <DeckImport {cardData} {parse} onimport={start} onclose={() => (importing = false)} />
  </div>
{/if}

<style>
  /* Swept to the kit (contracts.md Part G "Visual" item 4): kit buttons and heights, --ds-* variables; not restructured. */
  .recovery {
    /* Top left under the table's tools, clear of the opponent's plate at the top centre (gate M8 finding F19). */
    position: fixed;
    z-index: 64;
    top: calc(var(--ds-edge, 16px) + var(--ds-control-md, 44px) + var(--ds-space-md, 12px));
    left: var(--ds-edge, 16px);
    width: min(420px, calc(100vw - 32px));
    box-sizing: border-box;
    background: var(--ds-panel);
    color: var(--ds-ink);
    box-shadow: var(--ds-elevation-pop);
    border-left: 4px solid var(--ds-danger);
    border-radius: var(--ds-radius-sheet);
    padding: var(--ds-space-md) var(--ds-space-lg);
    font: var(--ds-type-small);
  }
  h2 {
    margin: 0 0 var(--ds-space-sm);
    font: var(--ds-type-title);
  }
  p {
    margin: var(--ds-space-xs) 0;
  }
  .answers {
    list-style: none;
    padding: 0;
    margin: var(--ds-space-sm) 0;
    display: flex;
    flex-wrap: wrap;
    gap: var(--ds-space-xs) var(--ds-space-lg);
  }
  .answers li {
    display: flex;
    gap: var(--ds-space-sm);
  }
  .name {
    font-weight: var(--ds-weight-bold);
  }
  li[data-state='holding'] .state {
    color: var(--ds-danger);
  }
  .row {
    display: flex;
    flex-wrap: wrap;
    gap: var(--ds-space-sm);
    align-items: center;
    margin-top: var(--ds-space-sm);
  }
  .ds-input {
    box-sizing: border-box;
    width: 5em;
    height: 36px;
    margin: 0 var(--ds-space-xs);
    padding: 0 var(--ds-space-sm);
    border: none;
    border-radius: var(--ds-radius-sm);
    background: var(--ds-chip);
    color: var(--ds-ink);
    font: var(--ds-type-body);
  }
  .muted {
    color: var(--ds-muted);
  }
  .error {
    color: var(--ds-danger);
  }
</style>
