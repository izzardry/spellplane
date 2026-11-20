<!--
  A pile's actions on the pile (PLAN M7-P5: "a click on the library pile offers Draw; hovering or pressing a pile shows
  its few actions on the pile (Draw, Shuffle, Search, Reveal top) as small buttons"; docs/design/m7-hud-proposal.md,
  Pile actions). The table scene reports the pile under the pointer or the one a click or tap chose
  (SceneEvents.pileHover); the buttons stand beside it. A hover's buttons stay while the pointer moves from the pile
  onto them and go a moment after it leaves both; a click's stay until the next click elsewhere. Added by M7-P5.
-->
<script lang="ts">
  import { onDestroy } from 'svelte';
  import type { PileHover } from '../../scene/types';
  import { controlHeight, pilePlace, type PileButton } from './affordances';
  import Button from '../design/Button.svelte';

  let {
    hover,
    buttons,
    touch = false,
    vw,
    vh,
    onaction,
  }: {
    hover: PileHover | null;
    buttons: (hover: PileHover) => PileButton[];
    touch?: boolean;
    vw: number;
    vh: number;
    onaction: (button: PileButton, hover: PileHover) => void;
  } = $props();

  /** How long a hover's buttons wait for the pointer to reach them, ms. */
  const LINGER_MS = 400;
  let shown = $state.raw<PileHover | null>(null);
  let over = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const clear = () => {
    if (timer) clearTimeout(timer);
    timer = null;
  };
  const linger = () => {
    clear();
    timer = setTimeout(() => {
      timer = null;
      if (!over) shown = null;
    }, LINGER_MS);
  };
  $effect(() => {
    const h = hover;
    if (h) {
      clear();
      shown = h;
    } else if (!over) linger();
  });
  onDestroy(clear);

  const list = $derived(shown ? buttons(shown) : []);
  let w = $state(0);
  let hgt = $state(0);
  const height = $derived(controlHeight(touch));
  const place = $derived(shown ? pilePlace(shown.rect, { width: w || 110, height: hgt || list.length * (height + 4) + 8 }, { width: vw, height: vh }) : null);
</script>

{#if shown && place && list.length}
  <div
    class="pile-actions"
    class:touch
    role="toolbar"
    tabindex="-1"
    aria-orientation="vertical"
    aria-label="Pile actions"
    data-testid="pile-actions"
    data-zone={shown.zone ?? ''}
    data-via={shown.via}
    data-side={place.side}
    style:--h="{height}px"
    style:transform="translate({place.x}px, {place.y}px)"
    bind:offsetWidth={w}
    bind:offsetHeight={hgt}
    onpointerenter={() => {
      over = true;
      clear();
    }}
    onpointerleave={() => {
      over = false;
      if (!hover) linger();
    }}
  >
    {#each list as b, i (b.id)}
      <Button variant={i === 0 ? 'secondary' : 'quiet'} size={touch ? 'md' : 'sm'} data-testid="pile-action-{b.id}" onclick={() => shown && onaction(b, shown)}>{b.label}</Button>
    {/each}
  </div>
{/if}

<style>
  .pile-actions {
    position: fixed;
    left: 0;
    top: 0;
    z-index: 22;
    display: flex;
    flex-direction: column;
    align-items: stretch;
    gap: var(--ds-space-xs, 4px);
    padding: var(--ds-space-xs, 4px);
    pointer-events: auto;
    background: var(--ds-panel, var(--sp-surface));
    color: var(--ds-ink, var(--sp-fg));
    border: 1px solid var(--ds-border, var(--sp-border));
    border-radius: var(--ds-radius-md, 10px);
    box-shadow: var(--ds-elevation-pop, var(--sp-hud-shadow));
    font-family: var(--ds-font-body, var(--sp-font));
    white-space: nowrap;
    -webkit-user-select: none;
    user-select: none;
    -webkit-touch-callout: none;
    touch-action: manipulation;
  }
  /* The kit's sm (36 px) or md (44 px) button, left-aligned in a column. */
  .pile-actions :global(.ds-btn) {
    box-sizing: border-box;
    justify-content: flex-start;
  }
</style>
