<!--
  The selection strip (PLAN M7-P5: "a selected card shows a compact action strip next to it (Tap, Flip, Counter +/−,
  To graveyard, More…) that is also the iPad thumb bar; counters as chips on the card you click +/−";
  docs/design/m7-hud-proposal.md, Card action strip). It stands above the selection (below it at the top of the
  screen) where the table scene reports it (SceneEvents.selectionAnchor), hides while the camera or the cards move and
  returns when they rest. Every control runs an existing action on the selection (ui/commands.ts Commands.runFor); no
  label names a key. On a touch screen every control is a thumb-sized target. Added by M7-P5.
-->
<script lang="ts">
  import type { SelectionAnchor } from '../../scene/types';
  import { controlHeight, stripPlace, type CounterChip, type StripItem } from './affordances';
  import { DEFAULT_COUNTER } from '../commands';

  let {
    anchor,
    items,
    chips,
    touch = false,
    vw,
    vh,
    onrun,
    oncounter,
    onmore,
  }: {
    anchor: SelectionAnchor | null;
    items: StripItem[];
    chips: CounterChip[];
    touch?: boolean;
    vw: number;
    vh: number;
    onrun: (item: StripItem) => void;
    oncounter: (kind: string, delta: number) => void;
    onmore: (x: number, y: number) => void;
  } = $props();

  let w = $state(0);
  let h = $state(0);
  const height = $derived(controlHeight(touch));
  /** The kit's size class: strip actions are `sm` (36 px), touch targets `md` (44 px). */
  const size = $derived(touch ? 'ds-btn--md' : 'ds-btn--sm');
  const place = $derived(anchor ? stripPlace(anchor, { width: w || items.length * 80, height: h || height + 8 }, { width: vw, height: vh }) : null);
  /** The counter kinds the strip offers ± for: those on the card, else the default kind. */
  const kinds = $derived(chips.length ? chips : [{ kind: DEFAULT_COUNTER, count: 0 }]);
</script>

{#if anchor && place && items.length}
  <div
    class="strip"
    class:touch
    role="toolbar"
    aria-label="Card actions"
    data-testid="selection-strip"
    data-zone={anchor.zone ?? ''}
    data-cards={anchor.cards.join(' ')}
    data-side={anchor.above ? 'above' : 'below'}
    style:--h="{height}px"
    style:transform="translate({place.x}px, {place.y}px)"
    bind:offsetWidth={w}
    bind:offsetHeight={h}
  >
    {#each items as item (item.id)}
      {#if item.id === 'counters'}
        <span class="counters" role="group" aria-label="Counters">
          {#each kinds as chip (chip.kind)}
            <button type="button" class="ds-btn ds-btn--quiet {size} pm" data-testid="strip-counter-remove" data-kind={chip.kind} aria-label="Remove a {chip.kind} counter" disabled={chip.count === 0} onclick={() => oncounter(chip.kind, -1)}>−</button>
            <span class="chip" data-testid="strip-counter-chip" data-kind={chip.kind} data-count={chip.count}>{chip.kind}{#if chip.count > 0}<b>{chip.count}</b>{/if}</span>
            <button type="button" class="ds-btn ds-btn--quiet {size} pm" data-testid="strip-counter-add" data-kind={chip.kind} aria-label="Add a {chip.kind} counter" onclick={() => oncounter(chip.kind, 1)}>+</button>
          {/each}
        </span>
      {:else if item.id === 'more'}
        <button
          type="button"
          class="ds-btn ds-btn--quiet {size}"
          data-testid="strip-more"
          aria-haspopup="menu"
          onclick={(e) => {
            const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
            onmore(Math.round(r.left), Math.round(r.bottom));
          }}>{item.label}</button
        >
      {:else}
        <button type="button" class="ds-btn ds-btn--quiet {size}" data-testid="strip-{item.id}" onclick={() => onrun(item)}>{item.label}</button>
      {/if}
    {/each}
  </div>
{/if}

<style>
  .strip {
    position: fixed;
    left: 0;
    top: 0;
    z-index: 22;
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 4px;
    pointer-events: auto;
    background: var(--ds-panel, var(--sp-surface));
    color: var(--ds-ink, var(--sp-fg));
    border: 1px solid var(--ds-border, var(--sp-border));
    border-radius: 999px;
    box-shadow: var(--ds-elevation-pop, var(--sp-hud-shadow));
    font-family: var(--ds-font-body, var(--sp-font));
    font-weight: 600;
    font-size: 13px;
    line-height: 1;
    white-space: nowrap;
    -webkit-user-select: none;
    user-select: none;
    -webkit-touch-callout: none;
    touch-action: manipulation;
    animation: rise 120ms ease-out;
  }
  button {
    height: var(--h);
    min-height: var(--h);
    box-sizing: border-box;
    padding: 0 12px;
    border-radius: 999px;
    border: 1px solid transparent;
    background: transparent;
    color: inherit;
    font-family: inherit;
    font-size: inherit;
    font-weight: inherit;
    cursor: pointer;
  }
  .touch button {
    min-width: var(--h);
  }
  button:hover {
    background: color-mix(in srgb, currentColor 10%, transparent);
  }
  button:focus-visible {
    outline: 2px solid var(--ds-focus, var(--sp-focus));
    outline-offset: 1px;
  }
  button.pm {
    padding: 0;
    width: var(--h);
    font-size: 16px;
  }
  button:disabled {
    opacity: 0.4;
    cursor: default;
  }
  .counters {
    display: inline-flex;
    align-items: center;
    gap: 2px;
    padding: 0 2px;
    border-left: 1px solid var(--ds-border, var(--sp-border));
    border-right: 1px solid var(--ds-border, var(--sp-border));
  }
  .chip {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 3px 8px;
    border-radius: 999px;
    background: var(--ds-chip, color-mix(in srgb, currentColor 10%, transparent));
    font-weight: 600;
  }
  .chip b {
    font-variant-numeric: tabular-nums;
  }
  @keyframes rise {
    from {
      opacity: 0;
    }
    to {
      opacity: 1;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .strip {
      animation: none;
    }
  }
</style>
