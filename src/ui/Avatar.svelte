<!--
  A player's plate (docs/design/m7-hud-proposal.md, My plate and Opponent plate; PLAN M7-P2 "life plates at seat
  edges"; DESIGN "Turn flow and confirmation", Life and player counters): a seat disc with the seat's colour and shape,
  the name, life in large numerals (ui/design/LifePlate.svelte: click ± on hover, scrub by dragging, click to type,
  scroll), counters as chips only when not zero, and for another player the hand count. Rare things sit one step away
  under "⋯": every counter with ± and "+ counter", the player's piles with their counts, and "Look at this seat".
  States read without hue: a speaking ring, a dotted typing tag, "away", "asks", "responding".
-->
<script lang="ts">
  import type { Seat, ZoneId } from '../core/types';
  import CounterChip from './design/CounterChip.svelte';
  import Icon from './design/Icon.svelte';
  import LifePlate from './design/LifePlate.svelte';

  let {
    seat,
    life,
    me,
    active,
    responding,
    asking = false,
    speaking = false,
    typing = false,
    glyph,
    zones,
    handCount = null,
    onlife,
    oncounter,
    onopenzone,
    ongoto,
    readonly = false,
    compact = false,
  }: {
    seat: Seat;
    life: number;
    me: boolean;
    active: boolean;
    responding: boolean;
    /** Added by M1-P3: this seat asked a manual round that still waits; its plate pulses (DESIGN "Turn flow and confirmation", Prompt). */
    asking?: boolean;
    /** Added by M3-P3: this player is speaking; the plate shows a speaking ring (DESIGN "Chat and voice", Live voice). */
    speaking?: boolean;
    /** Added by M6-P2: this player is typing a chat line the viewer may see (GAPS 22, ui/chat/typing.ts). */
    typing?: boolean;
    glyph: string;
    zones: { id: ZoneId; label: string; count: number }[];
    /** Added by M7-P2: another player's hand count (docs/design/m7-hud-proposal.md, Opponent plate); null for none. */
    handCount?: number | null;
    onlife: (delta: number) => void;
    oncounter: (kind: string, delta: number) => void;
    onopenzone: (zone: ZoneId) => void;
    /** Added by M3-P1: a tap on the name moves the camera to this seat (DESIGN "Camera and navigation"). */
    ongoto?: () => void;
    /** A spectator's view: life and counters without the controls to change them. */
    readonly?: boolean;
    /** A smaller plate (three or more opponents). */
    compact?: boolean;
  } = $props();

  let moreOpen = $state(false);
  let newCounter = $state<string | null>(null);
  let counterInput = $state<HTMLInputElement | undefined>();
  let root = $state<HTMLElement | undefined>();
  let moreButton = $state<HTMLButtonElement | undefined>();
  const allCounters = $derived(Object.entries({ poison: 0, ...seat.counters }).sort(([a], [b]) => (a === 'poison' ? -1 : b === 'poison' ? 1 : a.localeCompare(b))));
  /** Only counters that are not zero show on the plate ("showing poison 0 all game is noise"). */
  const shown = $derived(allCounters.filter(([, n]) => n !== 0));
  $effect(() => {
    if (newCounter !== null) counterInput?.focus();
  });
  // The "⋯" popover closes on a press outside it and on Esc.
  $effect(() => {
    if (!moreOpen) return;
    const away = (e: PointerEvent): void => {
      if (!root?.contains(e.target as Node | null)) moreOpen = false;
    };
    window.addEventListener('pointerdown', away, true);
    return () => window.removeEventListener('pointerdown', away, true);
  });
  function closeMore(): void {
    moreOpen = false;
    moreButton?.focus({ preventScroll: true });
  }
</script>

<section
  bind:this={root}
  class="plate"
  class:active
  class:me
  class:away={seat.away === true}
  class:speaking
  class:compact
  class:asking
  data-speaking={speaking ? 'true' : 'false'}
  data-typing={typing ? 'true' : 'false'}
  data-testid="avatar"
  data-seat={seat.id}
  data-line-seat={seat.id}
  data-away={seat.away === true ? 'true' : 'false'}
  aria-label="{seat.name}{me ? ' (you)' : ''}{seat.away ? ' (away)' : ''}"
  style:--seat="var(--sp-seat-{seat.colour}, #555)"
  style:--seat-ink="var(--sp-seat-{seat.colour}-ink, #fff)"
