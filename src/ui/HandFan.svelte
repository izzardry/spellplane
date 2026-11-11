<!--
  The owner's hand as a screen-anchored fan (DESIGN "Table model": screen-anchored fan for the owner; "Specification:
  geometry, layout and motion", Screen layer; "Camera and navigation": dragging a card from the hand crosses into the
  scene at the cursor's table position).
-->
<script lang="ts">
  import type { CardRef, InstanceId } from '../core/types';
  import type { FaceSource } from '../data/types';
  import type { TextureSource } from '../util/texture';
  import CardFace from './CardFace.svelte';
  import { fanLayout } from './hand';

  let {
    ids,
    refOf,
    nameOf,
    faces,
    back,
    hovered,
    selection,
    vw,
    vh,
    onhover,
    oncontext,
    oninspect,
    ondragout,
    onselect,
  }: {
    ids: InstanceId[];
    refOf: (id: InstanceId) => CardRef | null;
    nameOf: (id: InstanceId) => string;
    faces: FaceSource;
    back: TextureSource | null;
    hovered: InstanceId | null;
    selection: readonly InstanceId[];
    vw: number;
    vh: number;
    onhover: (id: InstanceId | null) => void;
    oncontext: (id: InstanceId, x: number, y: number) => void;
    oninspect: (id: InstanceId) => void;
    ondragout: (id: InstanceId, x: number, y: number) => void;
    onselect: (id: InstanceId) => void;
  } = $props();

  const hoveredIndex = $derived(hovered ? ids.indexOf(hovered) : -1);
  const boxes = $derived(fanLayout(ids.length, vw, vh, hoveredIndex >= 0 ? hoveredIndex : null));
  /** Top edge of the resting fan; a drag that rises above it leaves the hand. */
  const fanTop = $derived(vh - vh * 0.22);

  let drag: { id: InstanceId; x: number; y: number; pointer: number } | null = null;
  let dragging = $state<InstanceId | null>(null);

  function down(e: PointerEvent, id: InstanceId) {
    if (e.button !== 0) return;
    if (e.shiftKey) {
      onselect(id);
      return;
    }
    drag = { id, x: e.clientX, y: e.clientY, pointer: e.pointerId };
  }
  function move(e: PointerEvent) {
    if (!drag || e.pointerId !== drag.pointer) return;
    const moved = Math.hypot(e.clientX - drag.x, e.clientY - drag.y);
    if (moved > 6 && e.clientY < fanTop - 4) {
      const id = drag.id;
      drag = null;
      dragging = id;
      onhover(null);
      ondragout(id, e.clientX, e.clientY);
    }
  }
  function up() {
    drag = null;
    dragging = null;
  }
  function aux(e: MouseEvent, id: InstanceId) {
    if (e.button === 1) {
      e.preventDefault();
      oninspect(id);
    }
  }
</script>

<svelte:window onpointermove={move} onpointerup={up} onpointercancel={up} />

<div class="hand" data-testid="hand" aria-label="Your hand">
  {#each ids as id, i (id)}
    {@const box = boxes[i]}
    {#if box}
      <div
        class="card"
        class:hovered={id === hovered}
        class:selected={selection.includes(id)}
        class:dragging={id === dragging}
        data-testid="hand-card"
        data-card={id}
        role="button"
        tabindex="-1"
        aria-label={nameOf(id)}
        style:left="{box.left}px"
        style:width="{box.width}px"
        style:height="{box.height}px"
        style:z-index={box.z}
        onpointerenter={() => onhover(id)}
        onpointerleave={() => hovered === id && onhover(null)}
        onpointerdown={(e) => down(e, id)}
        oncontextmenu={(e) => {
          e.preventDefault();
          oncontext(id, e.clientX, e.clientY);
        }}
        onmousedown={(e) => e.button === 1 && e.preventDefault()}
        onauxclick={(e) => aux(e, id)}
      >
        <CardFace {faces} cardRef={refOf(id)} {back} tier={id === hovered ? 'normal' : 'small'} alt={nameOf(id)} />
      </div>
    {/if}
  {/each}
</div>

<style>
  .hand {
    position: fixed;
    left: 0;
    right: 0;
    bottom: 0;
    height: 0;
    pointer-events: none;
    z-index: 20;
  }
  .card {
    position: absolute;
    bottom: 0;
    pointer-events: auto;
    transition:
      width 120ms ease-out,
      height 120ms ease-out,
      left 120ms ease-out;
    box-shadow: 0 0 0 1px var(--sp-border, #d8d8d8);
    border-radius: 4.76% / 3.41%;
    cursor: grab;
    touch-action: none;
  }
  .card.hovered {
    box-shadow: 0 0 0 2px var(--sp-fg, #111);
  }
  .card.selected {
    box-shadow: 0 0 0 3px var(--sp-focus, #1f6fd1);
  }
  .card.dragging {
    opacity: 0.35;
  }
  @media (prefers-reduced-motion: reduce) {
    .card {
      transition: none;
    }
  }
</style>
