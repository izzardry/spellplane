<!--
  The "my save is lost" entry point (PLAN M1-P7; DESIGN "Multiplayer architecture", Resume and failure handling: "If a
  player loses their local save (cleared storage, different device), their hidden zones are gone. The recovery path is
  public and logged: the player re-imports the deck, the table subtracts every card of theirs that is currently public,
  and the remainder is committed and shuffled as a new library with a fresh hand count agreed by the table").

  Shown only to the player whose browser lacks its own hidden cards, or whose recovery is open: the proposed hand count,
  the deck re-import, and the confirmation round's state (who passed, who holds). The other players answer the round
  in the HUD's ordinary confirmation prompt ("new hand of 7?"). Not modal: the table stays live under it.
-->
<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import type { CardDataSource } from '../../data/types';
  import { canRecover, recoveryProblem, recoveryStatus, type RecoveryStatus } from '../../session/resume';
  import type { DeckImport as Deck, TableSession } from '../../session/types';
  import DeckImport from '../DeckImport.svelte';
  import type { ParseDecklist } from '../deck';
  import { headline, libraryAfter, lostText, seatAnswers } from './model';

  let { session, cardData, parse }: { session: TableSession; cardData: CardDataSource; parse: ParseDecklist } = $props();

  const recoverable = untrack(() => canRecover(session));
  let st = $state.raw(untrack(() => session.getState()));
  let secrets = $state.raw(untrack(() => session.secrets()));
  let running = $state(false);
  let importing = $state(false);
  let failure = $state('');
  let done = $state<{ hand: number; library: number } | null>(null);
  let hand = $state<number | null>(null);

  onMount(() => {
    const off = session.subscribe((s) => {
      st = s;
      secrets = session.secrets();
    });
    // A catch-up after a reload changes the state without an own action: follow the network status too.
    const offNet = session.subscribeNet(() => {
      st = session.getState();
      secrets = session.secrets();
    });
    return () => {
      off();
      offNet();
    };
  });

  const status: RecoveryStatus = $derived(recoveryStatus(st, secrets, session.seat));
  const title = $derived(headline(status, running));
  const answers = $derived(seatAnswers(status, st.seats));
  const count = $derived(hand ?? status.hand);
  const canStart = $derived(!running && (status.phase === 'lost' || status.phase === 'agreed' || (status.phase === 'proposed' && status.round !== null && (!status.round.current || status.round.holder !== null || count !== status.hand))));
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

  function setHand(v: string): void {
    const n = Number(v);
    hand = Number.isInteger(n) ? Math.max(0, Math.min(status.maxHand, n)) : null;
  }
</script>

{#if visible && !importing}
  <aside class="recovery" data-testid="recovery" data-phase={status.phase} data-running={running} aria-live="polite">
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
        <button type="button" class="primary" data-testid="recovery-start" onclick={() => (importing = true)}>
          {status.phase === 'agreed' && count === status.hand ? 'Re-import deck and finish' : 'Re-import deck and propose'}
        </button>
      </div>
    {/if}

    {#if failure}<p class="error" data-testid="recovery-error">{failure}</p>{/if}
    {#if done && status.phase === 'none' && !running}
      <p data-testid="recovery-done">
        Recovered: a new library of {done.library} and a hand of {done.hand}.
        <button type="button" class="close" aria-label="Dismiss" onclick={() => (done = null)}>×</button>
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
  .recovery {
    position: fixed;
    z-index: 64;
    top: 56px;
    left: 50%;
    transform: translateX(-50%);
    width: min(560px, 92vw);
    box-sizing: border-box;
    background: var(--sp-surface, #fff);
    color: var(--sp-fg, #111);
    border: 1px solid var(--sp-danger, #b3261e);
    border-radius: var(--sp-radius-lg, 8px);
    padding: 10px 14px;
    font: var(--sp-font-size-small, 12px) / 1.45 var(--sp-font, system-ui);
  }
  h2 {
    margin: 0 0 6px;
    font-size: var(--sp-font-size, 14px);
  }
  p {
    margin: 4px 0;
  }
  .answers {
    list-style: none;
    padding: 0;
    margin: 6px 0;
    display: flex;
    flex-wrap: wrap;
    gap: 6px 14px;
  }
  .answers li {
    display: flex;
    gap: 6px;
  }
  .name {
    font-weight: var(--sp-font-weight-bold, 600);
  }
  li[data-state='holding'] .state {
    color: var(--sp-danger, #b3261e);
  }
  .row {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    align-items: center;
    margin-top: 6px;
  }
  input {
    width: 4em;
    font: inherit;
    margin: 0 4px;
  }
  button {
    font: inherit;
    background: none;
    color: inherit;
    border: 1px solid var(--sp-border, #d8d8d8);
    border-radius: var(--sp-radius-sm, 2px);
    padding: 2px 10px;
    cursor: pointer;
  }
  button.primary {
    background: var(--sp-fg, #111);
    color: var(--sp-bg, #fff);
    border-color: var(--sp-fg, #111);
  }
  .close {
    border: 0;
    padding: 0 4px;
  }
  .muted {
    color: var(--sp-muted, #5f5f5f);
  }
  .error {
    color: var(--sp-danger, #b3261e);
  }
</style>
