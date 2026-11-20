<!--
  The turn tracker (docs/design/m7-hud-proposal.md, Turn tracker: "Your turn · Turn 4", then five grouped steps,
  Beginning · Main · Combat · Main 2 · End, the current one filled; on another player's turn "Ben's turn" in Ben's seat
  colour and shape; untap, upkeep and draw fold into Beginning, which expands on hover). DESIGN "Turn flow and
  confirmation": any player can move the marker, with attribution: every step and sub-step is a button. Keys show only
  in tooltips.
-->
<script lang="ts">
  import type { PhaseSpec } from '../core/types';
  import SeatGlyph from './a11y/SeatGlyph.svelte';
  import { stepOf, turnSteps } from './hud/turn';

  let {
    turn,
    activeName,
    activeColour,
    mine = false,
    phases,
    current,
    nextPhaseKey,
    onphase,
  }: {
    turn: number;
    activeName: string;
    activeColour: number | null;
    /** The viewer's own turn (or their team's). */
    mine?: boolean;
    phases: PhaseSpec[];
    current: string;
    nextPhaseKey: string | null;
    onphase: (id: string) => void;
  } = $props();

  const steps = $derived(turnSteps(phases));
  const now = $derived(stepOf(steps, current));
  const label = (id: string): string => phases.find((p) => p.id === id)?.label ?? id;
  const tip = $derived(nextPhaseKey ? ` (${nextPhaseKey} moves on)` : '');
</script>

<nav class="tracker" class:mine data-testid="turn-strip" data-mine={mine ? 'true' : 'false'} aria-label="Turn" style:--seat={activeColour === null ? 'currentColor' : `var(--sp-seat-${activeColour})`}>
  <span class="who">
    <span class="active" data-testid="active-player">{activeName}</span>
    <!-- The seat's glyph beside the headline in the seat colour, so whose turn reads without hue (M5-P4). -->
    <span class="whose" data-testid="whose-turn"><SeatGlyph colour={activeColour} size={10} />{mine ? 'Your turn' : `${activeName}'s turn`}</span>
    <span class="turn" data-testid="turn-number">Turn {turn}</span>
  </span>
  <ol class="steps">
    {#each steps as s (s.id)}
      {@const on = now?.id === s.id}
      <li class="step" class:on class:group={s.phases.length > 1}>
        {#if s.phases.length > 1}
          <button type="button" class="ds-btn ds-btn--quiet sp-h-sm main" class:current={on} data-step={s.id} title="{s.label}: {s.phases.map(label).join(', ')}{tip}" onclick={() => onphase(s.phases[0]!)}>{s.label}</button>
          <span class="subs" role="group" aria-label="{s.label} steps">
            {#each s.phases as p (p)}
              <button type="button" class="ds-btn ds-btn--quiet sp-h-xs sub" class:current={p === current} aria-current={p === current ? 'step' : undefined} data-phase={p} title="{label(p)}{tip}" onclick={() => onphase(p)}>{label(p)}</button>
            {/each}
          </span>
        {:else}
          <button type="button" class="ds-btn ds-btn--quiet sp-h-sm main" class:current={on} aria-current={on ? 'step' : undefined} data-step={s.id} data-phase={s.phases[0]} title="{label(s.phases[0] ?? s.id)}{tip}" onclick={() => onphase(s.phases[0]!)}>{s.label}</button>
        {/if}
      </li>
    {/each}
  </ol>
</nav>

<style>
  .tracker {
    display: flex;
    align-items: center;
    gap: var(--ds-space-md);
    min-height: var(--ds-control-md);
    padding: 0 var(--ds-space-xs) 0 var(--ds-space-md);
    box-sizing: border-box;
    background: var(--ds-panel);
    color: var(--ds-ink);
    border: 1px solid var(--ds-border);
    border-radius: var(--ds-radius-pill);
    box-shadow: var(--ds-elevation-raised);
    font-family: var(--ds-font-body);
    font-size: var(--ds-type-small);
    pointer-events: auto;
    max-width: calc(100vw - 2 * var(--ds-edge));
  }
  .who {
    display: inline-flex;
    align-items: baseline;
    gap: var(--ds-space-sm);
    white-space: nowrap;
  }
  /* The active player's name sits under the "whose turn" headline for screen readers and tests; visually the headline
     carries it ("Ben's turn"), so the name itself is visually hidden. */
  .active {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
  }
  .whose {
    font-family: var(--ds-font-heading);
    font-weight: var(--ds-heading-weight);
    font-variant: var(--ds-heading-variant);
    font-size: var(--ds-type-control);
    padding-bottom: 1px;
    border-bottom: 2px solid var(--seat);
  }
  .mine .whose {
    border-bottom-color: var(--ds-accent);
  }
  .turn {
    color: var(--ds-muted);
    font-variant-numeric: tabular-nums;
  }
  ol {
    display: flex;
    gap: 2px;
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .step {
    position: relative;
  }
  button {
    font-size: inherit;
    color: inherit;
    background: none;
    box-shadow: none;
    border: 1px solid transparent;
    border-radius: var(--ds-radius-pill);
    cursor: pointer;
    white-space: nowrap;
  }
  .main {
    padding: 0 var(--ds-space-md);
    text-transform: var(--ds-label-case);
    letter-spacing: var(--ds-label-spacing);
    font-weight: var(--ds-weight-medium);
  }
  .main:hover {
    background: var(--ds-chip);
  }
  .main.current {
    background: var(--ds-on);
    color: var(--ds-on-ink);
    font-weight: var(--ds-weight-bold);
  }
  /* Beginning's three steps open under it on hover or focus (they stay clickable for the pointer and the keyboard). */
  .subs {
    position: absolute;
    top: calc(100% + 4px);
    left: 50%;
    transform: translateX(-50%) translateY(-4px);
    display: flex;
    gap: 2px;
    padding: 3px;
    background: var(--ds-panel-raised);
    border: 1px solid var(--ds-border);
    border-radius: var(--ds-radius-pill);
    box-shadow: var(--ds-elevation-pop);
    opacity: 0;
    pointer-events: none;
    transition:
      opacity var(--ds-duration-fast) var(--ds-ease-standard),
      transform var(--ds-duration-fast) var(--ds-ease-standard);
    z-index: 1;
  }
  .group:hover .subs,
  .group:focus-within .subs {
    opacity: 1;
    transform: translateX(-50%);
    pointer-events: auto;
  }
  /* The kit's buttons take pointer events on their own: while the sub-steps are closed (invisible) they must not
     catch a press meant for what lies under them (the stack chip). */
  .subs .sub {
    pointer-events: none;
  }
  .group:hover .subs .sub,
  .group:focus-within .subs .sub {
    pointer-events: auto;
  }
  .sub {
    min-height: 28px;
    padding: 0 var(--ds-space-sm);
  }
  .sub.current {
    background: var(--ds-on);
    color: var(--ds-on-ink);
  }
  /* Narrow screens (an upright iPad, a phone): the compact tracker, "Your turn · Main" (docs/design/m7-hud-proposal.md, iPad portrait). */
  @media (max-width: 900px) {
    .turn {
      display: none;
    }
    .step:not(.on) {
      display: none;
    }
  }
</style>
