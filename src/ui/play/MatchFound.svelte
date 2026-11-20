<!--
  The match-found card (journey.md 4.6; visual.md 2.8 "Match found"; matchmaking.md 2.8): MATCH FOUND, the queue, the
  seats (glyph, name, rating in ranked, deck strength pips, a check per accept), a 20-second countdown ring stepped once
  a second by the parent, ACCEPT (Enter accepts) and DECLINE. Escape does nothing: too easy to hit. Kit only. M8-P7.
-->
<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import type { MatchmakerStatus } from '../../session/types';
  import Button from '../design/Button.svelte';
  import Countdown from '../design/Countdown.svelte';
  import SeatGlyph from '../design/SeatGlyph.svelte';
  import StrengthPips from '../design/StrengthPips.svelte';
  import { CHECK_SECONDS, deckKindLabel, queueLabel, seatColourVar } from './mm-view';

  type Check = Extract<MatchmakerStatus, { phase: 'check' }>;
  let { status, now, onanswer }: { status: Check; now: number; onanswer: (accept: boolean) => void } = $props();

  const seconds = $derived(Math.max(0, Math.min(CHECK_SECONDS, Math.ceil((status.deadline - now) / 1000))));
  const ranked = $derived(status.match.queue.endsWith('.ranked'));
  type Player = Check['match']['players'][number];
  const accepted = (p: Player): boolean => (p.me ? status.mine : (p.accepted ?? status.accepted.includes(p.name)));
  const waitingFor = $derived(status.match.players.filter((p) => !p.me && !accepted(p)).map((p) => p.name));

  let card: HTMLElement | null = $state(null);
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Enter' && !status.mine) {
      e.preventDefault();
      onanswer(true);
    }
    // Escape: deliberately nothing (journey.md 4.6).
  };
  onMount(() => {
    window.addEventListener('keydown', onKey);
    card?.querySelector<HTMLButtonElement>('[data-testid="match-accept"]')?.focus();
  });
  onDestroy(() => window.removeEventListener('keydown', onKey));
</script>

<div class="ds-scrim mm-scrim ds-root" data-testid="match-found-scrim">
  <div
    bind:this={card}
    class="ds-pop ds-dialog mm-card"
    role="alertdialog"
    aria-modal="true"
    aria-labelledby="mm-found-title"
    aria-describedby="mm-found-queue"
    data-testid="match-found"
  >
    <header class="mm-head">
      <h2 id="mm-found-title" class="mm-title">MATCH FOUND</h2>
      <p id="mm-found-queue" class="ds-t-eyebrow mm-queue-text" data-testid="match-found-queue">{queueLabel(status.match.queue)} · {deckKindLabel(status.match.queue)}</p>
    </header>
    <ul class="mm-seats" aria-label="Players">
      {#each status.match.players as p, i (i)}
        <li class="mm-seat" data-testid="match-found-seat" data-me={p.me ? 'true' : 'false'}>
          <SeatGlyph seat={i} colour={seatColourVar(i)} size={28} label={`Seat ${i + 1}`} />
          <span class="mm-name">{p.me ? `${p.name} (you)` : p.name}</span>
          {#if ranked && p.rating !== null}<span class="mm-rating" data-testid="match-found-rating">{p.rating}</span>{/if}
          <StrengthPips band={p.band} label={`Deck strength ${p.band} of 5`} />
          <span class="mm-state" class:on={accepted(p)} data-testid="match-found-accepted" data-accepted={accepted(p) ? 'true' : 'false'}>
            {accepted(p) ? '✓' : '…'}<span class="mm-sr">{accepted(p) ? ' accepted' : ' not yet'}</span>
          </span>
        </li>
      {/each}
    </ul>
    <div class="mm-actions">
      <Countdown {seconds} total={CHECK_SECONDS} size={56} label="Seconds to accept" data-testid="match-found-countdown" />
      {#if status.mine}
        <Button variant="secondary" size="lg" disabled pressed data-testid="match-accept">
          {waitingFor.length > 0 ? `WAITING FOR ${waitingFor[0]!.toUpperCase()}…` : 'EVERYONE IS READY'}
        </Button>
      {:else}
        <Button variant="primary" size="lg" onclick={() => onanswer(true)} data-testid="match-accept">ACCEPT</Button>
      {/if}
    </div>
    <div class="mm-decline">
      <Button variant="quiet" size="sm" onclick={() => onanswer(false)} data-testid="match-decline">DECLINE</Button>
    </div>
  </div>
</div>

<style>
  .mm-scrim {
    z-index: 900;
  }
  .mm-card {
    justify-items: center;
    text-align: center;
    border-radius: var(--ds-radius-sheet);
  }
  .mm-head {
    display: grid;
    gap: var(--ds-space-xs);
  }
  .mm-title {
    margin: 0;
    font-family: var(--ds-font-heading);
    font-weight: var(--ds-heading-weight);
    font-size: 18px;
    letter-spacing: 0.3em;
  }
  .mm-queue-text {
    margin: 0;
  }
  .mm-seats {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: var(--ds-space-sm);
    width: 100%;
  }
  .mm-seat {
    display: grid;
    grid-template-columns: auto 1fr auto auto auto;
    align-items: center;
    gap: var(--ds-space-sm);
    text-align: left;
    font-size: var(--ds-type-body);
  }
  .mm-name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-weight: var(--ds-weight-medium);
  }
  .mm-rating {
    font-family: var(--ds-font-numeral);
    font-variant-numeric: var(--ds-numeric);
    color: var(--ds-muted);
  }
  .mm-state {
    min-width: 1.5em;
    text-align: center;
    color: var(--ds-muted);
  }
  .mm-state.on {
    color: var(--ds-success);
    font-weight: var(--ds-weight-bold);
  }
  .mm-sr {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
  }
  .mm-actions {
    display: flex;
    align-items: center;
    justify-content: center;
    flex-wrap: wrap;
    gap: var(--ds-space-md);
  }
</style>
