<!--
  The match-found card (journey.md 4.6; visual.md 2.8 "Match found"; matchmaking.md 2.8): MATCH FOUND, the queue, the
  seats (glyph, name, rating in ranked, deck strength pips, a check per accept), a 20-second countdown ring stepped once
  a second, ACCEPT (Enter accepts) and DECLINE. Escape does nothing: too easy to hit. M8-P7.
-->
<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import type { MatchmakerStatus } from '../../session/types';
  import { queueLabel } from './mm-view';

  type Check = Extract<MatchmakerStatus, { phase: 'check' }>;
  let { status, now, onanswer }: { status: Check; now: number; onanswer: (accept: boolean) => void } = $props();

  const CHECK_SECONDS = 20;
  const seconds = $derived(Math.max(0, Math.min(CHECK_SECONDS, Math.ceil((status.deadline - now) / 1000))));
  const ranked = $derived(status.match.queue.endsWith('.ranked'));
  const kind = $derived(status.match.queue.includes('.limited.') ? 'BOOSTER DECKS' : 'CUSTOM DECKS');
  const waitingFor = $derived(status.match.players.filter((p) => !p.me && !status.accepted.includes(p.name)).map((p) => p.name));

  let accept: HTMLButtonElement | null = $state(null);
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Enter' && !status.mine) {
      e.preventDefault();
      onanswer(true);
    }
    // Escape: deliberately nothing.
  };
  onMount(() => {
    window.addEventListener('keydown', onKey);
    accept?.focus();
  });
  onDestroy(() => window.removeEventListener('keydown', onKey));
</script>

<div class="mm-scrim" data-testid="match-found-scrim">
  <div class="mm-card" role="alertdialog" aria-modal="true" aria-labelledby="mm-found-title" aria-describedby="mm-found-queue" data-testid="match-found">
    <h2 id="mm-found-title" class="mm-title">MATCH FOUND</h2>
    <p id="mm-found-queue" class="mm-queue-text" data-testid="match-found-queue">{queueLabel(status.match.queue)} · {kind}</p>
    <ul class="mm-seats" aria-label="Players">
      {#each status.match.players as p, i (i)}
        <li class="mm-seat" data-testid="match-found-seat" data-me={p.me ? 'true' : 'false'}>
          <span class="mm-glyph" data-seat={i} aria-hidden="true">{['◆', '▲', '●', '■'][i] ?? '◆'}</span>
          <span class="mm-name">{p.me ? `${p.name} (you)` : p.name}</span>
          {#if ranked && p.rating !== null}<span class="mm-rating" data-testid="match-found-rating">{p.rating}</span>{/if}
          <span class="mm-pips" role="img" aria-label={`Deck strength ${p.band} of 5`}>
            {#each [1, 2, 3, 4, 5] as b (b)}<span class="mm-pip" class:on={b <= p.band}></span>{/each}
          </span>
          <span class="mm-state" data-testid="match-found-accepted" aria-label={status.accepted.includes(p.name) ? 'accepted' : 'waiting'}>{status.accepted.includes(p.name) ? '✓' : '…'}</span>
        </li>
      {/each}
    </ul>
    <div class="mm-actions">
      <div
        class="mm-ring"
        role="timer"
        aria-label={`${seconds} seconds to accept`}
        data-testid="match-found-countdown"
        style={`background: conic-gradient(var(--ds-ink) ${(seconds / CHECK_SECONDS) * 360}deg, var(--ds-line) 0deg)`}
      >
        <span class="mm-ring-inner">{seconds}</span>
      </div>
      {#if status.mine}
        <button type="button" class="ds-btn mm-lg" data-testid="match-accept" disabled aria-pressed="true">
          {waitingFor.length > 0 ? `WAITING FOR ${waitingFor[0]!.toUpperCase()}…` : 'EVERYONE IS READY'}
        </button>
      {:else}
        <button type="button" class="ds-btn ds-btn--primary mm-lg" data-testid="match-accept" bind:this={accept} onclick={() => onanswer(true)}>ACCEPT</button>
      {/if}
    </div>
    <button type="button" class="ds-btn ds-btn--quiet mm-decline" data-testid="match-decline" onclick={() => onanswer(false)}>DECLINE</button>
  </div>
</div>

<style>
  .mm-scrim {
    position: fixed;
    inset: 0;
    z-index: 900;
    display: grid;
    place-items: center;
    padding: var(--ds-space-md);
    background: var(--ds-overlay);
  }
  .mm-card {
    width: min(440px, 100%);
    display: grid;
    gap: var(--ds-space-md);
    justify-items: center;
    padding: var(--ds-space-xl) var(--ds-space-lg);
    border-radius: var(--ds-radius-md);
    background: var(--ds-panel-raised);
    color: var(--ds-ink);
    box-shadow: var(--ds-elevation-pop);
    font-family: var(--ds-font-body);
    animation: mm-in 200ms var(--ds-ease-enter) both;
  }
  @keyframes mm-in {
    from {
      opacity: 0;
      transform: scale(0.96);
    }
    to {
      opacity: 1;
      transform: scale(1);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .mm-card {
      animation: none;
    }
  }
  .mm-title {
    margin: 0;
    font-family: var(--ds-font-heading);
    font-size: 18px;
    letter-spacing: 0.3em;
    font-weight: var(--ds-weight-bold);
  }
  .mm-queue-text {
    margin: 0;
    font-family: var(--ds-font-mono);
    font-size: var(--ds-type-small);
    letter-spacing: 0.08em;
    color: var(--ds-muted);
  }
  .mm-seats {
    list-style: none;
    margin: 0;
    padding: 0;
    width: 100%;
    display: grid;
    gap: var(--ds-space-xs);
  }
  .mm-seat {
    display: grid;
    grid-template-columns: 20px 1fr auto auto 20px;
    align-items: center;
    gap: var(--ds-space-sm);
    min-height: 36px;
  }
  .mm-glyph {
    text-align: center;
  }
  .mm-name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .mm-rating {
    font-family: var(--ds-font-numeral);
    font-variant-numeric: tabular-nums;
  }
  .mm-pips {
    display: inline-flex;
    gap: 3px;
  }
  .mm-pip {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    border: 1px solid var(--ds-ink);
  }
  .mm-pip.on {
    background: var(--ds-ink);
  }
  .mm-actions {
    display: flex;
    align-items: center;
    gap: var(--ds-space-md);
  }
  .mm-ring {
    width: 56px;
    height: 56px;
    border-radius: 50%;
    display: grid;
    place-items: center;
    flex: none;
  }
  .mm-ring-inner {
    width: 46px;
    height: 46px;
    border-radius: 50%;
    display: grid;
    place-items: center;
    background: var(--ds-panel-raised);
    font-family: var(--ds-font-numeral);
    font-weight: var(--ds-weight-bold);
  }
  .mm-lg {
    min-height: 56px;
    min-width: 200px;
  }
  .mm-decline {
    min-height: 36px;
  }
</style>
