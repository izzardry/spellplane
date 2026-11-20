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
  import Button from '../design/Button.svelte';

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
  /** The kit's size: strip actions are `sm` (36 px), touch targets `md` (44 px). */
  const size = $derived<'sm' | 'md'>(touch ? 'md' : 'sm');
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
            <Button variant="quiet" {size} class="pm" data-testid="strip-counter-remove" data-kind={chip.kind} aria-label="Remove a {chip.kind} counter" disabled={chip.count === 0} onclick={() => oncounter(chip.kind, -1)}>−</Button>
            <span class="chip" data-testid="strip-counter-chip" data-kind={chip.kind} data-count={chip.count}>{chip.kind}{#if chip.count > 0}<b>{chip.count}</b>{/if}</span>
            <Button variant="quiet" {size} class="pm" data-testid="strip-counter-add" data-kind={chip.kind} aria-label="Add a {chip.kind} counter" onclick={() => oncounter(chip.kind, 1)}>+</Button>
          {/each}
        </span>
      {:else if item.id === 'more'}
        <Button
          variant="quiet"
          {size}
          data-testid="strip-more"
          aria-haspopup="menu"
          onclick={(e) => {
            const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
            onmore(Math.round(r.left), Math.round(r.bottom));
          }}>{item.label}</Button
        >
      {:else}
        <Button variant="quiet" {size} data-testid="strip-{item.id}" onclick={() => onrun(item)}>{item.label}</Button>
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
    gap: var(--ds-space-xs, 4px);
    padding: var(--ds-space-xs, 4px);
    pointer-events: auto;
    background: var(--ds-panel, var(--sp-surface));
    color: var(--ds-ink, var(--sp-fg));
    border: 1px solid var(--ds-border, var(--sp-border));
    border-radius: var(--ds-radius-md, 10px);
    box-shadow: var(--ds-elevation-pop, var(--sp-hud-shadow));
    font-family: var(--ds-font-body, var(--sp-font));
    font-size: var(--ds-type-control, 13px);
    line-height: 1;
    white-space: nowrap;
    -webkit-user-select: none;
    user-select: none;
    -webkit-touch-callout: none;
    touch-action: manipulation;
    animation: rise 120ms ease-out;
  }
  /* The kit's sm (36 px) or md (44 px) button; on touch never narrower than it is high. */
  .strip :global(.ds-btn) {
    box-sizing: border-box;
  }
  .touch :global(.ds-btn) {
    min-width: var(--h);
  }
  .strip :global(.ds-btn.pm) {
    padding: 0;
    width: var(--h);
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
    border-radius: var(--ds-radius-pill, 999px);
    background: var(--ds-chip, var(--sp-bg));
    font-weight: var(--ds-weight-bold, 600);
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
