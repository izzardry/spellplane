<!--
  Turn and phase strip (DESIGN "Turn flow and confirmation": turn number, active player, seven steps; Tab next phase,
  Ctrl+Enter next turn; any player can move the marker, with attribution).
-->
<script lang="ts">
  import type { PhaseSpec } from '../core/types';

  let {
    turn,
    activeName,
    activeColour,
    phases,
    current,
    nextPhaseKey,
    nextTurnKey,
    onphase,
    onnextturn,
  }: {
    turn: number;
    activeName: string;
    activeColour: number | null;
    phases: PhaseSpec[];
    current: string;
    nextPhaseKey: string | null;
    nextTurnKey: string | null;
    onphase: (id: string) => void;
    onnextturn: () => void;
  } = $props();
</script>

<nav class="strip" data-testid="turn-strip" aria-label="Turn">
  <span class="turn" data-testid="turn-number">Turn {turn}</span>
  <span class="active" data-testid="active-player" style:--seat={activeColour === null ? 'currentColor' : `var(--sp-seat-${activeColour})`}>{activeName}</span>
  <ol>
    {#each phases as p (p.id)}
      <li>
        <button type="button" class:current={p.id === current} aria-current={p.id === current ? 'step' : undefined} data-phase={p.id} title={nextPhaseKey ? `${nextPhaseKey} advances` : ''} onclick={() => onphase(p.id)}>{p.label}</button>
      </li>
    {/each}
  </ol>
  <button type="button" class="next" data-testid="next-turn" onclick={onnextturn}>Next turn {#if nextTurnKey}<kbd>{nextTurnKey}</kbd>{/if}</button>
</nav>

<style>
  .strip {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 4px 10px;
    background: var(--sp-surface, #fff);
    color: var(--sp-fg, #111);
    border: 1px solid var(--sp-border, #d8d8d8);
    border-radius: var(--sp-radius-md, 4px);
    font: var(--sp-font-size-small, 12px) / 1.4 var(--sp-font, system-ui);
    pointer-events: auto;
  }
  .turn {
    font-weight: var(--sp-font-weight-bold, 600);
    font-variant-numeric: tabular-nums;
  }
  .active {
    border-bottom: 2px solid var(--seat);
  }
  ol {
    display: flex;
    gap: 2px;
    list-style: none;
    margin: 0;
    padding: 0;
  }
  button {
    font: inherit;
    color: inherit;
    background: none;
    border: 1px solid transparent;
    border-radius: var(--sp-radius-sm, 2px);
    padding: 1px 6px;
    cursor: pointer;
    font-variant: small-caps;
  }
  button.current {
    background: var(--sp-fg, #111);
    color: var(--sp-bg, #fff);
  }
  .next {
    border-color: var(--sp-border, #d8d8d8);
    font-variant: normal;
  }
  kbd {
    font-family: var(--sp-font-mono, monospace);
    opacity: 0.7;
  }
</style>