>
  <span class="disc" aria-hidden="true"><span class="glyph {glyph}"></span></span>
  <div class="body">
    <header>
      {#if ongoto}
        <button type="button" class="name goto" data-testid="avatar-goto" title="Look at {me ? 'your' : `${seat.name}'s`} side of the table" onclick={ongoto}>{seat.name}</button>
      {:else}
        <span class="name">{seat.name}</span>
      {/if}
      {#if me}<span class="you">you</span>{/if}
      {#if handCount !== null}<span class="hand" data-testid="hand-count" title="{handCount} cards in hand" aria-label="{handCount} cards in hand"><Icon name="hand" size={14} /><b>{handCount}</b></span>{/if}
    </header>
    <div class="tags">
      {#if seat.away}<span class="tag inverse" data-testid="away" title="Disconnected: public cards stay; hand and library are unavailable until this player returns">away</span>{/if}
      {#if responding}<span class="tag" data-testid="responding">responding</span>{/if}
      {#if asking}<span class="tag inverse" data-testid="asking">asks</span>{/if}
      {#if typing}<span class="tag typing" data-testid="avatar-typing" title="Typing a chat line" aria-label="typing"><span class="dot"></span><span class="dot"></span><span class="dot"></span></span>{/if}
      {#if seat.autoPass}<span class="tag" title="Passing until end of turn">auto-pass</span>{/if}
    </div>
  </div>
  <LifePlate {life} name={seat.name} {readonly} size={compact ? 'small' : 'large'} {onlife} />
  {#if shown.length}
    <div class="chips">
      {#each shown as [kind, n] (kind)}<CounterChip {kind} value={n} {readonly} onchange={(d) => oncounter(kind, d)} />{/each}
    </div>
  {/if}
  <button bind:this={moreButton} type="button" class="more" data-testid="plate-more" aria-label="More for {seat.name}: counters and piles" title="Counters and piles" aria-expanded={moreOpen} onclick={() => (moreOpen = !moreOpen)}><Icon name="more" size={18} /></button>
  {#if moreOpen}
    <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
    <div
      class="ds-pop pop"
      role="group"
      aria-label="{seat.name}: counters and piles"
      data-testid="plate-details"
      onkeydown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          closeMore();
        }
      }}
    >
      <span class="ds-label">Counters</span>
      <ul class="counters">
        {#each allCounters as [kind, n] (kind)}
          <li data-testid="player-counter" data-kind={kind}>
            <span class="kind">{kind}</span>
            {#if !readonly}<button type="button" class="ds-btn ds-btn--quiet ds-btn--small" aria-label="Remove one {kind}" disabled={n <= 0 && kind === 'poison'} onclick={() => oncounter(kind, -1)}>−</button>{/if}
            <b class="n">{n}</b>
            {#if !readonly}<button type="button" class="ds-btn ds-btn--quiet ds-btn--small" aria-label="Add one {kind}" onclick={() => oncounter(kind, 1)}>+</button>{/if}
          </li>
        {/each}
      </ul>
      {#if !readonly}
        {#if newCounter !== null}
          <input
            bind:this={counterInput}
            class="new"
            data-testid="counter-name"
            placeholder="energy, cmd:Ben…"
            aria-label="New counter name"
            bind:value={newCounter}
            onkeydown={(e) => {
              e.stopPropagation();
              if (e.key === 'Enter' && newCounter?.trim()) {
                oncounter(newCounter.trim(), 1);
                newCounter = null;
              } else if (e.key === 'Escape') newCounter = null;
            }}
            onblur={() => (newCounter = null)}
          />
        {:else}
          <button type="button" class="ds-btn ds-btn--quiet ds-btn--small add" data-testid="add-counter" onclick={() => (newCounter = '')}>+ counter</button>
        {/if}
      {/if}
      {#if zones.length}
        <span class="ds-label">Piles</span>
        <nav class="zones" aria-label="{seat.name}'s piles">
          {#each zones as z (z.id)}
            <button
              type="button"
              class="ds-btn ds-btn--small"
              data-testid="zone-button"
              data-zone={z.id}
              onclick={() => {
                moreOpen = false;
                onopenzone(z.id);
              }}>{z.label} <b>{z.count}</b></button
            >
          {/each}
        </nav>
      {/if}
    </div>
  {/if}
</section>

<style>
  .plate {
    position: relative;
    display: flex;
    align-items: center;
    gap: var(--ds-space-md);
    padding: var(--ds-space-sm) var(--ds-space-md) var(--ds-space-sm) var(--ds-space-sm);
    background: var(--ds-panel);
    color: var(--ds-ink);
    border: 1px solid var(--ds-border);
    border-radius: var(--ds-radius-plate);
    box-shadow: var(--ds-elevation-raised);
    font-family: var(--ds-font-body);
    font-size: var(--ds-type-small);
    pointer-events: auto;
    max-width: calc(100vw - 2 * var(--ds-edge));
    box-sizing: border-box;
  }
  .plate.compact {
    gap: var(--ds-space-sm);
    padding: var(--ds-space-xs) var(--ds-space-sm) var(--ds-space-xs) var(--ds-space-xs);
  }
  /* The active player's plate: a heavier edge in the seat colour and "turn" told by the tracker. */
  .plate.active {
    border-color: var(--seat);
    box-shadow:
      0 0 0 1px var(--seat),
      var(--ds-elevation-raised);
  }
  /* The speaking ring (M3-P3): a thick outline in the seat colour, so it reads without hue as well. */
  .plate.speaking .disc {
    outline: 3px solid var(--seat);
    outline-offset: 2px;
  }
  .disc {
    display: grid;
    place-items: center;
    width: var(--ds-control-avatar);
    height: var(--ds-control-avatar);
    border-radius: 50%;
    background: var(--seat);
    flex: none;
  }
  .compact .disc {
    width: var(--ds-control-avatar-small);
    height: var(--ds-control-avatar-small);
  }
  .glyph {
    width: 16px;
    height: 16px;
    background: var(--seat-ink);
  }
  .glyph.circle {
    border-radius: 50%;
  }
  .glyph.triangle {
    clip-path: polygon(50% 0, 100% 100%, 0 100%);
  }
  .glyph.diamond {
    clip-path: polygon(50% 0, 100% 50%, 50% 100%, 0 50%);
  }
  .glyph.star {
    clip-path: polygon(50% 0, 61% 35%, 98% 35%, 68% 57%, 79% 91%, 50% 70%, 21% 91%, 32% 57%, 2% 35%, 39% 35%);
  }
  .glyph.hexagon {
    clip-path: polygon(25% 0, 75% 0, 100% 50%, 75% 100%, 25% 100%, 0 50%);
  }
  .glyph.cross {
    clip-path: polygon(35% 0, 65% 0, 65% 35%, 100% 35%, 100% 65%, 65% 65%, 65% 100%, 35% 100%, 35% 65%, 0 65%, 0 35%, 35% 35%);
  }
  .glyph.ring {
    background: none;
    border: 3px solid var(--seat-ink);
    border-radius: 50%;
    box-sizing: border-box;
  }
  .body {
    display: grid;
    gap: 2px;
    min-width: 0;
  }
  header {
    display: flex;
    align-items: center;
    gap: var(--ds-space-sm);
    min-width: 0;
  }
  .name {
    font-family: var(--ds-font-heading);
    font-weight: var(--ds-heading-weight);
    font-variant: var(--ds-heading-variant);
    font-size: var(--ds-type-control);
    color: inherit;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 10em;
  }
  .goto {
    background: none;
    border: 0;
    padding: 0;
    cursor: pointer;
    text-align: left;
  }
  .goto:hover {
    text-decoration: underline;
  }
  .you {
    color: var(--ds-muted);
  }
  .hand {
    display: inline-flex;
    align-items: center;
    gap: 2px;
    color: var(--ds-muted);
    font-variant-numeric: tabular-nums;
  }
  .hand b {
    color: var(--ds-ink);
  }
  .tags {
    display: flex;
    gap: 4px;
    flex-wrap: wrap;
  }
  .tags:empty {
    display: none;
  }
  .tag {
    font-size: var(--ds-type-label);
    border: 1px solid var(--ds-ink);
    border-radius: var(--ds-radius-pill);
    padding: 0 6px;
  }
  .tag.inverse {
    background: var(--ds-ink);
    color: var(--ds-panel);
  }
  .plate.asking {
    animation: asking 1.2s ease-in-out infinite;
  }
  @keyframes asking {
    50% {
      transform: translateY(-2px);
    }
  }
  .typing {
    display: inline-flex;
    gap: 2px;
    align-items: center;
  }
  .typing .dot {
    width: 4px;
    height: 4px;
    border-radius: 50%;
    background: currentColor;
    animation: sp-typing 1.2s infinite ease-in-out;
  }
  .typing .dot:nth-child(2) {
    animation-delay: 0.2s;
  }
  .typing .dot:nth-child(3) {
    animation-delay: 0.4s;
  }
  @keyframes sp-typing {
    0%,
    80%,
    100% {
      transform: translateY(0);
    }
    40% {
      transform: translateY(-2px);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .typing .dot,
    .plate.asking {
      animation: none;
    }
  }
  .chips {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .more {
    display: grid;
    place-items: center;
    width: 30px;
    height: 30px;
    padding: 0;
    border: 0;
    border-radius: 50%;
    background: transparent;
    color: var(--ds-muted);
    cursor: pointer;
  }
  .more:hover,
  .more[aria-expanded='true'] {
    background: var(--ds-chip);
    color: var(--ds-ink);
  }
  .pop {
    position: absolute;
    z-index: 5;
    left: 0;
    bottom: calc(100% + 6px);
    min-width: 220px;
    padding: var(--ds-space-md);
    display: grid;
    gap: var(--ds-space-sm);
  }
  /* A plate at the top of the screen opens its details downwards. */
  :global(.plate-top) .pop {
    bottom: auto;
    top: calc(100% + 6px);
  }
  .counters {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 2px;
  }
  .counters li {
    display: flex;
    align-items: center;
    gap: 4px;
  }
  .kind {
    flex: 1;
  }
  .n {
    min-width: 2ch;
    text-align: center;
    font-variant-numeric: tabular-nums;
  }
  .new {
    font: inherit;
    min-height: 30px;
    padding: 0 8px;
    border: 1px solid var(--ds-border);
    border-radius: var(--ds-radius-sm);
    background: var(--ds-panel);
    color: var(--ds-ink);
  }
  .add {
    justify-self: start;
  }
  .zones {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }
</style>
