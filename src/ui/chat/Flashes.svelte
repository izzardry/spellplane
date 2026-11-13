<!--
  The attribution flash (DESIGN "Decision log", Permissions: anyone may touch any public card, with attribution; the
  log and the seat-colour flash keep it honest. "Players, seats and formats", Seats: seat colour is used for log
  attribution). When someone touches another player's card, a ring in the toucher's seat colour with their name
  (so nothing depends on hue alone, "Input and interaction design", Accessibility) shows over the card for the ping
  fade time, following the card as the scene draws it. Cards the scene does not draw (in a hand) are flashed in the
  debug hook only. PLAN M1-P6.
-->
<script lang="ts">
  import { onMount } from 'svelte';
  import type { SeatId, TableState } from '../../core/types';
  import type { TableScene } from '../../scene/types';
  import { registerDebug } from '../../util/debug';
  import type { ChatDebug } from './debug';
  import type { Flash, LogWatch } from './watch';

  let {
    watch,
    table,
    scene,
    fadeMs,
    reducedMotion = false,
    seatName,
    seatColour,
  }: {
    watch: LogWatch;
    table: TableState;
    scene: () => TableScene | null;
    fadeMs: number;
    reducedMotion?: boolean;
    seatName: (seat: SeatId) => string;
    seatColour: (seat: SeatId) => number | null;
  } = $props();

  type Box = { left: number; top: number; width: number; height: number };
  let active = $state.raw<Flash[]>([]);
  let boxes = $state.raw<Record<string, Box | null>>({});
  let raf = 0;
  /** Fade timers (not reactive state). */
  let timers: ReturnType<typeof setTimeout>[] = [];

  /** Where a card is drawn on screen (the scene's drawn rectangle: piles, taps and motion included), or null when it is not drawn. */
  function boxOf(f: Flash, drawn: Readonly<Record<string, Box>>): Box | null {
    return table.cards[f.card] ? (drawn[f.card] ?? null) : null;
  }

  function frame() {
    raf = 0;
    if (active.length === 0) return;
    const drawn: Record<string, Box> = {};
    for (const c of scene()?.debug.cards() ?? []) if (c.visible) drawn[c.id] = { left: c.screen.x, top: c.screen.y, width: c.screen.width, height: c.screen.height };
    const next: Record<string, Box | null> = {};
    for (const f of active) next[f.id] = boxOf(f, drawn);
    boxes = next;
    // Follow the camera and the card while the flash lasts.
    if (typeof requestAnimationFrame === 'function') raf = requestAnimationFrame(frame);
  }

  function start(f: Flash) {
    active = [...active, f];
    if (!raf) frame();
    const t = setTimeout(() => {
      timers = timers.filter((x) => x !== t);
      active = active.filter((x) => x.id !== f.id);
    }, fadeMs);
    timers.push(t);
  }

  onMount(() => {
    const off = watch.onFlash(start);
    const debug: ChatDebug = {
      flashes: () => watch.flashes(),
      activeFlashes: () => active.map((f) => ({ ...f, shown: !!boxes[f.id] })),
    };
    registerDebug({ chat: debug });
    return () => {
      off();
      for (const t of timers) clearTimeout(t);
      timers = [];
      if (raf) cancelAnimationFrame(raf);
    };
  });
</script>

{#each active as f (f.id)}
  {@const b = boxes[f.id]}
  {#if b}
    <div
      class="flash"
      class:still={reducedMotion}
      data-testid="attribution-flash"
      data-card={f.card}
      data-by={f.by}
      style:left="{b.left - 4}px"
      style:top="{b.top - 4}px"
      style:width="{b.width + 8}px"
      style:height="{b.height + 8}px"
      style:--seat={seatColour(f.by) === null ? 'var(--sp-fg, #111)' : `var(--sp-seat-${seatColour(f.by)})`}
      style:--seat-ink={seatColour(f.by) === null ? 'var(--sp-bg, #fff)' : `var(--sp-seat-${seatColour(f.by)}-ink, #fff)`}
      style:animation-duration="{fadeMs}ms"
      aria-hidden="true"
    >
      <span class="who">{seatName(f.by)}</span>
    </div>
  {/if}
{/each}

<style>
  .flash {
    position: fixed;
    pointer-events: none;
    border: 3px solid var(--seat);
    border-radius: 6px;
    box-shadow: 0 0 0 2px var(--sp-surface, #fff);
    animation-name: fade;
    animation-timing-function: ease-in;
    animation-fill-mode: forwards;
  }
  .flash.still {
    animation-name: none;
  }
  .who {
    position: absolute;
    left: -3px;
    bottom: 100%;
    margin-bottom: 2px;
    padding: 0 4px;
    background: var(--seat);
    color: var(--seat-ink);
    font: 600 11px / 1.4 var(--sp-font, system-ui);
    border-radius: 2px;
    white-space: nowrap;
  }
  @keyframes fade {
    0%,
    60% {
      opacity: 1;
    }
    100% {
      opacity: 0;
    }
  }
</style>
