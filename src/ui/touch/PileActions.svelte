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
    {#each list as b (b.id)}
      <button type="button" data-testid="pile-action-{b.id}" onclick={() => shown && onaction(b, shown)}>{b.label}</button>
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
    gap: 4px;
    padding: 4px;
    pointer-events: auto;
    background: var(--ds-panel, var(--sp-surface, #fff));
    color: var(--ds-ink, var(--sp-fg, #111));
    border: 1px solid var(--ds-border, var(--sp-border, #d8d8d8));
    border-radius: var(--ds-radius-md, 10px);
    box-shadow: var(--ds-elevation-pop, 0 2px 8px rgb(0 0 0 / 18%));
    font: 600 13px/1 var(--ds-font-body, var(--sp-font, system-ui));
    white-space: nowrap;
    -webkit-user-select: none;
    user-select: none;
    -webkit-touch-callout: none;
    touch-action: manipulation;
  }
  button {
    min-height: var(--h);
    padding: 0 12px;
    text-align: left;
    border-radius: var(--ds-radius-sm, 6px);
    border: 1px solid transparent;
    background: transparent;
    color: inherit;
    font: inherit;
    cursor: pointer;
  }
  button:first-child {
    background: var(--ds-accent, var(--sp-fg, #111));
    color: var(--ds-accent-ink, var(--sp-bg, #fff));
  }
  button:focus-visible {
    outline: 2px solid var(--ds-focus, var(--sp-focus, #2563eb));
    outline-offset: 1px;
  }
</style>
