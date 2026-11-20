<!--
  The content of the shell's queue bar while a search runs (journey.md 4.5; visual.md 2.8 "Queue bar"; matchmaking.md
  2.8): a pulsing ring, SEARCHING, mode and format, the timer, the count and CANCEL. A click on the bar (outside CANCEL)
  goes Home. Renders nothing unless the matchmaker is connecting or seeking. The timer steps once a second (no per-frame
  work). M8-P7.
-->
<script lang="ts">
  import { onDestroy, untrack } from 'svelte';
  import type { Matchmaker, MatchmakerStatus } from '../../session/types';
  import Button from '../design/Button.svelte';
  import { clockText, lookingCount, mmNow, queueLabel } from './mm-view';

  let { matchmaker, onhome }: { matchmaker: Matchmaker; onhome?: () => void } = $props();

  let status = $state.raw<MatchmakerStatus>({ phase: 'off' });
  let now = $state(0);
  // The timer steps once a second, and only while the bar shows.
  let timer: ReturnType<typeof setInterval> | null = null;
  const off = untrack(() => matchmaker).subscribe((s) => {
    status = s;
    now = mmNow(matchmaker);
    const searching = s.phase === 'seeking' || s.phase === 'connecting';
    if (searching) timer ??= setInterval(() => (now = mmNow(matchmaker)), 1000);
    else if (timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  });
  onDestroy(() => {
    off();
    if (timer !== null) clearInterval(timer);
  });

  const shown = $derived(status.phase === 'seeking' || status.phase === 'connecting');
  const count = $derived(lookingCount(status));
</script>

{#if shown}
  <div class="mm-queue ds-root" data-testid="queue-chip" data-phase={status.phase}>
    <Button variant="quiet" size="md" class="mm-queue-main" onclick={() => onhome?.()} aria-label="Searching for a match: go Home" data-testid="queue-chip-home">
      <span class="mm-ring" aria-hidden="true"></span>
      {#if status.phase === 'seeking'}
        <span class="mm-strong">SEARCHING</span>
        <span class="mm-dot" aria-hidden="true">·</span>
        <span data-testid="queue-chip-mode">{queueLabel(status.queues[0]!)}</span>
        <span class="mm-dot" aria-hidden="true">·</span>
        <span class="mm-strong mm-time" data-testid="queue-chip-time">{clockText(now - status.since)}</span>
        <span class="mm-dot mm-wide" aria-hidden="true">·</span>
        <span class="mm-wide" data-testid="queue-chip-count">{status.alone ? 'ONLY YOU SO FAR' : `${count} LOOKING`}</span>
      {:else}
        <span class="mm-strong">CONNECTING…</span>
      {/if}
    </Button>
    <Button variant="quiet" size="sm" class="mm-cancel" onclick={() => matchmaker.cancel()} data-testid="queue-cancel">CANCEL</Button>
  </div>
{/if}

<style>
  .mm-queue {
    display: inline-flex;
    align-items: center;
    gap: var(--ds-space-sm);
    min-height: 44px;
    padding: 0 var(--ds-space-xs) 0 var(--ds-space-md);
    border-radius: var(--ds-radius-pill);
    background: var(--ds-ink);
    color: var(--ds-on-ink);
    box-shadow: var(--ds-elevation-primary);
    font-family: var(--ds-font-mono);
    font-size: var(--ds-type-small);
    letter-spacing: 0.06em;
    max-width: 100%;
  }
  .mm-queue :global(.mm-queue-main) {
    gap: var(--ds-space-xs);
    color: inherit;
    background: transparent;
    border: 0;
    box-shadow: none;
    padding: 0;
    white-space: nowrap;
    overflow: hidden;
    font: inherit;
    letter-spacing: inherit;
  }
  .mm-strong {
    font-weight: var(--ds-weight-bold);
  }
  .mm-time {
    letter-spacing: 0.1em;
    font-variant-numeric: tabular-nums;
  }
  .mm-dot {
    opacity: 0.45;
  }
  .mm-queue :global(.mm-cancel) {
    color: inherit;
    background: color-mix(in srgb, var(--ds-on-ink) 14%, transparent);
    border: 0;
  }
  .mm-ring {
    width: 14px;
    height: 14px;
    border-radius: 50%;
    border: 2px solid currentColor;
    flex: none;
    animation: mm-pulse 1.5s ease-in-out infinite;
  }
  @keyframes mm-pulse {
    0%,
    100% {
      opacity: 1;
      transform: scale(1);
    }
    50% {
      opacity: 0.4;
      transform: scale(0.8);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .mm-ring {
      animation: none;
    }
  }
  @media (max-width: 600px) {
    .mm-wide {
      display: none;
    }
  }
</style>
