<!--
  The confirmation prompt (DESIGN "Turn flow and confirmation", Confirmation rounds; "Specification: geometry, layout
  and motion", Screen layer: it sits above the hand, centred). Inline and dismissible, never modal ("Input and
  interaction design": nothing modal).
  - A seat that has to answer sees who asks and what, a draining ring with the seconds left, OK (Enter) and Hold
    (H or Esc while the prompt is up).
  - The seat holding the floor sees that it does, and Release.
  - Everyone else (the asker, seats that passed) sees a compact line naming who the round is waiting for, or who is
    responding; the asker also sees "All passed" once everyone has, for PASSED_MS (a round stays open after that, so
    the pill would otherwise never leave).
  - While another seat holds the floor, Hold is not offered (one seat holds at a time).
  The countdown is this browser's own (ui/confirm/model.ts Countdown); the sequencer's clock decides. It ticks only
  while the timer runs.
-->
<script lang="ts">
  import { onDestroy, untrack } from 'svelte';
  import type { SeatId } from '../../core/types';
  import { Countdown, type PromptModel } from './model';

  let {
    model,
    me,
    seatName,
    seatColour,
    what,
    keys,
    reducedMotion = false,
    onok,
    onhold,
    onrelease,
  }: {
    model: PromptModel;
    me: SeatId | null;
    seatName: (seat: SeatId) => string;
    /** Seat colour index (CSS variable --sp-seat-<n>), or null. */
    seatColour: (seat: SeatId) => number | null;
    /** What the round is about: "cast Spark Jolt", "asks “attacks?”". */
    what: string;
    keys: { ok: string | null; hold: string | null };
    reducedMotion?: boolean;
    onok: () => void;
    onhold: () => void;
    onrelease: () => void;
  } = $props();

  const countdown = new Countdown();
  let now = $state(performance.now());
  // Observe each new model at the moment this browser applied it (DESIGN Timers: each client animates its own countdown).
  $effect(() => {
    const m = model;
    untrack(() => {
      now = performance.now();
      countdown.observe(m, now);
    });
  });
  // Tick only while a countdown runs: a round stays open after everyone passed, often for a long time.
  const running = $derived(model.timerRunning);
  const roundId = $derived(model.round.id);
  const allPassed = $derived(model.allPassed);
  $effect(() => {
    if (!running) return;
    const timer = setInterval(() => (now = performance.now()), 100);
    return () => clearInterval(timer);
  });

  /** How long the asker sees "All passed". */
  const PASSED_MS = 4000;
  /** The round whose "All passed" pill has had its time. */
  let passedShown = $state<string | null>(null);
  let passedTimer: ReturnType<typeof setTimeout> | undefined;
  $effect(() => {
    const id = roundId;
    if (!allPassed) return;
    passedTimer = setTimeout(() => (passedShown = id), PASSED_MS);
    return () => clearTimeout(passedTimer);
  });
  onDestroy(() => clearTimeout(passedTimer));

  const fraction = $derived.by(() => {
    void model;
    return countdown.fraction(now);
  });
  const seconds = $derived.by(() => {
    void model;
    return countdown.seconds(now);
  });
  const hasTimer = $derived(model.round.durationMs > 0);
  const asker = $derived(seatName(model.round.askedBy));
  const holderName = $derived(model.holder ? seatName(model.holder) : null);
  const waitingNames = $derived(model.waitingOn.filter((s) => s !== model.holder));
  /** SVG ring: circumference of r = 7. */
  const C = 2 * Math.PI * 7;
  const colour = (s: SeatId) => {
    const c = seatColour(s);
    return c === null ? 'currentColor' : `var(--sp-seat-${c}, currentColor)`;
  };
</script>

{#snippet ring()}
  {#if hasTimer}
    <span class="ring" class:paused={!model.timerRunning} data-testid="confirm-ring" data-fraction={fraction.toFixed(3)} data-running={model.timerRunning} aria-label={model.timerRunning ? `${seconds} seconds left` : 'Timer stopped'} role="timer">
      <svg viewBox="0 0 18 18" width="18" height="18" aria-hidden="true">
        <circle cx="9" cy="9" r="7" class="track" />
        <circle cx="9" cy="9" r="7" class="left" stroke-dasharray={C} stroke-dashoffset={C * (1 - fraction)} transform="rotate(-90 9 9)" class:smooth={!reducedMotion} />
      </svg>
      {#if model.timerRunning}<span class="secs">{seconds}</span>{/if}
    </span>
  {/if}
{/snippet}

{#if model.mode === 'respond'}
  <div class="prompt" data-testid="confirm-prompt" data-round={model.round.id} role="alertdialog" aria-label="Confirmation" style:--seat={colour(model.round.askedBy)}>
    {@render ring()}
    <span class="what"><b>{asker}</b> {what}</span>
    {#if holderName}<span class="holding" data-testid="confirm-holder">{holderName} is responding</span>{/if}
    <button type="button" data-testid="prompt-ok" onclick={onok}>OK {#if keys.ok}<kbd>{keys.ok}</kbd>{/if}</button>
    {#if !model.holder || model.holder === me}<button type="button" data-testid="prompt-hold" onclick={onhold}>Hold {#if keys.hold}<kbd>{keys.hold}</kbd>{/if}</button>{/if}
  </div>
{:else if model.mode === 'holding'}
  <div class="prompt holding-me" data-testid="confirm-prompt" data-round={model.round.id} role="alertdialog" aria-label="Confirmation" style:--seat={colour(model.round.askedBy)}>
    {@render ring()}
    <span class="what"><b>{asker}</b> {what}</span>
    <span>You hold the floor.</span>
    <button type="button" data-testid="release" onclick={onrelease}>Release {#if keys.ok}<kbd>{keys.ok}</kbd>{/if}</button>
  </div>
{:else if !model.allPassed}
  <div class="status" data-testid="confirm-status" data-round={model.round.id} role="status" aria-live="polite">
    {@render ring()}
    {#if holderName}
      <span data-testid="confirm-holder"><b style:color={colour(model.holder ?? '')}>{holderName}</b> is responding</span>
    {:else}
      <span>Waiting for
        {#each waitingNames as s, i (s)}<b class="seat" data-seat={s} style:color={colour(s)}>{seatName(s)}</b>{i < waitingNames.length - 2 ? ', ' : i === waitingNames.length - 2 ? ' and ' : ''}{/each}
      </span>
    {/if}
  </div>
{:else if model.round.askedBy === me && model.participants.length > 0 && passedShown !== model.round.id}
  <div class="status passed" data-testid="confirm-status" data-round={model.round.id} data-passed="true" role="status" aria-live="polite">All passed</div>
{/if}

<style>
  .prompt,
  .status {
    pointer-events: auto;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 10px;
    background: var(--sp-surface, #fff);
    color: var(--sp-fg, #111);
    border: 1px solid var(--sp-fg, #111);
    border-radius: var(--sp-radius-md, 4px);
    font: var(--sp-font-size-small, 12px) / 1.4 var(--sp-font, system-ui);
  }
  .prompt {
    border-left: 4px solid var(--seat, currentColor);
  }
  .status {
    border-color: var(--sp-border, #d8d8d8);
  }
  .status.passed {
    font-weight: var(--sp-font-weight-bold, 600);
  }
  .prompt button {
    font: inherit;
    padding: 2px 8px;
    background: var(--sp-surface, #fff);
    color: inherit;
    border: 1px solid var(--sp-fg, #111);
    border-radius: var(--sp-radius-sm, 3px);
    cursor: pointer;
  }
  .holding {
    font-style: italic;
  }
  kbd {
    font: inherit;
    font-size: 0.85em;
    padding: 0 3px;
    border: 1px solid var(--sp-border, #d8d8d8);
    border-radius: 2px;
    margin-left: 2px;
  }
  .ring {
    position: relative;
    display: inline-flex;
    align-items: center;
    gap: 3px;
    font-variant-numeric: tabular-nums;
  }
  .ring .track {
    fill: none;
    stroke: var(--sp-border, #d8d8d8);
    stroke-width: 2;
  }
  .ring .left {
    fill: none;
    stroke: var(--sp-fg, #111);
    stroke-width: 2;
  }
  .ring .left.smooth {
    transition: stroke-dashoffset 100ms linear;
  }
  .ring.paused .left {
    stroke: var(--sp-muted, #8a8a8a);
  }
  .secs {
    min-width: 1.2em;
  }
</style>
